import { renderBaseEmail } from './base.template';

export function invoiceReminderOverdueTemplate(params: {
  name?: string;
  invoiceNumber?: string;
  dueDate?: string;
  amountDue?: string;
  payUrl?: string;
  invoiceUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Invoice overdue',
    previewText: 'Your invoice is now overdue.',
    contentHtml: `
      <h1>Invoice overdue</h1>

      <p>${greeting}</p>

      <p>Your invoice is now overdue.</p>

      ${params.invoiceNumber ? `<p><strong>Invoice number:</strong> ${params.invoiceNumber}</p>` : ''}
      ${params.dueDate ? `<p><strong>Original due date:</strong> ${params.dueDate}</p>` : ''}
      ${params.amountDue ? `<p><strong>Outstanding amount:</strong> ${params.amountDue}</p>` : ''}

      ${
        params.payUrl
          ? `<a href="${params.payUrl}" class="button">Pay Now</a>`
          : ''
      }

      ${
        params.invoiceUrl
          ? `<p><a href="${params.invoiceUrl}">View invoice details</a></p>`
          : ''
      }

      <p>
        If you need help resolving this, contact
        <a href="mailto:billing@orchestrateops.com">billing@orchestrateops.com</a>.
      </p>
    `,
  });
}