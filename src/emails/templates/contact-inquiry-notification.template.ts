import { renderBaseEmail } from './base.template';

type ContactInquiryNotificationParams = {
  inquiryId: string;
  inquiryTypeLabel: string;
  senderName: string;
  senderEmail: string;
  company?: string | null;
  message: string;
  submittedAt?: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMessageBlock(message: string) {
  const escaped = escapeHtml(message).replace(/\n/g, '<br />');
  return `
    <div style="margin-top:10px; padding:16px 18px; border:1px solid #e5e7eb; border-radius:14px; background:#f8fafc;">
      <div style="font-size:12px; letter-spacing:0.04em; text-transform:uppercase; color:#667085; margin-bottom:8px;">Message</div>
      <div style="font-size:14px; line-height:1.7; color:#111827;">${escaped}</div>
    </div>
  `;
}

function detailRow(label: string, value: string) {
  return `
    <tr>
      <td style="padding:10px 0; width:132px; color:#667085; font-size:13px; vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:10px 0; color:#111827; font-size:14px; vertical-align:top;">${value}</td>
    </tr>
  `;
}

export function contactInquiryNotificationTemplate(params: ContactInquiryNotificationParams) {
  const company = params.company?.trim() ? escapeHtml(params.company.trim()) : 'Not provided';
  const submittedAt = params.submittedAt?.trim() ? escapeHtml(params.submittedAt.trim()) : 'Just now';

  return renderBaseEmail({
    title: `New inquiry — ${params.inquiryTypeLabel} — ${params.senderName}`,
    previewText: `New ${params.inquiryTypeLabel.toLowerCase()} inquiry from ${params.senderName}.`,
    contentHtml: `
      <h1>New inquiry received</h1>
      <p>A new public inquiry has entered Orchestrate and is ready for review.</p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%; margin-top:18px;">
        ${detailRow('Inquiry ID', escapeHtml(params.inquiryId))}
        ${detailRow('Type', escapeHtml(params.inquiryTypeLabel))}
        ${detailRow('Name', escapeHtml(params.senderName))}
        ${detailRow('Email', `<a href="mailto:${escapeHtml(params.senderEmail)}" style="color:#111827; text-decoration:none;">${escapeHtml(params.senderEmail)}</a>`)}
        ${detailRow('Company', company)}
        ${detailRow('Submitted', submittedAt)}
      </table>

      ${renderMessageBlock(params.message)}

      <p style="margin-top:20px;">Sent via Orchestrate public contact intake.</p>
    `,
  });
}
