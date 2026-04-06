import { renderBaseEmail } from './base.template';

export function accountWelcomeTemplate(params: {
  name?: string;
}) {
  return renderBaseEmail({
    title: 'Welcome to Orchestrate',
    contentHtml: `
      <h1>Welcome to Orchestrate</h1>

      <p>${params.name ? `Hi ${params.name},` : 'Welcome,'}</p>

      <p>Your account is now active.</p>

      <p>
        Orchestrate is built to move your outreach, follow-up, and meetings
        into a single system that works continuously in the background.
      </p>

      <p>You can now begin using your workspace.</p>
    `,
  });
}