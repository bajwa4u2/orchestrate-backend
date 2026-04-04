import { renderBaseEmail } from './base.template';

export function serviceIssueNoticeTemplate(params: {
  name?: string;
  issueLabel?: string;
  summary?: string;
  workspaceUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Service notice',
    previewText: 'There is an issue affecting part of your service.',
    contentHtml: `
      <h1>Service notice</h1>

      <p>${greeting}</p>

      <p>There is an issue affecting part of your Orchestrate service.</p>

      ${params.issueLabel ? `<p><strong>Issue:</strong> ${params.issueLabel}</p>` : ''}
      ${params.summary ? `<p><strong>Summary:</strong> ${params.summary}</p>` : ''}

      ${
        params.workspaceUrl
          ? `<a href="${params.workspaceUrl}" class="button">Review Status</a>`
          : ''
      }

      <p>If action is needed from you, it will be shown in your workspace.</p>
    `,
  });
}