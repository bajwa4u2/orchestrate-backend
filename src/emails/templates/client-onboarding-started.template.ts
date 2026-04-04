import { renderBaseEmail } from './base.template';

export function clientOnboardingStartedTemplate(params: {
  name?: string;
  setupUrl?: string;
  nextStep?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Onboarding started',
    previewText: 'Your Orchestrate onboarding has started.',
    contentHtml: `
      <h1>Onboarding started</h1>

      <p>${greeting}</p>

      <p>Your Orchestrate onboarding has started.</p>

      ${params.nextStep ? `<p><strong>Next step:</strong> ${params.nextStep}</p>` : ''}

      ${
        params.setupUrl
          ? `<a href="${params.setupUrl}" class="button">Continue Setup</a>`
          : ''
      }

      <p>We will guide you through the information needed to activate your service correctly.</p>
    `,
  });
}