import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RequestContext } from '../common/types/request-context.type';

const MEMBER_ROLE_VALUES = ['OWNER', 'ADMIN', 'OPERATOR', 'ANALYST', 'BILLING', 'VIEWER'] satisfies MemberRole[];

@Injectable()
export class AccessContextService {
  constructor(private readonly prisma: PrismaService) {}

  async buildFromHeaders(headers: Record<string, unknown>, surface: 'operator' | 'client' | 'system' = 'system') {
    const userId = this.readHeader(headers, 'x-user-id');
    const organizationId = this.readHeader(headers, 'x-organization-id');
    const clientId = this.readHeader(headers, 'x-client-id');
    const roleValue = this.readHeader(headers, 'x-member-role');
    const memberRole = roleValue && MEMBER_ROLE_VALUES.includes(roleValue as MemberRole)
      ? (roleValue as MemberRole)
      : undefined;

    const context: RequestContext = {
      userId,
      organizationId,
      clientId,
      memberRole,
      surface,
      email: this.readHeader(headers, 'x-user-email'),
    };

    if (!userId || !organizationId) {
      return context;
    }

    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId, organizationId, isActive: true },
      include: { user: true, organization: true },
    });

    if (!membership) {
      throw new UnauthorizedException('User is not an active member of the requested organization');
    }

    context.memberRole = membership.role;
    context.membershipId = membership.id;
    context.email = membership.user.email;
    return context;
  }

  async requireOperator(headers: Record<string, unknown>) {
    const context = await this.buildFromHeaders(headers, 'operator');
    if (!context.userId || !context.organizationId) {
      throw new UnauthorizedException('Missing x-user-id or x-organization-id header');
    }
    if (!context.memberRole || !['OWNER', 'ADMIN', 'OPERATOR', 'ANALYST', 'BILLING'].includes(context.memberRole)) {
      throw new UnauthorizedException('Operator access is not allowed for the current membership role');
    }
    return context;
  }

  async requireClient(headers: Record<string, unknown>) {
    const context = await this.buildFromHeaders(headers, 'client');
    if (!context.userId || !context.organizationId || !context.clientId) {
      throw new UnauthorizedException('Missing x-user-id, x-organization-id, or x-client-id header');
    }

    const client = await this.prisma.client.findFirst({
      where: { id: context.clientId, organizationId: context.organizationId },
      select: { id: true },
    });

    if (!client) {
      throw new BadRequestException('Requested client does not belong to the active organization');
    }

    return context;
  }

  private readHeader(headers: Record<string, unknown>, key: string) {
    const raw = headers[key] ?? headers[key.toLowerCase()];
    if (Array.isArray(raw)) return raw[0] ? String(raw[0]).trim() : undefined;
    if (raw == null) return undefined;
    const value = String(raw).trim();
    return value.length ? value : undefined;
  }
}
