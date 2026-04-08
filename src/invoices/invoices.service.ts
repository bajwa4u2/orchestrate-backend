import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ActivityKind,
  ActivityVisibility,
  ArtifactLifecycle,
  InvoiceStatus,
  RecordSource,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toPrismaJson } from '../common/utils/prisma-json';
import { WorkflowsService } from '../workflows/workflows.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: PrismaService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  async createDraftInvoice(input: {
    organizationId: string;
    clientId: string;
    dueAt?: Date;
    items: {
      title: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      taxRate?: number;
    }[];
    createdById?: string;
  }) {
    if (!input.organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    if (!input.clientId) {
      throw new BadRequestException('clientId is required');
    }

    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('Invoice must have at least one item');
    }

    let subtotal = 0;
    let taxTotal = 0;

    const items = input.items.map((item) => {
      const quantity = Number(item.quantity ?? 0);
      const unitPrice = Number(item.unitPrice ?? 0);
      const taxRate = Number(item.taxRate ?? 0);

      if (!item.title || quantity <= 0 || unitPrice < 0 || taxRate < 0) {
        throw new BadRequestException('Each invoice item must have a title, positive quantity, and valid pricing');
      }

      const lineSubtotal = quantity * unitPrice;
      const taxAmount = (taxRate / 100) * lineSubtotal;
      const lineTotal = lineSubtotal + taxAmount;

      subtotal += lineSubtotal;
      taxTotal += taxAmount;

      return {
        title: item.title,
        description: item.description ?? null,
        quantity,
        unitPrice,
        taxRate,
        lineSubtotal,
        taxAmount,
        lineTotal,
      };
    });

    const total = subtotal + taxTotal;
    const invoiceNumber = await this.generateInvoiceNumber(input.organizationId);
    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: input.clientId,
      lane: WorkflowLane.REVENUE,
      type: WorkflowType.BILLING_CYCLE,
      status: WorkflowStatus.RUNNING,
      trigger: input.createdById ? WorkflowTrigger.MANUAL_OPERATOR : WorkflowTrigger.SYSTEM_EVENT,
      source: input.createdById ? RecordSource.OPERATOR_CREATED : RecordSource.SYSTEM_GENERATED,
      title: `Invoice ${invoiceNumber}`,
      inputJson: { dueAt: input.dueAt?.toISOString() ?? null, itemCount: items.length, subtotal, taxTotal, total },
      startedAt: new Date(),
    });

    const invoice = await this.db.invoice.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        workflowRunId: workflow.id,
        invoiceNumber,
        status: InvoiceStatus.DRAFT,
        source: input.createdById ? RecordSource.OPERATOR_CREATED : RecordSource.SYSTEM_GENERATED,
        lifecycle: ArtifactLifecycle.DRAFT,
        dueAt: input.dueAt,
        createdById: input.createdById,
        metadataJson: {
          items,
          totals: {
            subtotal,
            taxTotal,
            total,
          },
        },
      },
    });

    await Promise.all([
      this.workflowsService.attachWorkflowSubjects(workflow.id, {
        invoiceId: invoice.id,
        title: `Invoice ${invoice.invoiceNumber}`,
        resultJson: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, total },
      }),
      this.workflowsService.completeWorkflowRun(workflow.id, { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, total }),
      this.db.activityEvent.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          actorUserId: input.createdById,
          workflowRunId: workflow.id,
          kind: ActivityKind.INVOICE_ISSUED,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'INVOICE',
          subjectId: invoice.id,
          summary: `Invoice ${invoice.invoiceNumber} drafted.`,
          metadataJson: toPrismaJson({ invoiceNumber: invoice.invoiceNumber, totalCents: total }),
        },
      }),
    ]);

    return invoice;
  }

  async issueInvoice(invoiceId: string) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only draft invoices can be issued');
    }

    const updated = await this.db.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.ISSUED,
        lifecycle: ArtifactLifecycle.ISSUED,
        issuedAt: new Date(),
      },
    });

    if (updated.workflowRunId) {
      await this.workflowsService.completeWorkflowRun(updated.workflowRunId, {
        invoiceId: updated.id,
        invoiceNumber: updated.invoiceNumber,
        status: updated.status,
      });
    }

    return updated;
  }

  async markOverdueIfNeeded(invoiceId: string) {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) return;

    if (
      invoice.status === InvoiceStatus.ISSUED ||
      invoice.status === InvoiceStatus.SENT
    ) {
      if (invoice.dueAt && invoice.dueAt < new Date()) {
        await this.db.invoice.update({
          where: { id: invoiceId },
          data: { status: InvoiceStatus.OVERDUE },
        });
      }
    }
  }

  private async generateInvoiceNumber(organizationId: string): Promise<string> {
    const year = new Date().getFullYear();

    const lastInvoice = await this.db.invoice.findFirst({
      where: {
        organizationId,
        invoiceNumber: {
          startsWith: `INV-${year}-`,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    let nextNumber = 1;

    if (lastInvoice?.invoiceNumber) {
      const parts = lastInvoice.invoiceNumber.split('-');
      const parsed = Number.parseInt(parts[2] ?? '', 10);
      if (Number.isFinite(parsed)) {
        nextNumber = parsed + 1;
      }
    }

    return `INV-${year}-${String(nextNumber).padStart(4, '0')}`;
  }
}
