import { renderBaseEmail } from './base.template';

export function setupCompletionReminderTemplate(params: {
  name?: string;
  missingItemLabel?: string;
  setupUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Complete your setup',
    previewText: 'Your account or service setup still needs attention.',
    contentHtml: `
      <h1>Complete your setup</h1>

      <p>${greeting}</p>

      <p>Your account or service setup still needs attention before everything can move forward cleanly.</p>

      ${params.missingItemLabel ? `<p><strong>Pending item:</strong> ${params.missingItemLabel}</p>` : ''}

      ${
        params.setupUrl
          ? `<a href="${params.setupUrl}" class="button">Complete Setup</a>`
          : ''
      }

      <p>If you need help, contact <a href="mailto:support@orchestrateops.com">support@orchestrateops.com</a>.</p>
    `,
  });
}