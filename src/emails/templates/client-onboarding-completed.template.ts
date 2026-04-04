import { renderBaseEmail } from './base.template';

export function clientOnboardingCompletedTemplate(params: {
  name?: string;
  dashboardUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Onboarding complete',
    previewText: 'Your Orchestrate onboarding is complete.',
    contentHtml: `
      <h1>Onboarding complete</h1>

      <p>${greeting}</p>

      <p>Your onboarding is complete and your service record is now active.</p>

      ${
        params.dashboardUrl
          ? `<a href="${params.dashboardUrl}" class="button">Open Workspace</a>`
          : ''
      }

      <p>You can now continue into your workspace and follow service activity from there.</p>
    `,
  });
}