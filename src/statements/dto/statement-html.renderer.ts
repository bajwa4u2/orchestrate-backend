import { Injectable } from '@nestjs/common';
import { escapeHtml, formatDate, formatMoney } from '../../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../../financial-documents/legal-identity';
import { StatementDocument } from './statement-document.builder';

@Injectable()
export class StatementHtmlRenderer {
  render(document: StatementDocument): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>Statement ${escapeHtml(document.statementNumber)}</title>
<style>
body { font-family: Arial, sans-serif; color:#111827; padding:32px; }
.header { display:flex; justify-content:space-between; gap:24px; margin-bottom:32px; }
.brand { font-size:24px; font-weight:700; }
.card { border:1px solid #e5e7eb; border-radius:12px; padding:16px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.label { font-size:12px; text-transform:uppercase; color:#6b7280; margin-bottom:4px; }
.summary { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin-top:24px; }
.footer { margin-top:40px; font-size:12px; color:#6b7280; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(ORCHESTRATE_LEGAL_IDENTITY.brandName)}</div>
      <h1 style="margin:12px 0 0 0;">Account Statement</h1>
      <div style="margin-top:8px; color:#4b5563;">${escapeHtml(document.label ?? 'Financial summary')}</div>
    </div>
    <div class="card">
      <div class="label">Statement number</div><div>${escapeHtml(document.statementNumber)}</div>
      <div class="label" style="margin-top:12px;">Period</div><div>${escapeHtml(formatDate(document.periodStart))} to ${escapeHtml(formatDate(document.periodEnd))}</div>
      <div class="label" style="margin-top:12px;">Issued</div><div>${escapeHtml(formatDate(document.issuedAt))}</div>
    </div>
  </div>
  <div class="grid">
    <div class="card"><div class="label">Client</div><div>${escapeHtml(document.clientName)}</div><div>${escapeHtml(document.clientEmail ?? '—')}</div></div>
    <div class="card"><div class="label">Legal issuer</div>${document.issuerLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>
  </div>
  <div class="summary">
    <div class="card"><div class="label">Opening balance</div><div>${escapeHtml(formatMoney(document.openingBalanceCents, document.currencyCode))}</div></div>
    <div class="card"><div class="label">Invoiced in period</div><div>${escapeHtml(formatMoney(document.invoicedDuringPeriodCents, document.currencyCode))}</div><div>${document.invoiceCount} invoice(s)</div></div>
    <div class="card"><div class="label">Payments in period</div><div>${escapeHtml(formatMoney(document.paidDuringPeriodCents, document.currencyCode))}</div><div>${document.paymentCount} payment(s)</div></div>
    <div class="card"><div class="label">Credits in period</div><div>${escapeHtml(formatMoney(document.creditedDuringPeriodCents, document.currencyCode))}</div><div>${document.creditCount} credit note(s)</div></div>
    <div class="card" style="grid-column:1 / span 2;"><div class="label">Closing balance</div><div style="font-size:28px; font-weight:700;">${escapeHtml(formatMoney(document.closingBalanceCents, document.currencyCode))}</div></div>
  </div>
  <div class="footer">${escapeHtml(document.relationshipStatement)}</div>
</body>
</html>`;
  }
}
