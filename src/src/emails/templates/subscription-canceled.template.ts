import { renderBaseEmail } from './base.template';

export function subscriptionCanceledTemplate(params: {
  name?: string;
  planName?: string;
  effectiveDate?: string;
  accessEndsOn?: string;
  billingUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Subscription canceled',
    previewText: 'Your Orchestrate subscription has been canceled.',
    contentHtml: `
      <h1>Subscription canceled</h1>

      <p>${greeting}</p>

      <p>Your Orchestrate subscription has been canceled.</p>

      ${params.planName ? `<p><strong>Plan:</strong> ${params.planName}</p>` : ''}
      ${params.effectiveDate ? `<p><strong>Canceled on:</strong> ${params.effectiveDate}</p>` : ''}
      ${params.accessEndsOn ? `<p><strong>Access ends on:</strong> ${params.accessEndsOn}</p>` : ''}

      ${
        params.billingUrl
          ? `<a href="${params.billingUrl}" class="button">Open Billing</a>`
          : ''
      }

      <p>
        If this was unexpected or you need help, contact
        <a href="mailto:billing@orchestrateops.com">billing@orchestrateops.com</a>.
      </p>
    `,
  });
}