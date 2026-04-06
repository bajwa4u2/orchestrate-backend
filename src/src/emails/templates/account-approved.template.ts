import { renderBaseEmail } from './base.template';

export function accountApprovedTemplate(params: {
  name?: string;
  dashboardUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Your account has been approved',
    previewText: 'Your Orchestrate account is now approved and ready.',
    contentHtml: `
      <h1>Your account has been approved</h1>

      <p>${greeting}</p>

      <p>Your Orchestrate account has been approved and is now ready to use.</p>

      ${
        params.dashboardUrl
          ? `<a href="${params.dashboardUrl}" class="button">Open Workspace</a>`
          : ''
      }

      <p>You can now continue with setup and begin using your workspace.</p>
    `,
  });
}