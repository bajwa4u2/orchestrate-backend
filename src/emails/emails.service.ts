import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentDispatchStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SendTemplatedEmailDto } from './dto/send-templated-email.dto';

@Injectable()
export class EmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  listDispatches(organizationId: string, clientId?: string) {
    return this.prisma.documentDispatch.findMany({
      where: { organizationId, deliveryChannel: 'EMAIL', ...(clientId ? { clientId } : {}) },
      include: {
        client: true,
        template: true,
        invoice: true,
        statement: true,
        agreement: true,
        receipt: true,
        reminder: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async sendTemplateEmail(organizationId: string, actorUserId: string | undefined, dto: SendTemplatedEmailDto) {
    const template = await this.prisma.template.findFirst({
      where: { id: dto.templateId, organizationId, isActive: true },
    });
    if (!template) throw new NotFoundException('Template not found in active organization');

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, displayName: true },
    });

    const client = dto.clientId
      ? await this.prisma.client.findFirst({
          where: { id: dto.clientId, organizationId },
          select: { id: true, displayName: true, legalName: true },
        })
      : null;

    const recipientEmail = dto.toEmail ?? this.resolveEmailFromVariables(dto.variables);
    if (!recipientEmail) {
      throw new BadRequestException('Missing recipient email. Provide toEmail or include email in variables.');
    }

    const baseUrl = this.getBaseUrl();
    const portalUrl = this.getClientPortalUrl(client?.id);
    const variables = {
      ...(dto.variables ?? {}),
      app_url: baseUrl,
      portal_url: portalUrl,
      organization_name: organization?.displayName ?? 'Orchestrate',
      client_name: client?.displayName ?? client?.legalName ?? dto.toName ?? 'Client',
      support_email: process.env.MAIL_FROM_ADDRESS ?? 'hello@orchestrateops.com',
    };

    const renderedSubject = this.renderString(template.subjectTemplate, variables);
    const renderedBody = this.renderString(template.bodyTemplate, variables);

    const emailEnabled = this.isEmailDeliveryEnabled();
    const dispatch = await this.prisma.documentDispatch.create({
      data: {
        organizationId,
        clientId: client?.id,
        templateId: template.id,
        kind: template.type,
        status: emailEnabled ? DocumentDispatchStatus.SENT : DocumentDispatchStatus.ISSUED,
        deliveryChannel: 'EMAIL',
        recipientEmail,
        recipientName: dto.toName,
        subjectLine: renderedSubject,
        bodyText: renderedBody,
        payloadJson: variables as Prisma.InputJsonValue,
        deliveredAt: emailEnabled ? new Date() : undefined,
        externalMessageId: emailEnabled ? this.buildSyntheticMessageId(organizationId, template.id) : undefined,
      },
    });

    if (dto.createNotification !== false) {
      await this.notificationsService.recordDocumentNotification({
        organizationId,
        clientId: client?.id,
        actorUserId,
        category: 'email',
        title: renderedSubject ?? `${template.name} prepared`,
        bodyText: emailEnabled
          ? `Email sent to ${recipientEmail} from ${process.env.MAIL_FROM_ADDRESS ?? 'hello@orchestrateops.com'}`
          : `Email prepared for ${recipientEmail}. Delivery mode is ${process.env.EMAIL_DELIVERY_MODE ?? 'log'}.`,
        metadataJson: {
          documentDispatchId: dispatch.id,
          templateId: template.id,
          recipientEmail,
          portalUrl,
        } as Prisma.InputJsonValue,
      });
    }

    return {
      dispatch,
      transport: {
        mode: process.env.EMAIL_DELIVERY_MODE ?? 'log',
        domain: process.env.APP_BASE_URL ?? 'https://orchestrateops.com',
        from: {
          name: process.env.MAIL_FROM_NAME ?? 'Orchestrate Ops',
          email: process.env.MAIL_FROM_ADDRESS ?? 'hello@orchestrateops.com',
        },
      },
    };
  }

  private renderString(input: string | null | undefined, variables: Record<string, unknown>) {
    if (!input) return null;
    return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
      const value = variables[key];
      return value == null ? '' : String(value);
    });
  }

  private resolveEmailFromVariables(variables?: Record<string, unknown>) {
    if (!variables) return undefined;
    const candidate = variables.to_email ?? variables.email ?? variables.client_email ?? variables.recipient_email;
    return candidate == null ? undefined : String(candidate);
  }

  private getBaseUrl() {
    return process.env.APP_BASE_URL?.trim() || 'https://orchestrateops.com';
  }

  private getClientPortalUrl(clientId?: string) {
    const configured = process.env.CLIENT_PORTAL_BASE_URL?.trim() || 'https://orchestrateops.com/client';
    return clientId ? `${configured.replace(/\/$/, '')}?clientId=${clientId}` : configured;
  }

  private isEmailDeliveryEnabled() {
    return (process.env.EMAIL_DELIVERY_MODE ?? 'log').toLowerCase() !== 'disabled';
  }

  private buildSyntheticMessageId(organizationId: string, templateId: string) {
    return `orchestrate-${organizationId}-${templateId}-${Date.now()}`;
  }
}
