import { Injectable } from '@nestjs/common';
import {
  ActivityKind,
  ActivityVisibility,
  AgreementStatus,
  ArtifactLifecycle,
  RecordSource,
  WorkflowLane,
  WorkflowStatus,
  WorkflowTrigger,
  WorkflowType,
} from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { CreateServiceAgreementDto } from './dto/create-service-agreement.dto';

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.serviceAgreement.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      include: { client: true, subscription: true, documentDispatches: { orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async create(organizationId: string, createdById: string | undefined, dto: CreateServiceAgreementDto) {
    const count = await this.prisma.serviceAgreement.count({ where: { organizationId } });
    const workflow = await this.workflowsService.createWorkflowRun({
      clientId: dto.clientId,
      subscriptionId: dto.subscriptionId ?? undefined,
      lane: WorkflowLane.DOCUMENTS,
      type: WorkflowType.AGREEMENT_ISSUANCE,
      status: WorkflowStatus.RUNNING,
      trigger: createdById ? WorkflowTrigger.MANUAL_OPERATOR : WorkflowTrigger.USER_ACTION,
      source: createdById ? RecordSource.OPERATOR_CREATED : RecordSource.SYSTEM_GENERATED,
      title: 'Agreement issuance',
      inputJson: {
        agreementTitle: dto.title ?? 'Orchestrate Service Agreement',
        requestedStatus: dto.status ?? AgreementStatus.DRAFT,
      },
      startedAt: new Date(),
    });

    const agreement = await this.prisma.serviceAgreement.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        subscriptionId: dto.subscriptionId,
        createdById,
        workflowRunId: workflow.id,
        agreementNumber: dto.agreementNumber ?? `AGR-${String(count + 1).padStart(5, '0')}`,
        title: dto.title || 'Orchestrate Service Agreement',
        status: dto.status ?? AgreementStatus.DRAFT,
        source: createdById ? RecordSource.OPERATOR_CREATED : RecordSource.SYSTEM_GENERATED,
        lifecycle: ArtifactLifecycle.DRAFT,
        effectiveStartAt: dto.effectiveStartAt,
        effectiveEndAt: dto.effectiveEndAt,
        termsText: dto.termsText,
        metadataJson: toPrismaJson(dto.metadataJson),
      },
      include: { client: true, subscription: true },
    });

    await Promise.all([
      this.workflowsService.attachWorkflowSubjects(workflow.id, {
        serviceAgreementId: agreement.id,
        title: `Agreement ${agreement.agreementNumber}`,
        resultJson: {
          agreementId: agreement.id,
          agreementNumber: agreement.agreementNumber,
          status: agreement.status,
        },
      }),
      this.workflowsService.completeWorkflowRun(workflow.id, {
        agreementId: agreement.id,
        agreementNumber: agreement.agreementNumber,
      }),
      this.prisma.activityEvent.create({
        data: {
          organizationId,
          clientId: dto.clientId,
          actorUserId: createdById,
          workflowRunId: workflow.id,
          kind: ActivityKind.SYSTEM_ALERT,
          visibility: ActivityVisibility.CLIENT_VISIBLE,
          subjectType: 'SERVICE_AGREEMENT',
          subjectId: agreement.id,
          summary: `Agreement ${agreement.agreementNumber} prepared.`,
          metadataJson: toPrismaJson({ agreementNumber: agreement.agreementNumber, status: agreement.status }),
        },
      }),
    ]);

    return agreement;
  }
}
