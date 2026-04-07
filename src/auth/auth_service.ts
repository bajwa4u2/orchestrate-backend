import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { MemberRole, OrganizationType, SubscriptionStatus } from '@prisma/client';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { ClientRegisterDto } from './dto/client-register.dto';
import { LoginDto } from './dto/login.dto';
import { OperatorBootstrapDto } from './dto/operator-bootstrap.dto';
import { RequestEmailVerificationDto } from './dto/request-email-verification.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

type SessionSurface = 'client' | 'operator';

type SessionPayload = {
  typ: 'session' | 'email_verification' | 'password_reset';
  sub: string;
  email: string;
  organizationId?: string;
  clientId?: string;
  memberRole?: MemberRole;
  fullName?: string;
  surface?: SessionSurface;
  exp: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly emailsService: EmailsService,
    private readonly prisma: PrismaService,
  ) {}

  async resolveRequest(headers: Record<string, unknown>) {
    return this.accessContextService.buildFromHeaders(headers);
  }

  async me(headers: Record<string, unknown>) {
    const context = await this.accessContextService.buildFromHeaders(headers);
    if (!context.userId) throw new UnauthorizedException('No active session');

    const user = await this.prisma.user.findUnique({
      where: { id: context.userId },
      include: {
        memberships: {
          where: context.organizationId
            ? { organizationId: context.organizationId, isActive: true }
            : { isActive: true },
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) throw new UnauthorizedException('No active session');

    const membership = user.memberships[0];
    const metadata = this.asObject(user.metadataJson);
    const auth = this.asObject(metadata.auth);

    const clientSnapshot =
      context.surface === 'client' && context.clientId
        ? await this.fetchClientSnapshot(context.clientId)
        : null;

    return {
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        emailVerified: Boolean(auth.emailVerifiedAt),
        setupCompleted: clientSnapshot?.setupCompleted ?? false,
        selectedPlan: clientSnapshot?.selectedPlan ?? null,
        subscriptionStatus: clientSnapshot?.subscriptionStatus ?? 'none',
      },
      session: {
        organizationId: context.organizationId,
        clientId: context.clientId,
        memberRole: context.memberRole,
        surface: context.surface,
      },
      workspace: membership
        ? {
            organizationId: membership.organizationId,
            displayName: membership.organization.displayName,
            legalName: membership.organization.legalName,
            role: membership.role,
            type: membership.organization.type,
          }
        : null,
      setup: clientSnapshot
        ? {
            setupCompleted: clientSnapshot.setupCompleted,
            setupCompletedAt: clientSnapshot.setupCompletedAt,
            selectedPlan: clientSnapshot.selectedPlan,
            subscriptionStatus: clientSnapshot.subscriptionStatus,
            setup: clientSnapshot.setup,
          }
        : null,
    };
  }

  async registerClient(dto: ClientRegisterDto) {
    const email = dto.email.trim().toLowerCase();
    await this.ensureEmailAvailable(email);

    const passwordHash = this.hashPassword(dto.password);
    const slugBase = this.slugify(dto.companyName);
    const organizationSlug = await this.nextUniqueSlug(slugBase || 'client');

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          fullName: dto.fullName.trim(),
          passwordHash,
          metadataJson: {
            auth: {
              emailVerifiedAt: null,
            },
          },
        },
      });

      const organization = await tx.organization.create({
        data: {
          slug: organizationSlug,
          legalName: dto.companyName.trim(),
          displayName: dto.companyName.trim(),
          type: OrganizationType.CLIENT_ACCOUNT,
        },
      });

      await tx.workspaceMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: 'OWNER',
        },
      });

      const client = await tx.client.create({
        data: {
          organizationId: organization.id,
          createdById: user.id,
          legalName: dto.companyName.trim(),
          displayName: dto.companyName.trim(),
          status: 'ACTIVE',
          websiteUrl: dto.websiteUrl?.trim(),
          primaryEmail: email,
          billingEmail: email,
          legalEmail: email,
          opsEmail: email,
          primaryContactName: dto.fullName.trim(),
          billingContactName: dto.fullName.trim(),
          legalContactName: dto.fullName.trim(),
          opsContactName: dto.fullName.trim(),
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          metadataJson: {
            auth: { emailVerifiedAt: null },
            clientAccess: {
              defaultClientId: client.id,
            },
          },
        },
      });

      return { user, organization, client };
    });

    const verificationToken = this.signToken({
      typ: 'email_verification',
      sub: result.user.id,
      email,
      organizationId: result.organization.id,
      clientId: result.client.id,
      memberRole: 'OWNER',
      surface: 'client',
      fullName: result.user.fullName,
      exp: this.expiresInSeconds(48 * 3600),
    });

    await this.sendVerificationEmail({
      email,
      name: result.user.fullName,
      verificationUrl: this.buildFrontendUrl('/client/verify-email', verificationToken),
    });

    await this.sendWelcomeEmail({
      email,
      name: result.user.fullName,
    });

    return {
      requiresVerification: true,
      email,
    };
  }

  async loginClient(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { memberships: { include: { organization: true }, where: { isActive: true } } },
    });

    if (!user?.passwordHash || !this.verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const membership =
      user.memberships.find((item) => item.organization.type === 'CLIENT_ACCOUNT') ??
      user.memberships[0];
    if (!membership) throw new UnauthorizedException('No client workspace is available for this account');

    const clientId = await this.resolveClientId(user.id, membership.organizationId);
    if (!clientId) throw new UnauthorizedException('No client account is linked to this workspace');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = this.signToken({
      typ: 'session',
      sub: user.id,
      email: user.email,
      organizationId: membership.organizationId,
      clientId,
      memberRole: membership.role,
      surface: 'client',
      fullName: user.fullName,
      exp: this.expiresInSeconds(30 * 24 * 3600),
    });

    const clientSnapshot = await this.fetchClientSnapshot(clientId);

    return this.buildSessionResponse({
      token,
      user,
      organization: membership.organization,
      clientId,
      memberRole: membership.role,
      surface: 'client',
      clientSnapshot,
    });
  }

  async bootstrapOperator(dto: OperatorBootstrapDto) {
    const email = dto.email.trim().toLowerCase();
    await this.ensureOperatorBootstrapAllowed(email);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { organization: true }, where: { isActive: true } } },
    });

    if (
      existing?.memberships.some((item) =>
        this.isOperatorOrganization(item.organization.type, item.organization.isInternal),
      )
    ) {
      throw new BadRequestException('Operator access already exists for this account');
    }

    const passwordHash = this.hashPassword(dto.password);
    const workspaceName = dto.workspaceName?.trim() || 'Orchestrate Operations';
    const organizationSlug = await this.nextUniqueSlug(this.slugify(workspaceName) || 'orchestrate-ops');

    const result = await this.prisma.$transaction(async (tx) => {
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { fullName: dto.fullName.trim(), passwordHash, isActive: true },
          })
        : await tx.user.create({
            data: {
              email,
              fullName: dto.fullName.trim(),
              passwordHash,
              metadataJson: { auth: { emailVerifiedAt: new Date().toISOString() } },
            },
          });

      const organization = await tx.organization.create({
        data: {
          slug: organizationSlug,
          legalName: workspaceName,
          displayName: workspaceName,
          type: OrganizationType.INTERNAL,
          isInternal: true,
        },
      });

      await tx.workspaceMember.create({
        data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
      });

      return { user, organization };
    });

    const token = this.signToken({
      typ: 'session',
      sub: result.user.id,
      email: result.user.email,
      organizationId: result.organization.id,
      memberRole: 'OWNER',
      surface: 'operator',
      fullName: result.user.fullName,
      exp: this.expiresInSeconds(30 * 24 * 3600),
    });

    return this.buildSessionResponse({
      token,
      user: result.user,
      organization: result.organization,
      memberRole: 'OWNER',
      surface: 'operator',
    });
  }

  async loginOperator(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { memberships: { include: { organization: true }, where: { isActive: true } } },
    });

    if (!user?.passwordHash || !this.verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    const membership = user.memberships.find((item) =>
      this.isOperatorOrganization(item.organization.type, item.organization.isInternal),
    );
    if (!membership) throw new UnauthorizedException('Operator access is not available for this account');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = this.signToken({
      typ: 'session',
      sub: user.id,
      email: user.email,
      organizationId: membership.organizationId,
      memberRole: membership.role,
      surface: 'operator',
      fullName: user.fullName,
      exp: this.expiresInSeconds(30 * 24 * 3600),
    });

    return this.buildSessionResponse({
      token,
      user,
      organization: membership.organization,
      memberRole: membership.role,
      surface: 'operator',
    });
  }

  async logout() {
    return { ok: true };
  }

  async requestPasswordReset(dto: RequestPasswordResetDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user) return { ok: true };

    const token = this.signToken({
      typ: 'password_reset',
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      exp: this.expiresInSeconds(2 * 3600),
    });

    await this.sendPasswordResetEmail({
      email: user.email,
      name: user.fullName,
      resetUrl: this.buildFrontendUrl('/client/reset-password', token),
    });

    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const payload = this.verifyToken(dto.token, 'password_reset');
    const passwordHash = this.hashPassword(dto.newPassword);
    await this.prisma.user.update({ where: { id: payload.sub }, data: { passwordHash } });
    return { ok: true };
  }

  async requestEmailVerification(dto: RequestEmailVerificationDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user) return { ok: true };

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id, isActive: true },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    const membership = memberships[0];
    const clientId = membership ? await this.resolveClientId(user.id, membership.organizationId) : undefined;

    const token = this.signToken({
      typ: 'email_verification',
      sub: user.id,
      email: user.email,
      organizationId: membership?.organizationId,
      clientId,
      memberRole: membership?.role,
      surface:
        membership &&
        this.isOperatorOrganization(membership.organization.type, membership.organization.isInternal)
          ? 'operator'
          : 'client',
      fullName: user.fullName,
      exp: this.expiresInSeconds(48 * 3600),
    });

    await this.sendVerificationEmail({
      email: user.email,
      name: user.fullName,
      verificationUrl: this.buildFrontendUrl('/client/verify-email', token),
    });

    return { ok: true };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const payload = this.verifyToken(dto.token, 'email_verification');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new NotFoundException('Account not found');

    const metadata = this.asObject(user.metadataJson);
    const auth = this.asObject(metadata.auth);
    auth.emailVerifiedAt = new Date().toISOString();
    metadata.auth = auth;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { metadataJson: metadata },
    });

    return { ok: true };
  }

  verifySessionToken(token: string) {
    return this.verifyToken(token, 'session');
  }

  async sendVerificationEmail(input: { email: string; verificationUrl: string; name?: string; brandName?: string }) {
    const brandName = input.brandName?.trim() || process.env.EMAIL_BRAND_NAME?.trim() || 'Orchestrate';
    return this.emailsService.sendDirectEmail({
      emailEvent: 'account_email_verification',
      toEmail: input.email,
      toName: input.name,
      subject: `Verify your ${brandName} account`,
      bodyText: [
        `Your ${brandName} verification link is ready.`,
        `Open this link to verify your account: ${input.verificationUrl}`,
        `If you did not request this, you can ignore this email.`,
      ].join('\n\n'),
      templateVariables: {
        verifyUrl: input.verificationUrl,
        verify_url: input.verificationUrl,
        actionUrl: input.verificationUrl,
        action_url: input.verificationUrl,
      },
    });
  }

  async sendPasswordResetEmail(input: { email: string; resetUrl: string; name?: string; brandName?: string }) {
    const brandName = input.brandName?.trim() || process.env.EMAIL_BRAND_NAME?.trim() || 'Orchestrate';
    return this.emailsService.sendDirectEmail({
      emailEvent: 'account_password_reset',
      toEmail: input.email,
      toName: input.name,
      subject: `Reset your ${brandName} password`,
      bodyText: [
        `A password reset was requested for your ${brandName} account.`,
        `Open this link to choose a new password: ${input.resetUrl}`,
        `If you did not request this, you can ignore this email.`,
      ].join('\n\n'),
      templateVariables: {
        resetUrl: input.resetUrl,
        reset_url: input.resetUrl,
        actionUrl: input.resetUrl,
        action_url: input.resetUrl,
      },
    });
  }

  async sendWelcomeEmail(input: { email: string; appUrl?: string; name?: string; brandName?: string }) {
    const brandName = input.brandName?.trim() || process.env.EMAIL_BRAND_NAME?.trim() || 'Orchestrate';
    const appUrl = input.appUrl?.trim() || process.env.APP_BASE_URL?.trim() || 'https://orchestrateops.com';
    return this.emailsService.sendDirectEmail({
      emailEvent: 'account_welcome',
      toEmail: input.email,
      toName: input.name,
      subject: `Welcome to ${brandName}`,
      bodyText: [`Your ${brandName} account is active.`, `Open ${appUrl} to continue.`].join('\n\n'),
      templateVariables: {
        dashboardUrl: appUrl,
        dashboard_url: appUrl,
        portal_url: appUrl,
        app_url: appUrl,
        name: input.name,
        client_name: input.name,
      },
    });
  }

  private buildSessionResponse(input: {
    token: string;
    user: { id: string; email: string; fullName: string; metadataJson?: unknown };
    organization: { id: string; displayName: string; legalName: string; type: OrganizationType; isInternal?: boolean };
    memberRole?: MemberRole;
    clientId?: string;
    surface: SessionSurface;
    clientSnapshot?: Awaited<ReturnType<AuthService['fetchClientSnapshot']>> | null;
  }) {
    const metadata = this.asObject(input.user.metadataJson);
    const auth = this.asObject(metadata.auth);
    const snapshot = input.clientSnapshot ?? null;

    return {
      token: input.token,
      user: {
        id: input.user.id,
        email: input.user.email,
        fullName: input.user.fullName,
        emailVerified: Boolean(auth.emailVerifiedAt),
        setupCompleted: snapshot?.setupCompleted ?? false,
        selectedPlan: snapshot?.selectedPlan ?? null,
        subscriptionStatus: snapshot?.subscriptionStatus ?? 'none',
      },
      workspace: {
        organizationId: input.organization.id,
        displayName: input.organization.displayName,
        legalName: input.organization.legalName,
        type: input.organization.type,
      },
      session: {
        surface: input.surface,
        memberRole: input.memberRole,
        clientId: input.clientId,
      },
      setup: snapshot
        ? {
            setupCompleted: snapshot.setupCompleted,
            setupCompletedAt: snapshot.setupCompletedAt,
            selectedPlan: snapshot.selectedPlan,
            subscriptionStatus: snapshot.subscriptionStatus,
            setup: snapshot.setup,
          }
        : null,
    };
  }

  private async fetchClientSnapshot(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      include: {
        subscriptions: {
          include: { plan: true },
          where: {
            status: {
              in: [
                SubscriptionStatus.INCOMPLETE,
                SubscriptionStatus.TRIALING,
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.PAST_DUE,
                SubscriptionStatus.PAUSED,
              ],
            },
          },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
      },
    });

    if (!client) return null;

    const activeSubscription = client.subscriptions[0] ?? null;
    const scope = Array.isArray(client.scopeJson)
      ? client.scopeJson.map((item) => String(item))
      : [];

    return {
      clientId: client.id,
      organizationId: client.organizationId,
      setupCompleted: Boolean(client.setupCompletedAt),
      setupCompletedAt: client.setupCompletedAt?.toISOString() ?? null,
      selectedPlan: client.selectedPlan ?? null,
      subscriptionStatus: activeSubscription?.status?.toLowerCase() ?? 'none',
      subscriptionAmount: activeSubscription?.amountCents ?? null,
      subscriptionInterval: activeSubscription?.plan?.interval?.toLowerCase() ?? null,
      setup: client.setupCompletedAt
        ? {
            country: client.country ?? null,
            area: client.area ?? null,
            industry: client.industry ?? null,
            scope,
          }
        : null,
    };
  }

  private async ensureEmailAvailable(email: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('An account with this email already exists');
  }

  private async ensureOperatorBootstrapAllowed(email: string) {
    const allowlist = (process.env.OPERATOR_BOOTSTRAP_ALLOWLIST || process.env.OPERATOR_BOOTSTRAP_EMAIL || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (!allowlist.length) return;
    if (!allowlist.includes(email)) {
      throw new UnauthorizedException('Operator bootstrap is not allowed for this email');
    }
  }

  private async resolveClientId(userId: string, organizationId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const metadata = this.asObject(user?.metadataJson);
    const clientAccess = this.asObject(metadata.clientAccess);
    if (typeof clientAccess.defaultClientId === 'string' && clientAccess.defaultClientId.trim().length) {
      return clientAccess.defaultClientId.trim();
    }
    const client = await this.prisma.client.findFirst({
      where: {
        organizationId,
        OR: [
          { primaryEmail: user?.email },
          { billingEmail: user?.email },
          { legalEmail: user?.email },
          { opsEmail: user?.email },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return client?.id;
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const digest = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${digest}`;
  }

  private verifyPassword(password: string, stored: string) {
    const [salt, digest] = stored.split(':');
    if (!salt || !digest) return false;
    const computed = scryptSync(password, salt, 64);
    const expected = Buffer.from(digest, 'hex');
    return expected.length === computed.length && timingSafeEqual(expected, computed);
  }

  private signToken(payload: SessionPayload) {
    const secret = process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim() || 'orchestrate-dev-secret';
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  private verifyToken(token: string, expectedType: SessionPayload['typ']) {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) throw new UnauthorizedException('Invalid token');
    const secret = process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim() || 'orchestrate-dev-secret';
    const expectedSignature = createHmac('sha256', secret).update(encoded).digest('base64url');
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      throw new UnauthorizedException('Invalid token');
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.typ != expectedType) throw new UnauthorizedException('Invalid token type');
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token has expired');
    }
    return payload;
  }

  private expiresInSeconds(offsetSeconds: number) {
    return Math.floor(Date.now() / 1000) + offsetSeconds;
  }

  private slugify(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  private async nextUniqueSlug(base: string) {
    let attempt = base;
    let counter = 2;
    while (await this.prisma.organization.findUnique({ where: { slug: attempt } })) {
      attempt = `${base}-${counter}`;
      counter += 1;
    }
    return attempt;
  }

  private buildFrontendUrl(path: string, token: string) {
    const base = (process.env.APP_BASE_URL?.trim() || 'https://orchestrateops.com').replace(/\/$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}?token=${encodeURIComponent(token)}`;
  }

  private asObject(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, any>) }
      : {};
  }

  private isOperatorOrganization(type: OrganizationType, isInternal?: boolean) {
    return isInternal || type === 'PLATFORM' || type === 'INTERNAL';
  }
}
