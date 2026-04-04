import { renderBaseEmail } from './base.template';

export function formalNoticeSentTemplate(params: {
  name?: string;
  noticeTitle?: string;
  noticeDate?: string;
  noticeReference?: string;
  summary?: string;
  reviewUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: params.noticeTitle || 'Formal notice',
    previewText: 'A formal notice has been issued regarding your account or service.',
    contentHtml: `
      <h1>${params.noticeTitle || 'Formal notice'}</h1>

      <p>${greeting}</p>

      <p>A formal notice has been issued regarding your account or service relationship with Orchestrate.</p>

      ${params.noticeReference ? `<p><strong>Reference:</strong> ${params.noticeReference}</p>` : ''}
      ${params.noticeDate ? `<p><strong>Date:</strong> ${params.noticeDate}</p>` : ''}
      ${params.summary ? `<p><strong>Summary:</strong> ${params.summary}</p>` : ''}

      ${
        params.reviewUrl
          ? `<a href="${params.reviewUrl}" class="button">Review Notice</a>`
          : ''
      }

      <p>
        Legal questions can be sent to
        <a href="mailto:legal@orchestrateops.com">legal@orchestrateops.com</a>.
      </p>
    `,
  });
}