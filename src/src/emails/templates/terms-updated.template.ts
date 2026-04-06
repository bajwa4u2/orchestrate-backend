import { renderBaseEmail } from './base.template';

export function termsUpdatedTemplate(params: {
  name?: string;
  effectiveDate?: string;
  summary?: string;
  reviewUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Terms updated',
    previewText: 'Our terms have been updated.',
    contentHtml: `
      <h1>Terms updated</h1>

      <p>${greeting}</p>

      <p>We have updated the terms that govern your use of Orchestrate.</p>

      ${params.effectiveDate ? `<p><strong>Effective date:</strong> ${params.effectiveDate}</p>` : ''}
      ${params.summary ? `<p><strong>Summary:</strong> ${params.summary}</p>` : ''}

      ${
        params.reviewUrl
          ? `<a href="${params.reviewUrl}" class="button">Review Terms</a>`
          : ''
      }

      <p>
        Legal questions can be sent to
        <a href="mailto:legal@orchestrateops.com">legal@orchestrateops.com</a>.
      </p>
    `,
  });
}