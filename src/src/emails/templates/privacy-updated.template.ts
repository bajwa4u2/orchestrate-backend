import { renderBaseEmail } from './base.template';

export function privacyUpdatedTemplate(params: {
  name?: string;
  effectiveDate?: string;
  summary?: string;
  reviewUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Privacy notice updated',
    previewText: 'Our privacy notice has been updated.',
    contentHtml: `
      <h1>Privacy notice updated</h1>

      <p>${greeting}</p>

      <p>We have updated the privacy notice that applies to Orchestrate.</p>

      ${params.effectiveDate ? `<p><strong>Effective date:</strong> ${params.effectiveDate}</p>` : ''}
      ${params.summary ? `<p><strong>Summary:</strong> ${params.summary}</p>` : ''}

      ${
        params.reviewUrl
          ? `<a href="${params.reviewUrl}" class="button">Review Privacy Notice</a>`
          : ''
      }

      <p>
        Legal questions can be sent to
        <a href="mailto:legal@orchestrateops.com">legal@orchestrateops.com</a>.
      </p>
    `,
  });
}
