import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RequestContext } from '../common/types/request-context.type';
import { createHmac, timingSafeEqual } from 'crypto';

const MEMBER_ROLE_VALUES = ['OWNER', 'ADMIN', 'OPERATOR', 'ANALYST', 'BILLING', 'VIEWER'] satisfies MemberRole[];

type SessionPayload = {
  typ: 'session' | 'email_verification' | 'password_reset';
  sub: string;
  email: string;
  organizationId?: string;
  clientId?: string;
  memberRole?: MemberRole;
  surface?: 'operator' | 'client';
  exp: number;
};

@Injectable()
export class AccessContextService {
  constructor(private readonly prisma: PrismaService) {}

  async buildFromHeaders(headers: Record<string, unknown>, surface: 'operator' | 'client' | 'system' = 'system') {
    const session = this.readSession(headers);
    const userId = session?.sub || this.readHeader(headers, 'x-user-id');
    const organizationId = session?.organizationId || this.readHeader(headers, 'x-organization-id');
    const clientId = session?.clientId || this.readHeader(headers, 'x-client-id');
    const roleValue = session?.memberRole || this.readHeader(headers, 'x-member-role');
    const memberRole = roleValue && MEMBER_ROLE_VALUES.includes(roleValue as MemberRole)
      ? (roleValue as MemberRole)
      : undefined;

    const context: RequestContext = {
      userId,
      organizationId,
      clientId,
      memberRole,
      surface: session?.surface || surface,
      email: session?.email || this.readHeader(headers, 'x-user-email'),
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
    if (!context.clientId && context.surface === 'client') {
      const client = await this.prisma.client.findFirst({
        where: {
          organizationId,
          OR: [
            { primaryEmail: membership.user.email },
            { billingEmail: membership.user.email },
            { legalEmail: membership.user.email },
            { opsEmail: membership.user.email },
          ],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      context.clientId = client?.id;
    }
    return context;
  }

  async requireOperator(headers: Record<string, unknown>) {
    const context = await this.buildFromHeaders(headers, 'operator');
    if (!context.userId || !context.organizationId) {
      throw new UnauthorizedException('Missing operator session context');
    }
    if (!context.memberRole || !['OWNER', 'ADMIN', 'OPERATOR', 'ANALYST', 'BILLING'].includes(context.memberRole)) {
      throw new UnauthorizedException('Operator access is not allowed for the current membership role');
    }
    return context;
  }

  async requireClient(headers: Record<string, unknown>) {
    const context = await this.buildFromHeaders(headers, 'client');
    if (!context.userId || !context.organizationId || !context.clientId) {
      throw new UnauthorizedException('Missing client session context');
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

  private readSession(headers: Record<string, unknown>) {
    const authorization = this.readHeader(headers, 'authorization');
    if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) return null;
    const token = authorization.slice(7).trim();
    if (!token) return null;
    return this.verifyToken(token);
  }

  private verifyToken(token: string) {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;
    const secret = process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim() || 'orchestrate-dev-secret';
    const expectedSignature = createHmac('sha256', secret).update(encoded).digest('base64url');
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expectedSignature)) return null;
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.typ !== 'session') return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  }

  private readHeader(headers: Record<string, unknown>, key: string) {
    const raw = headers[key] ?? headers[key.toLowerCase()];
    if (Array.isArray(raw)) return raw[0] ? String(raw[0]).trim() : undefined;
    if (raw == null) return undefined;
    const value = String(raw).trim();
    return value.length ? value : undefined;
  }
}
