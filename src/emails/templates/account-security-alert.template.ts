import { renderBaseEmail } from './base.template';

export function accountSecurityAlertTemplate(params: {
  name?: string;
  action?: string;
  occurredAt?: string;
  locationOrIp?: string;
  reviewUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Security alert',
    previewText: 'A security-related action was detected on your account.',
    contentHtml: `
      <h1>Security alert</h1>

      <p>${greeting}</p>

      <p>We detected a security-related action on your Orchestrate account.</p>

      <p><strong>Action:</strong> ${params.action || 'Account activity detected'}</p>
      ${params.occurredAt ? `<p><strong>Time:</strong> ${params.occurredAt}</p>` : ''}
      ${params.locationOrIp ? `<p><strong>Location or IP:</strong> ${params.locationOrIp}</p>` : ''}

      ${
        params.reviewUrl
          ? `<a href="${params.reviewUrl}" class="button">Review Activity</a>`
          : ''
      }

      <p>If this was you, no action is required.</p>
      <p>If this was not you, secure your account immediately and contact support.</p>
    `,
  });
}