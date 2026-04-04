import { Injectable } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { EmailsService } from '../emails/emails.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly accessContextService: AccessContextService,
    private readonly emailsService: EmailsService,
  ) {}

  resolveRequest(headers: Record<string, unknown>) {
    return this.accessContextService.buildFromHeaders(headers);
  }

  async sendVerificationEmail(input: {
    email: string;
    verificationUrl: string;
    name?: string;
    brandName?: string;
  }) {
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
    });
  }

  async sendPasswordResetEmail(input: {
    email: string;
    resetUrl: string;
    name?: string;
    brandName?: string;
  }) {
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
    });
  }

  async sendWelcomeEmail(input: {
    email: string;
    appUrl?: string;
    name?: string;
    brandName?: string;
  }) {
    const brandName = input.brandName?.trim() || process.env.EMAIL_BRAND_NAME?.trim() || 'Orchestrate';
    const appUrl = input.appUrl?.trim() || process.env.APP_BASE_URL?.trim() || 'https://orchestrateops.com';

    return this.emailsService.sendDirectEmail({
      emailEvent: 'account_welcome',
      toEmail: input.email,
      toName: input.name,
      subject: `Welcome to ${brandName}`,
      bodyText: [
        `Your ${brandName} account is active.`,
        `Open ${appUrl} to continue.`,
      ].join('\n\n'),
    });
  }
}
