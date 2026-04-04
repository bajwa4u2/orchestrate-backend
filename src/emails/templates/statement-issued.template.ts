import { renderBaseEmail } from './base.template';

export function statementIssuedTemplate(params: {
  name?: string;
  statementLabel?: string;
  periodLabel?: string;
  issuedDate?: string;
  totalInvoiced?: string;
  totalPaid?: string;
  outstandingBalance?: string;
  statementUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Statement available',
    previewText: 'Your billing statement is now available.',
    contentHtml: `
      <h1>Statement available</h1>

      <p>${greeting}</p>

      <p>Your billing statement is now available.</p>

      ${params.statementLabel ? `<p><strong>Statement:</strong> ${params.statementLabel}</p>` : ''}
      ${params.periodLabel ? `<p><strong>Period:</strong> ${params.periodLabel}</p>` : ''}
      ${params.issuedDate ? `<p><strong>Issued date:</strong> ${params.issuedDate}</p>` : ''}
      ${params.totalInvoiced ? `<p><strong>Total invoiced:</strong> ${params.totalInvoiced}</p>` : ''}
      ${params.totalPaid ? `<p><strong>Total paid:</strong> ${params.totalPaid}</p>` : ''}
      ${params.outstandingBalance ? `<p><strong>Outstanding balance:</strong> ${params.outstandingBalance}</p>` : ''}

      ${
        params.statementUrl
          ? `<a href="${params.statementUrl}" class="button">View Statement</a>`
          : ''
      }

      <p>
        Billing questions can be sent to
        <a href="mailto:billing@orchestrateops.com">billing@orchestrateops.com</a>.
      </p>
    `,
  });
}