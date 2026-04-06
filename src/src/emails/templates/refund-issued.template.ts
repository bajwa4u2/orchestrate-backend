import { renderBaseEmail } from './base.template';

export function refundIssuedTemplate(params: {
  name?: string;
  refundAmount?: string;
  refundDate?: string;
  invoiceNumber?: string;
  receiptNumber?: string;
  refundReference?: string;
  billingUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Refund issued',
    previewText: 'A refund has been issued to your account.',
    contentHtml: `
      <h1>Refund issued</h1>

      <p>${greeting}</p>

      <p>A refund has been issued for your Orchestrate billing record.</p>

      ${params.refundAmount ? `<p><strong>Refund amount:</strong> ${params.refundAmount}</p>` : ''}
      ${params.refundDate ? `<p><strong>Refund date:</strong> ${params.refundDate}</p>` : ''}
      ${params.invoiceNumber ? `<p><strong>Invoice number:</strong> ${params.invoiceNumber}</p>` : ''}
      ${params.receiptNumber ? `<p><strong>Receipt number:</strong> ${params.receiptNumber}</p>` : ''}
      ${params.refundReference ? `<p><strong>Reference:</strong> ${params.refundReference}</p>` : ''}

      ${
        params.billingUrl
          ? `<a href="${params.billingUrl}" class="button">Open Billing</a>`
          : ''
      }

      <p>
        Billing questions can be sent to
        <a href="mailto:billing@orchestrateops.com">billing@orchestrateops.com</a>.
      </p>
    `,
  });
}