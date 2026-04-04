import { renderBaseEmail } from './base.template';

export function meetingBookedNoticeTemplate(params: {
  name?: string;
  meetingLabel?: string;
  scheduledFor?: string;
  workspaceUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Meeting booked',
    previewText: 'A meeting has been booked through Orchestrate.',
    contentHtml: `
      <h1>Meeting booked</h1>

      <p>${greeting}</p>

      <p>A meeting has been booked through Orchestrate.</p>

      ${params.meetingLabel ? `<p><strong>Meeting:</strong> ${params.meetingLabel}</p>` : ''}
      ${params.scheduledFor ? `<p><strong>Scheduled for:</strong> ${params.scheduledFor}</p>` : ''}

      ${
        params.workspaceUrl
          ? `<a href="${params.workspaceUrl}" class="button">Open Workspace</a>`
          : ''
      }

      <p>You can review details and follow-up context in your workspace.</p>
    `,
  });
}