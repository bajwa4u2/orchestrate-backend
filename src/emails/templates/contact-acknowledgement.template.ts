import { renderBaseEmail } from './base.template';

type ContactAcknowledgementParams = {
  name: string;
  inquiryTypeLabel: string;
  responseEmail?: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function contactAcknowledgementTemplate(params: ContactAcknowledgementParams) {
  const name = params.name?.trim() ? params.name.trim() : 'there';
  const inquiry = params.inquiryTypeLabel?.trim() ? params.inquiryTypeLabel.trim() : 'inquiry';
  const responseEmail = params.responseEmail?.trim() ? params.responseEmail.trim() : 'hello@orchestrateops.com';

  return renderBaseEmail({
    title: 'We received your inquiry',
    previewText: `Your ${inquiry.toLowerCase()} inquiry has been received by Orchestrate.`,
    contentHtml: `
      <h1>We received your inquiry</h1>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Thank you for reaching out. We received your ${escapeHtml(inquiry.toLowerCase())} inquiry and added it to our intake queue.</p>
      <p>We will review it and continue the conversation from <a href="mailto:${escapeHtml(responseEmail)}" style="color:#111827; text-decoration:none;">${escapeHtml(responseEmail)}</a>.</p>
      <p>You do not need to submit it again unless something important has changed.</p>
      <p style="margin-top:20px;">Thank you,<br/>Orchestrate</p>
    `,
  });
}
