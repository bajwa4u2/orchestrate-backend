import { renderBaseEmail } from './base.template';

export function leadDeliveryAvailableTemplate(params: {
  name?: string;
  leadCount?: string;
  deliveryLabel?: string;
  deliveryUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Lead delivery available',
    previewText: 'New lead delivery is available in your workspace.',
    contentHtml: `
      <h1>Lead delivery available</h1>

      <p>${greeting}</p>

      <p>New lead delivery is now available in your Orchestrate workspace.</p>

      ${params.leadCount ? `<p><strong>Lead count:</strong> ${params.leadCount}</p>` : ''}
      ${params.deliveryLabel ? `<p><strong>Delivery:</strong> ${params.deliveryLabel}</p>` : ''}

      ${
        params.deliveryUrl
          ? `<a href="${params.deliveryUrl}" class="button">View Delivery</a>`
          : ''
      }

      <p>Review the delivery and continue your workflow from the workspace.</p>
    `,
  });
}