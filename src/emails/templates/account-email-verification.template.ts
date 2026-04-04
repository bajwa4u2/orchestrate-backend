import { renderBaseEmail } from './base.template';

export function accountEmailVerificationTemplate(params: {
  verifyUrl: string;
}) {
  return renderBaseEmail({
    title: 'Verify your email',
    contentHtml: `
      <h1>Verify your email</h1>

      <p>Confirm your email to activate your Orchestrate account.</p>

      <a href="${params.verifyUrl}" class="button">Verify Email</a>

      <p>If you did not request this, you can ignore this message.</p>
    `,
  });
}