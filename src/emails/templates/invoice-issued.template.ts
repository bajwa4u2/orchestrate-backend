import { renderBaseEmail } from './base.template';

export function invoiceIssuedTemplate(params: {
  name?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  amountDue?: string;
  servicePeriod?: string;
  invoiceUrl?: string;
  payUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Your invoice is ready',
    previewText: 'A new invoice has been issued for your Orchestrate service.',
    contentHtml: `
      <h1>Your invoice is ready</h1>

      <p>${greeting}</p>

      <p>This invoice has been issued for your Orchestrate service.</p>

      ${params.invoiceNumber ? `<p><strong>Invoice number:</strong> ${params.invoiceNumber}</p>` : ''}
      ${params.issueDate ? `<p><strong>Issue date:</strong> ${params.issueDate}</p>` : ''}
      ${params.dueDate ? `<p><strong>Due date:</strong> ${params.dueDate}</p>` : ''}
      ${params.servicePeriod ? `<p><strong>Service period:</strong> ${params.servicePeriod}</p>` : ''}
      ${params.amountDue ? `<p><strong>Amount due:</strong> ${params.amountDue}</p>` : ''}

      ${
        params.payUrl
          ? `<a href="${params.payUrl}" class="button">Pay Invoice</a>`
          : params.invoiceUrl
            ? `<a href="${params.invoiceUrl}" class="button">View Invoice</a>`
            : ''
      }

      ${
        params.invoiceUrl && params.payUrl && params.invoiceUrl !== params.payUrl
          ? `<p><a href="${params.invoiceUrl}">View full invoice</a></p>`
          : ''
      }

      <p>
        Billing questions can be sent to
        <a href="mailto:billing@orchestrateops.com">billing@orchestrateops.com</a>.
      </p>
    `,
  });
}