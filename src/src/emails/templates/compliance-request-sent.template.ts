import { renderBaseEmail } from './base.template';

export function complianceRequestSentTemplate(params: {
  name?: string;
  requestLabel?: string;
  dueDate?: string;
  details?: string;
  actionUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Compliance information requested',
    previewText: 'Additional information is requested to complete review.',
    contentHtml: `
      <h1>Compliance information requested</h1>

      <p>${greeting}</p>

      <p>We need additional information to complete review of your account or service record.</p>

      ${params.requestLabel ? `<p><strong>Request:</strong> ${params.requestLabel}</p>` : ''}
      ${params.dueDate ? `<p><strong>Due date:</strong> ${params.dueDate}</p>` : ''}
      ${params.details ? `<p><strong>Details:</strong> ${params.details}</p>` : ''}

      ${
        params.actionUrl
          ? `<a href="${params.actionUrl}" class="button">Respond to Request</a>`
          : ''
      }

      <p>
        If you have questions, contact
        <a href="mailto:legal@orchestrateops.com">legal@orchestrateops.com</a>.
      </p>
    `,
  });
}