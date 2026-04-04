import { renderBaseEmail } from './base.template';

export function paymentReceivedTemplate(params: {
  name?: string;
  receiptNumber?: string;
  invoiceNumber?: string;
  paymentDate?: string;
  amountReceived?: string;
  receiptUrl?: string;
  remainingBalance?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Payment received',
    previewText: 'We received your payment.',
    contentHtml: `
      <h1>Payment received</h1>

      <p>${greeting}</p>

      <p>Payment received. Thank you.</p>

      ${params.receiptNumber ? `<p><strong>Receipt number:</strong> ${params.receiptNumber}</p>` : ''}
      ${params.invoiceNumber ? `<p><strong>Invoice number:</strong> ${params.invoiceNumber}</p>` : ''}
      ${params.paymentDate ? `<p><strong>Payment date:</strong> ${params.paymentDate}</p>` : ''}
      ${params.amountReceived ? `<p><strong>Amount received:</strong> ${params.amountReceived}</p>` : ''}
      ${params.remainingBalance ? `<p><strong>Remaining balance:</strong> ${params.remainingBalance}</p>` : ''}

      ${
        params.receiptUrl
          ? `<a href="${params.receiptUrl}" class="button">View Receipt</a>`
          : ''
      }

      <p>
        Billing questions can be sent to
        <a href="mailto:billing@orchestrateops.com">billing@orchestrateops.com</a>.
      </p>
    `,
  });
}