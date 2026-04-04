import { renderBaseEmail } from './base.template';

export function subscriptionCreatedTemplate(params: {
  name?: string;
  planName?: string;
  amountLabel?: string;
  billingInterval?: string;
  startDate?: string;
  dashboardUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Subscription confirmed',
    previewText: 'Your Orchestrate subscription is now active.',
    contentHtml: `
      <h1>Subscription confirmed</h1>

      <p>${greeting}</p>

      <p>Your Orchestrate subscription is now active.</p>

      <p><strong>Plan:</strong> ${params.planName || 'Active subscription'}</p>
      ${params.amountLabel ? `<p><strong>Amount:</strong> ${params.amountLabel}</p>` : ''}
      ${params.billingInterval ? `<p><strong>Billing interval:</strong> ${params.billingInterval}</p>` : ''}
      ${params.startDate ? `<p><strong>Start date:</strong> ${params.startDate}</p>` : ''}

      ${
        params.dashboardUrl
          ? `<a href="${params.dashboardUrl}" class="button">Open Billing</a>`
          : ''
      }

      <p>This email confirms the start of your subscription.</p>
    `,
  });
}