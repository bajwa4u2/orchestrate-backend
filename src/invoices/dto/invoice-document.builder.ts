import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

type RawInvoiceItem = {
  title?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  taxRate?: unknown;
  lineSubtotal?: unknown;
  taxAmount?: unknown;
  lineTotal?: unknown;
};

type RawInvoiceTotals = {
  subtotal?: unknown;
  taxTotal?: unknown;
  total?: unknown;
};

type RawInvoiceMetadata = {
  items?: unknown;
  totals?: unknown;
};

export type InvoiceDocumentItem = {
  title: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineSubtotal: number;
  taxAmount: number;
  lineTotal: number;
};

export type InvoiceDocumentTotals = {
  subtotal: number;
  taxTotal: number;
  total: number;
};

export type InvoiceDocument = {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  createdAt: Date;
  organizationId: string;
  clientId: string;
  items: InvoiceDocumentItem[];
  totals: InvoiceDocumentTotals;
  metadataJson: unknown;
};

@Injectable()
export class InvoiceDocumentBuilder {
  constructor(private readonly db: PrismaService) {}

  async buildByInvoiceId(invoiceId: string): Promise<InvoiceDocument> {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return this.buildFromRecord(invoice);
  }

  buildFromRecord(invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    issuedAt: Date | null;
    dueAt: Date | null;
    createdAt: Date;
    organizationId: string;
    clientId: string;
    metadataJson: unknown;
  }): InvoiceDocument {
    const metadata = this.asObject(invoice.metadataJson);
    const rawItems = this.extractItems(metadata);
    const normalizedItems = rawItems.map((item) => this.normalizeItem(item));
    const totals = this.extractTotals(metadata, normalizedItems);

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      createdAt: invoice.createdAt,
      organizationId: invoice.organizationId,
      clientId: invoice.clientId,
      items: normalizedItems,
      totals,
      metadataJson: invoice.metadataJson,
    };
  }

  private extractItems(metadata: RawInvoiceMetadata): RawInvoiceItem[] {
    if (!Array.isArray(metadata.items)) {
      return [];
    }

    return metadata.items as RawInvoiceItem[];
  }

  private extractTotals(
    metadata: RawInvoiceMetadata,
    items: InvoiceDocumentItem[],
  ): InvoiceDocumentTotals {
    const totalsObject = this.asObject(metadata.totals) as RawInvoiceTotals;

    const subtotalFromItems = items.reduce((sum, item) => sum + item.lineSubtotal, 0);
    const taxTotalFromItems = items.reduce((sum, item) => sum + item.taxAmount, 0);
    const totalFromItems = items.reduce((sum, item) => sum + item.lineTotal, 0);

    return {
      subtotal: this.toNumberOrFallback(totalsObject.subtotal, subtotalFromItems),
      taxTotal: this.toNumberOrFallback(totalsObject.taxTotal, taxTotalFromItems),
      total: this.toNumberOrFallback(totalsObject.total, totalFromItems),
    };
  }

  private normalizeItem(item: RawInvoiceItem): InvoiceDocumentItem {
    const quantity = this.toNumberOrFallback(item.quantity, 0);
    const unitPrice = this.toNumberOrFallback(item.unitPrice, 0);
    const taxRate = this.toNumberOrFallback(item.taxRate, 0);

    const computedLineSubtotal = quantity * unitPrice;
    const computedTaxAmount = (computedLineSubtotal * taxRate) / 100;
    const computedLineTotal = computedLineSubtotal + computedTaxAmount;

    return {
      title: this.toNonEmptyString(item.title, 'Untitled item'),
      description: this.toNullableString(item.description),
      quantity,
      unitPrice,
      taxRate,
      lineSubtotal: this.toNumberOrFallback(item.lineSubtotal, computedLineSubtotal),
      taxAmount: this.toNumberOrFallback(item.taxAmount, computedTaxAmount),
      lineTotal: this.toNumberOrFallback(item.lineTotal, computedLineTotal),
    };
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private toNumberOrFallback(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  private toNonEmptyString(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    return fallback;
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    return null;
  }
}