import { renderBaseEmail } from './base.template';

export function paymentFailedTemplate(params: {
  name?: string;
  invoiceNumber?: string;
  amountDue?: string;
  attemptedAt?: string;
  updatePaymentUrl?: string;
  invoiceUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Payment could not be completed',
    previewText: 'We could not complete your payment.',
    contentHtml: `
      <h1>Payment could not be completed</h1>

      <p>${greeting}</p>

      <p>We could not complete your payment for your Orchestrate billing record.</p>

      ${params.invoiceNumber ? `<p><strong>Invoice number:</strong> ${params.invoiceNumber}</p>` : ''}
      ${params.amountDue ? `<p><strong>Amount due:</strong> ${params.amountDue}</p>` : ''}
      ${params.attemptedAt ? `<p><strong>Attempted at:</strong> ${params.attemptedAt}</p>` : ''}

      ${
        params.updatePaymentUrl
          ? `<a href="${params.updatePaymentUrl}" class="button">Update Payment Method</a>`
          : ''
      }

      ${
        params.invoiceUrl
          ? `<p><a href="${params.invoiceUrl}">View invoice details</a></p>`
          : ''
      }

      <p>
        If you need help, contact
        <a href="mailto:billing@orchestrateops.com">billing@orchestrateops.com</a>.
      </p>
    `,
  });
}