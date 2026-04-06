import { renderBaseEmail } from './base.template';

export function agreementSentTemplate(params: {
  name?: string;
  agreementTitle?: string;
  agreementReference?: string;
  issueDate?: string;
  effectiveDate?: string;
  reviewUrl?: string;
  signUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Service agreement ready for review',
    previewText: 'Your Orchestrate service agreement is ready.',
    contentHtml: `
      <h1>Service agreement ready for review</h1>

      <p>${greeting}</p>

      <p>Your service agreement is ready for review.</p>

      <p>
        This agreement is issued by <strong>Aura Platform LLC</strong>, the legal entity behind Orchestrate.
      </p>

      ${params.agreementTitle ? `<p><strong>Agreement:</strong> ${params.agreementTitle}</p>` : ''}
      ${params.agreementReference ? `<p><strong>Reference:</strong> ${params.agreementReference}</p>` : ''}
      ${params.issueDate ? `<p><strong>Issue date:</strong> ${params.issueDate}</p>` : ''}
      ${params.effectiveDate ? `<p><strong>Effective date:</strong> ${params.effectiveDate}</p>` : ''}

      ${
        params.signUrl
          ? `<a href="${params.signUrl}" class="button">Review and Sign</a>`
          : params.reviewUrl
            ? `<a href="${params.reviewUrl}" class="button">Review Agreement</a>`
            : ''
      }

      ${
        params.reviewUrl && params.signUrl && params.reviewUrl !== params.signUrl
          ? `<p><a href="${params.reviewUrl}">View agreement details</a></p>`
          : ''
      }

      <p>
        Legal questions can be sent to
        <a href="mailto:legal@orchestrateops.com">legal@orchestrateops.com</a>.
      </p>
    `,
  });
}