import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { RequestContext } from '../common/types/request-context.type';
import { structuredLog } from '../common/observability/structured-logger';

const MEMBER_ROLE_VALUES = ['OWNER', 'ADMIN', 'OPERATOR', 'ANALYST', 'BILLING', 'VIEWER'] satisfies MemberRole[];

type AccessSurface = 'operator' | 'client' | 'system';

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

  async buildFromHeaders(headers: Record<string, unknown>, surface: AccessSurface = 'system') {
    const session = this.readSession(headers);

    if ((surface === 'operator' || surface === 'client') && !session) {
      this.logAuthFailure('missing_signed_session', headers, surface);
      throw new UnauthorizedException('Missing signed session');
    }

    const allowHeaderFallback = surface === 'system' && this.allowSystemHeaderFallback(headers);

    const userId = session?.sub || (allowHeaderFallback ? this.readHeader(headers, 'x-user-id') : undefined);
    const organizationId =
      session?.organizationId || (allowHeaderFallback ? this.readHeader(headers, 'x-organization-id') : undefined);
    const clientId = session?.clientId || (allowHeaderFallback ? this.readHeader(headers, 'x-client-id') : undefined);
    const roleValue = session?.memberRole || (allowHeaderFallback ? this.readHeader(headers, 'x-member-role') : undefined);
    const memberRole = roleValue && MEMBER_ROLE_VALUES.includes(roleValue as MemberRole)
      ? (roleValue as MemberRole)
      : undefined;

    const context: RequestContext = {
      userId,
      organizationId,
      clientId,
      memberRole,
      surface: session?.surface || surface,
      email: session?.email || (allowHeaderFallback ? this.readHeader(headers, 'x-user-email') : undefined),
    };

    if (!userId || !organizationId) {
      return context;
    }

    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId, organizationId, isActive: true },
      include: { user: true, organization: true },
    });

    if (!membership) {
      this.logAuthFailure('inactive_membership', headers, surface, { userId, organizationId });
      throw new UnauthorizedException('User is not an active member of the requested organization');
    }

    context.memberRole = membership.role;
    context.membershipId = membership.id;
    context.email = membership.user.email;
    context.surface = session?.surface || surface;

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
      this.logAuthFailure('missing_operator_context', headers, 'operator');
      throw new UnauthorizedException('Missing operator session context');
    }
    if (!context.memberRole || !['OWNER', 'ADMIN', 'OPERATOR', 'ANALYST', 'BILLING'].includes(context.memberRole)) {
      this.logAuthFailure('operator_role_denied', headers, 'operator', { memberRole: context.memberRole });
      throw new UnauthorizedException('Operator access is not allowed for the current membership role');
    }
    return context;
  }

  async requireClient(headers: Record<string, unknown>) {
    const context = await this.buildFromHeaders(headers, 'client');
    if (!context.userId || !context.organizationId || !context.clientId) {
      this.logAuthFailure('missing_client_context', headers, 'client');
      throw new UnauthorizedException('Missing client session context');
    }

    const client = await this.prisma.client.findFirst({
      where: { id: context.clientId, organizationId: context.organizationId },
      select: { id: true },
    });

    if (!client) {
      this.logAuthFailure('client_org_mismatch', headers, 'client', {
        clientId: context.clientId,
        organizationId: context.organizationId,
      });
      throw new BadRequestException('Requested client does not belong to the active organization');
    }

    return context;
  }

  private allowSystemHeaderFallback(headers: Record<string, unknown>) {
    const enabled = (process.env.ALLOW_SYSTEM_HEADER_CONTEXT?.trim() || '').toLowerCase() === 'true';
    if (!enabled) return false;

    const configuredSecret = process.env.SYSTEM_HEADER_CONTEXT_SECRET?.trim();
    if (configuredSecret) {
      const providedSecret = this.readHeader(headers, 'x-orchestrate-internal-secret');
      return providedSecret === configuredSecret;
    }

    return process.env.NODE_ENV !== 'production';
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
    const secret = process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim();
    if (!secret) return null;
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

  private logAuthFailure(
    reason: string,
    headers: Record<string, unknown>,
    surface: AccessSurface,
    extra: Record<string, unknown> = {},
  ) {
    structuredLog('warn', 'auth.failure', {
      reason,
      surface,
      requestId: this.readHeader(headers, 'x-request-id'),
      correlationId: this.readHeader(headers, 'x-correlation-id'),
      ...extra,
    });
  }
}
