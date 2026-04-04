import { renderBaseEmail } from './base.template';

export function campaignStartedTemplate(params: {
  name?: string;
  campaignName?: string;
  startDate?: string;
  dashboardUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Campaign started',
    previewText: 'Your Orchestrate campaign is now active.',
    contentHtml: `
      <h1>Campaign started</h1>

      <p>${greeting}</p>

      <p>Your campaign is now active in Orchestrate.</p>

      ${params.campaignName ? `<p><strong>Campaign:</strong> ${params.campaignName}</p>` : ''}
      ${params.startDate ? `<p><strong>Start date:</strong> ${params.startDate}</p>` : ''}

      ${
        params.dashboardUrl
          ? `<a href="${params.dashboardUrl}" class="button">View Campaign</a>`
          : ''
      }

      <p>You can track progress and activity from your workspace.</p>
    `,
  });
}