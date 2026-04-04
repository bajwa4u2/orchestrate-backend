import { renderBaseEmail } from './base.template';

export function accountPasswordResetTemplate(params: {
  resetUrl: string;
}) {
  return renderBaseEmail({
    title: 'Reset your password',
    contentHtml: `
      <h1>Reset your password</h1>

      <p>A request was made to reset your password.</p>

      <a href="${params.resetUrl}" class="button">Reset Password</a>

      <p>If you did not request this, no action is required.</p>
    `,
  });
}