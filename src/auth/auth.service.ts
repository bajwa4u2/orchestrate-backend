import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthProvider, MemberRole, OrganizationType, Prisma } from '@prisma/client';
import { createHmac, createPublicKey, randomBytes, scryptSync, timingSafeEqual, verify as verifySignature } from 'crypto';
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

type OAuthLoginInput = {
  accessToken?: string;
  idToken?: string;
  email?: string;
  fullName?: string;
};

type ExternalIdentityProfile = {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
  rawClaims: Record<string, unknown>;
};

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtPayload = Record<string, unknown> & {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
  nonce?: string;
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
        authIdentities: { orderBy: { createdAt: 'asc' } },
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
    const onboarding = this.getOnboardingState(metadata, {
      hasWorkspace: Boolean(membership),
      hasPassword: Boolean(user.passwordHash),
      fullName: user.fullName,
    });

    const clientState = context.clientId
      ? await this.loadClientState(context.clientId)
      : null;

    return {
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        emailVerified: Boolean(auth.emailVerifiedAt),
        setupCompleted: clientState?.setupCompleted ?? false,
        selectedPlan: clientState?.selectedPlan ?? null,
        selectedTier: clientState?.selectedTier ?? null,
        subscriptionStatus: clientState?.subscriptionStatus ?? 'none',
      },
      auth: {
        methods: this.listAuthMethods(user.authIdentities, user.passwordHash),
        primaryProvider: this.resolvePrimaryProvider(user.authIdentities, user.passwordHash),
        canAddPassword: !user.passwordHash,
      },
      onboarding,
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
      setup: clientState
        ? {
            setupCompleted: clientState.setupCompleted,
            setupCompletedAt: clientState.setupCompletedAt,
            selectedPlan: clientState.selectedPlan,
            selectedTier: clientState.selectedTier,
            subscriptionStatus: clientState.subscriptionStatus,
            country: clientState.country,
            area: clientState.area,
            industry: clientState.industry,
            scope: clientState.scope,
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
          metadataJson: this.mergeUserMetadata(null, {
            emailVerifiedAt: null,
            hasPassword: true,
            primaryProvider: 'PASSWORD',
            profileComplete: true,
            businessComplete: true,
            workspaceCreated: true,
            passwordComplete: true,
          }),
        },
      });

      await tx.authIdentity.create({
        data: {
          userId: user.id,
          provider: AuthProvider.PASSWORD,
          providerUserId: user.id,
          email,
          emailVerified: false,
          metadataJson: {
            source: 'client_register',
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

      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          metadataJson: this.mergeUserMetadata(user.metadataJson, {
            emailVerifiedAt: null,
            hasPassword: true,
            primaryProvider: 'PASSWORD',
            defaultClientId: client.id,
            profileComplete: true,
            businessComplete: true,
            workspaceCreated: true,
            passwordComplete: true,
          }),
        },
      });

      return { user: updatedUser, organization, client };
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
      include: {
        authIdentities: true,
        memberships: { include: { organization: true }, where: { isActive: true } },
      },
    });

    if (!user?.passwordHash || !this.verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    if (!this.isEmailVerified(user.metadataJson)) {
      throw new UnauthorizedException('Please verify your email first');
    }

    const membership =
      user.memberships.find((item) => item.organization.type === 'CLIENT_ACCOUNT') ??
      user.memberships[0];

    if (!membership) {
      return this.issueClientSession(user, null, undefined, undefined, null);
    }

    const clientId = await this.resolveClientId(user.id, membership.organizationId);
    const clientState = clientId ? await this.loadClientState(clientId) : null;

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    return this.issueClientSession(user, membership.organization, clientId, membership.role, clientState);
  }

  async loginClientWithGoogle(input: OAuthLoginInput) {
    const profile = input.accessToken
      ? await this.verifyGoogleAccessToken(input)
      : await this.verifyGoogleIdentityToken(input);
    return this.loginClientWithExternalIdentity(profile);
  }

  async loginClientWithMicrosoft(input: OAuthLoginInput) {
    const profile = await this.verifyMicrosoftIdentityToken(input);
    return this.loginClientWithExternalIdentity(profile);
  }

  async loginClientWithApple(input: OAuthLoginInput) {
    const profile = await this.verifyAppleIdentityToken(input);
    return this.loginClientWithExternalIdentity(profile);
  }

  async bootstrapOperator(dto: OperatorBootstrapDto) {
    const email = dto.email.trim().toLowerCase();
    await this.ensureOperatorBootstrapAllowed(email);

    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { authIdentities: true, memberships: { include: { organization: true }, where: { isActive: true } } },
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
            data: {
              fullName: dto.fullName.trim(),
              passwordHash,
              isActive: true,
              metadataJson: this.mergeUserMetadata(existing.metadataJson, {
                emailVerifiedAt: this.currentIso(),
                hasPassword: true,
                primaryProvider: this.resolvePrimaryProvider(existing.authIdentities, passwordHash),
                profileComplete: true,
                passwordComplete: true,
              }),
            },
          })
        : await tx.user.create({
            data: {
              email,
              fullName: dto.fullName.trim(),
              passwordHash,
              metadataJson: this.mergeUserMetadata(null, {
                emailVerifiedAt: this.currentIso(),
                hasPassword: true,
                primaryProvider: 'PASSWORD',
                profileComplete: true,
                passwordComplete: true,
              }),
            },
          });

      await this.ensurePasswordIdentity(tx, user.id, user.email, true);

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

      const refreshedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          metadataJson: this.mergeUserMetadata(user.metadataJson, {
            emailVerifiedAt: this.currentIso(),
            hasPassword: true,
            primaryProvider: this.resolvePrimaryProvider(existing?.authIdentities ?? [], passwordHash),
            profileComplete: true,
            workspaceCreated: true,
            passwordComplete: true,
          }),
        },
      });

      return { user: refreshedUser, organization };
    });

    await this.prisma.user.update({ where: { id: result.user.id }, data: { lastLoginAt: new Date() } });

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
      include: { authIdentities: true, memberships: { include: { organization: true }, where: { isActive: true } } },
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
    if (!user || !user.passwordHash) return { ok: true };

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
    const user = await this.prisma.user.update({
      where: { id: payload.sub },
      data: {
        passwordHash,
        metadataJson: {
          ...(this.asObject((await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { metadataJson: true } }))?.metadataJson)),
        },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.ensurePasswordIdentity(tx, user.id, user.email, this.isEmailVerified(user.metadataJson));
      await tx.user.update({
        where: { id: user.id },
        data: {
          metadataJson: this.mergeUserMetadata(user.metadataJson, {
            hasPassword: true,
            passwordComplete: true,
          }),
        },
      });
    });

    return { ok: true };
  }

  async requestEmailVerification(dto: RequestEmailVerificationDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user || this.isPlaceholderEmail(user.email)) return { ok: true };

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

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        metadataJson: this.mergeUserMetadata(user.metadataJson, {
          emailVerifiedAt: this.currentIso(),
        }),
      },
    });

    await this.prisma.authIdentity.updateMany({
      where: { userId: user.id, email: user.email },
      data: { emailVerified: true },
    });

    const membership = payload.organizationId
      ? await this.prisma.workspaceMember.findFirst({
          where: {
            userId: user.id,
            organizationId: payload.organizationId,
            isActive: true,
          },
          include: { organization: true },
        })
      : await this.prisma.workspaceMember.findFirst({
          where: { userId: user.id, isActive: true },
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
        });

    if (!membership) {
      const hydrated = await this.prisma.user.findUnique({ where: { id: user.id }, include: { authIdentities: true } });
      if (!hydrated) return { ok: true };
      return this.issueClientSession(hydrated, null, undefined, undefined, null);
    }

    const clientId =
      payload.clientId ||
      (payload.surface === 'client'
        ? await this.resolveClientId(user.id, membership.organizationId)
        : undefined);

    const clientState = clientId ? await this.loadClientState(clientId) : null;

    return this.buildSessionResponse({
      token: this.signToken({
        typ: 'session',
        sub: updatedUser.id,
        email: updatedUser.email,
        organizationId: membership.organizationId,
        clientId,
        memberRole: membership.role,
        surface:
          payload.surface ||
          (this.isOperatorOrganization(membership.organization.type, membership.organization.isInternal)
            ? 'operator'
            : 'client'),
        fullName: updatedUser.fullName,
        exp: this.expiresInSeconds(30 * 24 * 3600),
      }),
      user: hydratedOrThrow(await this.prisma.user.findUnique({ where: { id: updatedUser.id }, include: { authIdentities: true } })),
      organization: membership.organization,
      clientId,
      memberRole: membership.role,
      surface:
        payload.surface ||
        (this.isOperatorOrganization(membership.organization.type, membership.organization.isInternal)
          ? 'operator'
          : 'client'),
      clientState,
    });
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

  private async loginClientWithExternalIdentity(profile: ExternalIdentityProfile) {
    const user = await this.prisma.$transaction(async (tx) => {
      const existingIdentity = await tx.authIdentity.findUnique({
        where: {
          provider_providerUserId: {
            provider: profile.provider,
            providerUserId: profile.providerUserId,
          },
        },
        include: { user: true },
      });

      if (existingIdentity) {
        const updatedUser = await tx.user.update({
          where: { id: existingIdentity.userId },
          data: {
            fullName:
              profile.fullName && this.shouldReplaceName(existingIdentity.user.fullName)
                ? profile.fullName
                : undefined,
            email:
              this.shouldReplaceLoginEmail(existingIdentity.user.email, profile.email) && profile.email
                ? profile.email
                : undefined,
            metadataJson: this.mergeUserMetadata(existingIdentity.user.metadataJson, {
              emailVerifiedAt: profile.emailVerified && profile.email && !this.isPlaceholderEmail(profile.email)
                ? this.currentIso()
                : undefined,
              primaryProvider: profile.provider,
              profileComplete: Boolean((profile.fullName || existingIdentity.user.fullName || '').trim()),
            }),
          },
        });

        await tx.authIdentity.update({
          where: { id: existingIdentity.id },
          data: {
            email: profile.email,
            emailVerified: profile.emailVerified,
            metadataJson: profile.rawClaims as Prisma.InputJsonValue,
          },
        });

        return tx.user.findUniqueOrThrow({ where: { id: updatedUser.id }, include: { authIdentities: true, memberships: { include: { organization: true }, where: { isActive: true } } } });
      }

      const trustedEmail = profile.email && !this.isPlaceholderEmail(profile.email) && profile.emailVerified
        ? profile.email
        : null;

      const matchedUser = trustedEmail
        ? await tx.user.findUnique({ where: { email: trustedEmail }, include: { authIdentities: true } })
        : null;

      if (matchedUser) {
        await tx.authIdentity.create({
          data: {
            userId: matchedUser.id,
            provider: profile.provider,
            providerUserId: profile.providerUserId,
            email: profile.email,
            emailVerified: profile.emailVerified,
            metadataJson: profile.rawClaims as Prisma.InputJsonValue,
          },
        });

        const updated = await tx.user.update({
          where: { id: matchedUser.id },
          data: {
            fullName:
              profile.fullName && this.shouldReplaceName(matchedUser.fullName)
                ? profile.fullName
                : undefined,
            metadataJson: this.mergeUserMetadata(matchedUser.metadataJson, {
              emailVerifiedAt: profile.emailVerified ? this.currentIso() : undefined,
              primaryProvider: this.resolvePrimaryProvider([
                ...matchedUser.authIdentities,
                { provider: profile.provider } as { provider: AuthProvider },
              ], matchedUser.passwordHash),
              profileComplete: Boolean((profile.fullName || matchedUser.fullName || '').trim()),
            }),
          },
        });

        return tx.user.findUniqueOrThrow({ where: { id: updated.id }, include: { authIdentities: true, memberships: { include: { organization: true }, where: { isActive: true } } } });
      }

      const loginEmail = profile.email && !this.isPlaceholderEmail(profile.email)
        ? profile.email
        : this.buildPlaceholderEmail(profile.provider, profile.providerUserId);
      const fullName = (profile.fullName || '').trim() || this.defaultNameForProvider(profile.provider);

      const createdUser = await tx.user.create({
        data: {
          email: loginEmail,
          fullName,
          metadataJson: this.mergeUserMetadata(null, {
            emailVerifiedAt: profile.emailVerified && profile.email && !this.isPlaceholderEmail(profile.email)
              ? this.currentIso()
              : null,
            primaryProvider: profile.provider,
            hasPassword: false,
            profileComplete: Boolean((profile.fullName || '').trim()),
            businessComplete: false,
            workspaceCreated: false,
            passwordComplete: false,
          }),
        },
      });

      await tx.authIdentity.create({
        data: {
          userId: createdUser.id,
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
          emailVerified: profile.emailVerified,
          metadataJson: profile.rawClaims as Prisma.InputJsonValue,
        },
      });

      return tx.user.findUniqueOrThrow({ where: { id: createdUser.id }, include: { authIdentities: true, memberships: { include: { organization: true }, where: { isActive: true } } } });
    });

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const membership =
      user.memberships.find((item) => item.organization.type === 'CLIENT_ACCOUNT') ??
      user.memberships[0];

    if (!membership) {
      return this.issueClientSession(user, null, undefined, undefined, null);
    }

    const clientId = await this.resolveClientId(user.id, membership.organizationId);
    const clientState = clientId ? await this.loadClientState(clientId) : null;

    return this.issueClientSession(user, membership.organization, clientId, membership.role, clientState);
  }

  private issueClientSession(
    user: {
      id: string;
      email: string;
      fullName: string;
      passwordHash?: string | null;
      metadataJson?: unknown;
      authIdentities?: Array<{ provider: AuthProvider }>;
    },
    organization: { id: string; displayName: string; legalName: string; type: OrganizationType; isInternal?: boolean } | null,
    clientId?: string,
    memberRole?: MemberRole,
    clientState?: {
      setupCompleted: boolean;
      setupCompletedAt: string | null;
      selectedPlan: string | null;
      selectedTier?: string | null;
      subscriptionStatus: string;
      country: string | null;
      area: string | null;
      industry: string | null;
      scope: Record<string, unknown> | null;
    } | null,
  ) {
    const token = this.signToken({
      typ: 'session',
      sub: user.id,
      email: user.email,
      organizationId: organization?.id,
      clientId,
      memberRole,
      surface: 'client',
      fullName: user.fullName,
      exp: this.expiresInSeconds(30 * 24 * 3600),
    });

    return this.buildSessionResponse({
      token,
      user,
      organization,
      clientId,
      memberRole,
      surface: 'client',
      clientState,
    });
  }

  private buildSessionResponse(input: {
    token: string;
    user: { id: string; email: string; fullName: string; passwordHash?: string | null; metadataJson?: unknown; authIdentities?: Array<{ provider: AuthProvider }> };
    organization?: { id: string; displayName: string; legalName: string; type: OrganizationType; isInternal?: boolean } | null;
    memberRole?: MemberRole;
    clientId?: string;
    surface: SessionSurface;
    clientState?: {
      setupCompleted: boolean;
      setupCompletedAt: string | null;
      selectedPlan: string | null;
      selectedTier?: string | null;
      subscriptionStatus: string;
      country: string | null;
      area: string | null;
      industry: string | null;
      scope: Record<string, unknown> | null;
    } | null;
  }) {
    const metadata = this.asObject(input.user.metadataJson);
    const auth = this.asObject(metadata.auth);
    const onboarding = this.getOnboardingState(metadata, {
      hasWorkspace: Boolean(input.organization),
      hasPassword: Boolean(input.user.passwordHash),
      fullName: input.user.fullName,
      clientState: input.clientState ?? null,
    });

    return {
      token: input.token,
      user: {
        id: input.user.id,
        email: input.user.email,
        fullName: input.user.fullName,
        emailVerified: Boolean(auth.emailVerifiedAt),
        setupCompleted: input.clientState?.setupCompleted ?? false,
        selectedPlan: input.clientState?.selectedPlan ?? null,
        selectedTier: input.clientState?.selectedTier ?? null,
        subscriptionStatus: input.clientState?.subscriptionStatus ?? 'none',
      },
      auth: {
        methods: this.listAuthMethods(input.user.authIdentities, input.user.passwordHash),
        primaryProvider: this.resolvePrimaryProvider(input.user.authIdentities ?? [], input.user.passwordHash),
        canAddPassword: !input.user.passwordHash,
      },
      onboarding,
      workspace: input.organization
        ? {
            organizationId: input.organization.id,
            displayName: input.organization.displayName,
            legalName: input.organization.legalName,
            type: input.organization.type,
          }
        : null,
      session: {
        surface: input.surface,
        memberRole: input.memberRole,
        clientId: input.clientId,
      },
      setup: input.clientState
        ? {
            setupCompleted: input.clientState.setupCompleted,
            setupCompletedAt: input.clientState.setupCompletedAt,
            selectedPlan: input.clientState.selectedPlan,
            selectedTier: input.clientState.selectedTier ?? null,
            subscriptionStatus: input.clientState.subscriptionStatus,
            country: input.clientState.country,
            area: input.clientState.area,
            industry: input.clientState.industry,
            scope: input.clientState.scope,
          }
        : null,
    };
  }

  private async loadClientState(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        country: true,
        area: true,
        industry: true,
        scopeJson: true,
        selectedPlan: true,
        setupCompletedAt: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    });

    if (!client) return null;

    const scope = client.scopeJson && typeof client.scopeJson === 'object' && !Array.isArray(client.scopeJson)
      ? (client.scopeJson as Record<string, unknown>)
      : {};
    const mode = typeof scope.mode === 'string' ? scope.mode.trim().toLowerCase() : null;

    return {
      setupCompleted: Boolean(client.setupCompletedAt),
      setupCompletedAt: client.setupCompletedAt?.toISOString() ?? null,
      selectedPlan: client.selectedPlan ?? null,
      selectedTier: mode || 'focused',
      subscriptionStatus: client.subscriptions[0]?.status?.toString().toLowerCase() ?? 'none',
      country: client.country ?? null,
      area: client.area ?? null,
      industry: client.industry ?? null,
      scope,
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
    const secret = this.getTokenSecret();
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  }

  private verifyToken(token: string, expectedType: SessionPayload['typ']) {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) throw new UnauthorizedException('Invalid token');
    const secret = this.getTokenSecret();
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

  private getTokenSecret() {
    const secret = process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim();
    if (!secret) {
      throw new UnauthorizedException('Missing AUTH_TOKEN_SECRET or APP_SECRET');
    }
    return secret;
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

  private isEmailVerified(metadataJson: unknown) {
    const metadata = this.asObject(metadataJson);
    const auth = this.asObject(metadata.auth);
    return Boolean(auth.emailVerifiedAt);
  }

  private mergeUserMetadata(
    current: unknown,
    patch: {
      emailVerifiedAt?: string | null;
      hasPassword?: boolean;
      primaryProvider?: AuthProvider | string | null;
      defaultClientId?: string | null;
      profileComplete?: boolean;
      businessComplete?: boolean;
      workspaceCreated?: boolean;
      passwordComplete?: boolean;
    },
  ) {
    const metadata = this.asObject(current);
    const auth = this.asObject(metadata.auth);
    const clientAccess = this.asObject(metadata.clientAccess);
    const onboarding = this.asObject(metadata.onboarding);

    if (patch.emailVerifiedAt !== undefined) auth.emailVerifiedAt = patch.emailVerifiedAt;
    if (patch.hasPassword !== undefined) auth.hasPassword = patch.hasPassword;
    if (patch.primaryProvider !== undefined && patch.primaryProvider !== null) {
      auth.primaryProvider = String(patch.primaryProvider).toLowerCase();
    }
    if (patch.defaultClientId !== undefined && patch.defaultClientId !== null) {
      clientAccess.defaultClientId = patch.defaultClientId;
    }
    if (patch.profileComplete !== undefined) onboarding.profileComplete = patch.profileComplete;
    if (patch.businessComplete !== undefined) onboarding.businessComplete = patch.businessComplete;
    if (patch.workspaceCreated !== undefined) onboarding.workspaceCreated = patch.workspaceCreated;
    if (patch.passwordComplete !== undefined) onboarding.passwordComplete = patch.passwordComplete;

    metadata.auth = auth;
    metadata.clientAccess = clientAccess;
    metadata.onboarding = onboarding;
    return metadata;
  }

  private getOnboardingState(
    metadata: Record<string, any>,
    input: {
      hasWorkspace: boolean;
      hasPassword: boolean;
      fullName?: string | null;
      clientState?: { setupCompleted: boolean } | null;
    },
  ) {
    const onboarding = this.asObject(metadata.onboarding);
    const profileComplete = onboarding.profileComplete ?? Boolean((input.fullName || '').trim());
    const businessComplete = onboarding.businessComplete ?? Boolean(input.clientState?.setupCompleted);
    const workspaceCreated = onboarding.workspaceCreated ?? input.hasWorkspace;
    const passwordComplete = onboarding.passwordComplete ?? input.hasPassword;

    return {
      profileComplete: Boolean(profileComplete),
      businessComplete: Boolean(businessComplete),
      workspaceCreated: Boolean(workspaceCreated),
      passwordComplete: Boolean(passwordComplete),
      needsProfileCompletion: !profileComplete,
      needsBusinessCompletion: !businessComplete,
      needsWorkspaceCreation: !workspaceCreated,
      needsPasswordSetup: !passwordComplete,
    };
  }

  private listAuthMethods(identities?: Array<{ provider: AuthProvider }>, passwordHash?: string | null) {
    const methods = new Set<string>();
    for (const identity of identities ?? []) {
      methods.add(String(identity.provider).toLowerCase());
    }
    if (passwordHash) methods.add('password');
    return Array.from(methods.values());
  }

  private resolvePrimaryProvider(
    identities?: Array<{ provider: AuthProvider }>,
    passwordHash?: string | null,
  ): 'password' | 'google' | 'microsoft' | 'apple' | null {
    const providers = new Set((identities ?? []).map((item) => String(item.provider).toLowerCase()));
    if (providers.has('google')) return 'google';
    if (providers.has('microsoft')) return 'microsoft';
    if (providers.has('apple')) return 'apple';
    if (passwordHash || providers.has('password')) return 'password';
    return null;
  }

  private async ensurePasswordIdentity(
    tx: Prisma.TransactionClient,
    userId: string,
    email: string,
    emailVerified: boolean,
  ) {
    const existing = await tx.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: AuthProvider.PASSWORD,
          providerUserId: userId,
        },
      },
    });

    if (existing) {
      await tx.authIdentity.update({
        where: { id: existing.id },
        data: { email, emailVerified },
      });
      return;
    }

    await tx.authIdentity.create({
      data: {
        userId,
        provider: AuthProvider.PASSWORD,
        providerUserId: userId,
        email,
        emailVerified,
        metadataJson: { source: 'password' },
      },
    });
  }

  private shouldReplaceName(currentName: string | null | undefined) {
    const value = (currentName || '').trim().toLowerCase();
    return !value || value === 'orchestrate user' || value === 'apple user' || value === 'microsoft user' || value === 'google user';
  }

  private shouldReplaceLoginEmail(currentEmail: string, incomingEmail: string | null) {
    return Boolean(incomingEmail && this.isPlaceholderEmail(currentEmail));
  }

  private buildPlaceholderEmail(provider: AuthProvider, providerUserId: string) {
    const normalized = providerUserId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || randomBytes(6).toString('hex');
    return `${String(provider).toLowerCase()}-${normalized}@auth.orchestrate.local`;
  }

  private defaultNameForProvider(provider: AuthProvider) {
    switch (provider) {
      case AuthProvider.APPLE:
        return 'Apple User';
      case AuthProvider.MICROSOFT:
        return 'Microsoft User';
      case AuthProvider.GOOGLE:
        return 'Google User';
      default:
        return 'Orchestrate User';
    }
  }

  private isPlaceholderEmail(email: string | null | undefined) {
    const value = (email || '').trim().toLowerCase();
    return value.endsWith('@auth.orchestrate.local');
  }

  private currentIso() {
    return new Date().toISOString();
  }

  private async verifyGoogleAccessToken(input: OAuthLoginInput): Promise<ExternalIdentityProfile> {
    const accessToken = this.normalizeOptionalString(input.accessToken);
    if (!accessToken) {
      throw new UnauthorizedException('Google access token is missing');
    }

    const rawProfile = await this.fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
      Authorization: `Bearer ${accessToken}`,
    });

    const profile = this.asObject(rawProfile);
    const providerUserId = this.readRequiredString(
      profile.sub,
      'Google subject is missing',
    );
    const email = this.normalizeOptionalEmail(profile.email ?? input.email);
    const emailVerified = this.readBooleanLike(profile.email_verified);
    const fullName = this.normalizeOptionalString(profile.name ?? input.fullName);

    return {
      provider: AuthProvider.GOOGLE,
      providerUserId,
      email,
      emailVerified,
      fullName,
      rawClaims: profile,
    };
  }

  private async verifyGoogleIdentityToken(input: OAuthLoginInput): Promise<ExternalIdentityProfile> {
    const idToken = this.normalizeOptionalString(input.idToken);
    if (!idToken) {
      throw new UnauthorizedException('Google identity token is missing');
    }

    const payload = await this.verifyJwtWithJwks({
      idToken,
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      expectedAudience: this.requireEnv('GOOGLE_CLIENT_ID'),
      acceptedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
    });

    const providerUserId = this.readRequiredString(payload.sub, 'Google subject is missing');
    const email = this.normalizeOptionalEmail(payload.email ?? input.email);
    const emailVerified = this.readBooleanLike(payload.email_verified);
    const fullName = this.normalizeOptionalString(payload.name ?? input.fullName);

    return {
      provider: AuthProvider.GOOGLE,
      providerUserId,
      email,
      emailVerified,
      fullName,
      rawClaims: payload,
    };
  }

  private async verifyMicrosoftIdentityToken(input: OAuthLoginInput): Promise<ExternalIdentityProfile> {
    const idToken = this.normalizeOptionalString(input.idToken);
    if (!idToken) {
      throw new UnauthorizedException('Microsoft identity token is missing');
    }

    const payload = await this.verifyJwtWithJwks({
      idToken,
      jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
      expectedAudience: this.requireEnv('MICROSOFT_CLIENT_ID'),
      acceptedIssuers: [
        'https://login.microsoftonline.com/',
        'https://sts.windows.net/',
      ],
      issuerMode: 'prefix',
    });

    const providerUserId = this.readRequiredString(payload.sub, 'Microsoft subject is missing');
    const email = this.normalizeOptionalEmail(
      payload.email ?? payload.preferred_username ?? input.email,
    );
    const emailVerified = email ? true : false;
    const fullName = this.normalizeOptionalString(payload.name ?? input.fullName);

    return {
      provider: AuthProvider.MICROSOFT,
      providerUserId,
      email,
      emailVerified,
      fullName,
      rawClaims: payload,
    };
  }

  private async verifyAppleIdentityToken(input: OAuthLoginInput): Promise<ExternalIdentityProfile> {
    const idToken = this.normalizeOptionalString(input.idToken);
    if (!idToken) {
      throw new UnauthorizedException('Apple identity token is missing');
    }

    const payload = await this.verifyJwtWithJwks({
      idToken,
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      expectedAudience: this.requireEnv('APPLE_CLIENT_ID'),
      acceptedIssuers: ['https://appleid.apple.com'],
    });

    const providerUserId = this.readRequiredString(payload.sub, 'Apple subject is missing');
    const email = this.normalizeOptionalEmail(input.email ?? payload.email);
    const emailVerified = this.readBooleanLike(payload.email_verified) || Boolean(email);
    const fullName = this.normalizeOptionalString(input.fullName ?? payload.name);

    return {
      provider: AuthProvider.APPLE,
      providerUserId,
      email,
      emailVerified,
      fullName,
      rawClaims: payload,
    };
  }

  private async verifyJwtWithJwks(input: {
    idToken: string;
    jwksUrl: string;
    expectedAudience: string;
    acceptedIssuers: string[];
    issuerMode?: 'exact' | 'prefix';
  }): Promise<JwtPayload> {
    const { header, payload, signedPart, signature } = this.decodeJwt(input.idToken);
    if ((header.alg || '').toUpperCase() !== 'RS256') {
      throw new UnauthorizedException('Unsupported identity token algorithm');
    }
    if (!header.kid) {
      throw new UnauthorizedException('Missing identity token key id');
    }

    const jwks = await this.fetchJson(input.jwksUrl);
    const keys = Array.isArray((jwks as { keys?: unknown }).keys)
      ? ((jwks as { keys: Array<Record<string, unknown>> }).keys)
      : [];
    const jwk = keys.find((item) => item.kid === header.kid);
    if (!jwk) {
      throw new UnauthorizedException('Identity token signing key was not found');
    }

    const publicKey = createPublicKey({
      key: jwk as Record<string, unknown>,
      format: 'jwk',
    });
    const isValid = verifySignature('RSA-SHA256', Buffer.from(signedPart), publicKey, signature);
    if (!isValid) {
      throw new UnauthorizedException('Identity token signature is invalid');
    }

    const issuer = this.normalizeOptionalString(payload.iss);
    if (!issuer) throw new UnauthorizedException('Identity token issuer is missing');

    const issuerMode = input.issuerMode || 'exact';
    const issuerAllowed = issuerMode === 'prefix'
      ? input.acceptedIssuers.some((allowed) => issuer.startsWith(allowed))
      : input.acceptedIssuers.includes(issuer);
    if (!issuerAllowed) {
      throw new UnauthorizedException('Identity token issuer is not allowed');
    }

    const audience = payload.aud;
    const audienceAllowed = Array.isArray(audience)
      ? audience.includes(input.expectedAudience)
      : audience === input.expectedAudience;
    if (!audienceAllowed) {
      throw new UnauthorizedException('Identity token audience is invalid');
    }

    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    if (!exp || exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Identity token has expired');
    }

    return payload;
  }

  private decodeJwt(token: string): {
    header: JwtHeader;
    payload: JwtPayload;
    signedPart: string;
    signature: Buffer;
  } {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Identity token format is invalid');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as JwtHeader;
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as JwtPayload;

    return {
      header,
      payload,
      signedPart: `${encodedHeader}.${encodedPayload}`,
      signature: Buffer.from(encodedSignature, 'base64url'),
    };
  }

  private async fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...(headers || {}) },
    });
    if (!response.ok) {
      throw new UnauthorizedException(`Failed to fetch identity keys from ${url}`);
    }
    return response.json();
  }

  private requireEnv(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new UnauthorizedException(`Missing ${name}`);
    return value;
  }

  private normalizeOptionalEmail(value: unknown) {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return email.length ? email : null;
  }

  private normalizeOptionalString(value: unknown) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length ? text : null;
  }

  private readRequiredString(value: unknown, message: string) {
    const text = this.normalizeOptionalString(value);
    if (!text) throw new UnauthorizedException(message);
    return text;
  }

  private readBooleanLike(value: unknown) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return false;
  }
}

function hydratedOrThrow<T>(value: T | null): T {
  if (!value) throw new UnauthorizedException('Account not found');
  return value;
}
