import { renderBaseEmail } from './base.template';

export function invoiceReminderDueTemplate(params: {
  name?: string;
  invoiceNumber?: string;
  dueDate?: string;
  amountDue?: string;
  payUrl?: string;
  invoiceUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Invoice reminder',
    previewText: 'Your invoice is coming due soon.',
    contentHtml: `
      <h1>Invoice reminder</h1>

      <p>${greeting}</p>

      <p>This is a reminder that your invoice is due soon.</p>

      ${params.invoiceNumber ? `<p><strong>Invoice number:</strong> ${params.invoiceNumber}</p>` : ''}
      ${params.dueDate ? `<p><strong>Due date:</strong> ${params.dueDate}</p>` : ''}
      ${params.amountDue ? `<p><strong>Amount due:</strong> ${params.amountDue}</p>` : ''}

      ${
        params.payUrl
          ? `<a href="${params.payUrl}" class="button">Pay Invoice</a>`
          : ''
      }

      ${
        params.invoiceUrl
          ? `<p><a href="${params.invoiceUrl}">View invoice details</a></p>`
          : ''
      }

      <p>
        If payment has already been made, you can disregard this reminder.
      </p>
    `,
  });
}