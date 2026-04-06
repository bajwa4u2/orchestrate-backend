import { renderBaseEmail } from './base.template';

export function accountOnHoldTemplate(params: {
  name?: string;
  reason?: string;
  actionLabel?: string;
  actionUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Action needed for your account',
    previewText: 'Your Orchestrate account needs attention before it can move forward.',
    contentHtml: `
      <h1>Action needed for your account</h1>

      <p>${greeting}</p>

      <p>Your Orchestrate account is currently on hold and needs attention before it can move forward.</p>

      ${
        params.reason
          ? `<p><strong>Reason:</strong> ${params.reason}</p>`
          : ''
      }

      ${
        params.actionUrl
          ? `<a href="${params.actionUrl}" class="button">${params.actionLabel || 'Review Account'}</a>`
          : ''
      }

      <p>If you need help, reply to this email or contact support.</p>
    `,
  });
}