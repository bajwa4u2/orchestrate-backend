import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toPrismaJson } from '../common/utils/prisma-json';
import { PrismaService } from '../database/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, clientId?: string) {
    return this.prisma.template.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  create(organizationId: string, dto: CreateTemplateDto) {
    return this.prisma.template.create({
      data: {
        organizationId,
        clientId: dto.clientId,
        campaignId: dto.campaignId,
        type: dto.type,
        name: dto.name,
        subjectTemplate: dto.subjectTemplate,
        bodyTemplate: dto.bodyTemplate,
        variablesJson: toPrismaJson(dto.variablesJson),
        isActive: dto.isActive ?? true,
      },
    });
  }

  async render(organizationId: string, templateId: string, variables: Record<string, unknown>) {
    const template = await this.prisma.template.findFirst({
      where: { id: templateId, organizationId },
    });
    if (!template) return null;

    const renderString = (input?: string | null) => {
      if (!input) return null;
      return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
        const value = variables[key];
        return value == null ? '' : String(value);
      });
    };

    const renderedSubject = renderString(template.subjectTemplate);
    const renderedBody = renderString(template.bodyTemplate);

    await this.prisma.documentDispatch.create({
      data: {
        organizationId,
        clientId: template.clientId,
        templateId: template.id,
        kind: template.type,
        status: 'RENDERED',
        subjectLine: renderedSubject,
        bodyText: renderedBody,
        payloadJson: variables as Prisma.InputJsonValue,
      },
    });

    return {
      templateId: template.id,
      type: template.type,
      subject: renderedSubject,
      body: renderedBody,
    };
  }
}
