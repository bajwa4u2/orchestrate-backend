import { Injectable } from '@nestjs/common';
import { escapeHtml, formatDate } from '../../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../../financial-documents/legal-identity';
import { AgreementDocument } from './agreement-document.builder';

@Injectable()
export class AgreementHtmlRenderer {
  render(document: AgreementDocument): string {
    const termsHtml = escapeHtml(document.termsText).replace(/\n/g, '<br/>');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(document.title)} ${escapeHtml(document.agreementNumber)}</title>
<style>
body { font-family: Arial, sans-serif; color:#111827; padding:40px; line-height:1.6; }
.header { display:flex; justify-content:space-between; gap:24px; margin-bottom:32px; }
.brand { font-size:24px; font-weight:700; }
.card { border:1px solid #e5e7eb; border-radius:12px; padding:16px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
.label { font-size:12px; text-transform:uppercase; color:#6b7280; margin-bottom:4px; }
.footer { margin-top:40px; font-size:12px; color:#6b7280; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(ORCHESTRATE_LEGAL_IDENTITY.brandName)}</div>
      <h1 style="margin:12px 0 0 0;">${escapeHtml(document.title || 'Orchestrate Service Agreement')}</h1>
      <div style="margin-top:8px; color:#4b5563;">Contracting party: ${escapeHtml(ORCHESTRATE_LEGAL_IDENTITY.legalEntityName)}</div>
    </div>
    <div class="card">
      <div class="label">Agreement number</div><div>${escapeHtml(document.agreementNumber)}</div>
      <div class="label" style="margin-top:12px;">Status</div><div>${escapeHtml(document.status)}</div>
      <div class="label" style="margin-top:12px;">Effective start</div><div>${escapeHtml(formatDate(document.effectiveStartAt))}</div>
      <div class="label" style="margin-top:12px;">Effective end</div><div>${escapeHtml(formatDate(document.effectiveEndAt))}</div>
    </div>
  </div>
  <div class="grid">
    <div class="card">
      <div class="label">Client</div>
      <div>${escapeHtml(document.clientName)}</div>
      <div>${escapeHtml(document.clientEmail ?? '—')}</div>
    </div>
    <div class="card">
      <div class="label">Legal party</div>
      ${document.issuerLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
    </div>
  </div>
  <div class="card">
    <div class="label">Terms</div>
    <div>${termsHtml}</div>
  </div>
  <div class="grid" style="margin-top:24px;">
    <div class="card">
      <div class="label">Accepted by</div>
      <div>${escapeHtml(document.acceptedByName ?? 'Pending acceptance')}</div>
      <div>${escapeHtml(document.acceptedByEmail ?? '')}</div>
    </div>
    <div class="card">
      <div class="label">Accepted at</div>
      <div>${escapeHtml(formatDate(document.acceptedAt))}</div>
    </div>
  </div>
  <div class="footer">${escapeHtml(document.relationshipStatement)}</div>
</body>
</html>`;
  }
}
