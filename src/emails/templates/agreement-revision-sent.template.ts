import { renderBaseEmail } from './base.template';

export function agreementRevisionSentTemplate(params: {
  name?: string;
  agreementTitle?: string;
  agreementReference?: string;
  revisionSummary?: string;
  reviewUrl?: string;
  signUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Updated agreement ready for review',
    previewText: 'A revised agreement is ready for review.',
    contentHtml: `
      <h1>Updated agreement ready for review</h1>

      <p>${greeting}</p>

      <p>A revised version of your service agreement is ready for review.</p>

      ${params.agreementTitle ? `<p><strong>Agreement:</strong> ${params.agreementTitle}</p>` : ''}
      ${params.agreementReference ? `<p><strong>Reference:</strong> ${params.agreementReference}</p>` : ''}
      ${params.revisionSummary ? `<p><strong>Revision summary:</strong> ${params.revisionSummary}</p>` : ''}

      ${
        params.signUrl
          ? `<a href="${params.signUrl}" class="button">Review Revision</a>`
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