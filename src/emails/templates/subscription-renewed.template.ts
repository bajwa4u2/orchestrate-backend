import { renderBaseEmail } from './base.template';

export function subscriptionRenewedTemplate(params: {
  name?: string;
  planName?: string;
  renewalDate?: string;
  amountLabel?: string;
  billingInterval?: string;
  billingUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Subscription renewed',
    previewText: 'Your Orchestrate subscription has been renewed.',
    contentHtml: `
      <h1>Subscription renewed</h1>

      <p>${greeting}</p>

      <p>Your Orchestrate subscription has been renewed.</p>

      ${params.planName ? `<p><strong>Plan:</strong> ${params.planName}</p>` : ''}
      ${params.renewalDate ? `<p><strong>Renewal date:</strong> ${params.renewalDate}</p>` : ''}
      ${params.amountLabel ? `<p><strong>Amount:</strong> ${params.amountLabel}</p>` : ''}
      ${params.billingInterval ? `<p><strong>Billing interval:</strong> ${params.billingInterval}</p>` : ''}

      ${
        params.billingUrl
          ? `<a href="${params.billingUrl}" class="button">Open Billing</a>`
          : ''
      }

      <p>This email confirms your continued subscription.</p>
    `,
  });
}