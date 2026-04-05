import { Injectable } from '@nestjs/common';
import { escapeHtml, formatDate, formatDateTime, formatMoney } from '../../financial-documents/document-formatting';
import { ORCHESTRATE_LEGAL_IDENTITY } from '../../financial-documents/legal-identity';
import { ReceiptDocument } from './receipt-document.builder';

@Injectable()
export class ReceiptHtmlRenderer {
  render(document: ReceiptDocument): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(document.headerTitle)} ${escapeHtml(document.receiptNumber)}</title>
<style>
body { font-family: Arial, sans-serif; color: #111827; padding: 32px; }
.header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; }
.brand { font-size:24px; font-weight:700; }
.block { margin-bottom:24px; }
.meta { text-align:right; font-size:14px; }
.card { border:1px solid #e5e7eb; border-radius:12px; padding:16px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.label { font-size:12px; text-transform:uppercase; color:#6b7280; margin-bottom:4px; }
.value { font-size:15px; }
.amount { font-size:28px; font-weight:700; }
.footer { margin-top:40px; font-size:12px; color:#6b7280; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(ORCHESTRATE_LEGAL_IDENTITY.brandName)}</div>
      <div style="margin-top:8px; font-size:22px; font-weight:700;">${escapeHtml(document.headerTitle)}</div>
      <div style="margin-top:8px; color:#4b5563;">Payment received. Thank you.</div>
    </div>
    <div class="meta">
      <div><strong>Receipt</strong> ${escapeHtml(document.receiptNumber)}</div>
      <div>Issued ${escapeHtml(formatDate(document.issuedAt))}</div>
    </div>
  </div>
  <div class="grid block">
    <div class="card">
      <div class="label">Received from</div>
      <div class="value">${escapeHtml(document.clientName)}</div>
      <div class="value">${escapeHtml(document.clientEmail ?? '—')}</div>
    </div>
    <div class="card">
      <div class="label">Legal issuer</div>
      ${document.issuerLines.map((line) => `<div class="value">${escapeHtml(line)}</div>`).join('')}
    </div>
  </div>
  <div class="card block">
    <div class="grid">
      <div><div class="label">Amount received</div><div class="amount">${escapeHtml(formatMoney(document.amountCents, document.currencyCode))}</div></div>
      <div>
        <div class="label">Related invoice</div><div class="value">${escapeHtml(document.invoiceNumber ?? '—')}</div>
        <div class="label" style="margin-top:12px;">Payment method</div><div class="value">${escapeHtml(document.paymentMethod ?? '—')}</div>
      </div>
      <div><div class="label">Payment reference</div><div class="value">${escapeHtml(document.paymentReference ?? '—')}</div></div>
      <div><div class="label">Received at</div><div class="value">${escapeHtml(formatDateTime(document.paymentReceivedAt ?? document.issuedAt))}</div></div>
      <div><div class="label">Balance after payment</div><div class="value">${escapeHtml(document.balanceAfterPaymentCents == null ? '—' : formatMoney(document.balanceAfterPaymentCents, document.currencyCode))}</div></div>
    </div>
  </div>
  <div class="footer">
    <div>${escapeHtml(document.relationshipStatement)}</div>
    <div>${escapeHtml(ORCHESTRATE_LEGAL_IDENTITY.legalEntityAddressLines.join(' · '))}</div>
  </div>
</body>
</html>`;
  }
}
