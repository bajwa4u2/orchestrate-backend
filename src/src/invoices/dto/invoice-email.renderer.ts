import { Injectable } from '@nestjs/common';
import { InvoiceDocument } from './invoice-document.builder';

export type InvoiceEmailPayload = {
  subject: string;
  text: string;
  variables: Record<string, unknown>;
};

type InvoiceRecipient = {
  name?: string | null;
  email: string;
};

type InvoiceOrganization = {
  displayName?: string | null;
  currencyCode?: string | null;
};

@Injectable()
export class InvoiceEmailRenderer {
  render(params: {
    invoice: InvoiceDocument;
    recipient: InvoiceRecipient;
    organization?: InvoiceOrganization | null;
    invoiceUrl?: string | null;
    payUrl?: string | null;
  }): InvoiceEmailPayload {
    const currencyCode = params.organization?.currencyCode || 'USD';
    const amountDue = this.formatCurrency(params.invoice.totals.total, currencyCode);
    const issueDate = this.formatDate(params.invoice.issuedAt ?? params.invoice.createdAt);
    const dueDate = this.formatDate(params.invoice.dueAt);
    const servicePeriod = this.buildServicePeriod(params.invoice);
    const organizationName = params.organization?.displayName || 'Orchestrate';

    return {
      subject: `Invoice ${params.invoice.invoiceNumber} from ${organizationName}`,
      text: [
        `Hello${params.recipient.name ? ` ${params.recipient.name}` : ''},`,
        '',
        `Invoice ${params.invoice.invoiceNumber} is ready.`,
        `Amount due: ${amountDue}`,
        `Issue date: ${issueDate}`,
        `Due date: ${dueDate}`,
        servicePeriod ? `Service period: ${servicePeriod}` : null,
        params.payUrl ? `Pay invoice: ${params.payUrl}` : null,
        params.invoiceUrl ? `View invoice: ${params.invoiceUrl}` : null,
        '',
        'If you have any billing questions, reply to this email.',
      ]
        .filter(Boolean)
        .join('\n'),
      variables: {
        name: params.recipient.name ?? undefined,
        recipient_name: params.recipient.name ?? undefined,
        recipient_email: params.recipient.email,
        invoiceNumber: params.invoice.invoiceNumber,
        invoice_number: params.invoice.invoiceNumber,
        issueDate,
        issue_date: issueDate,
        dueDate,
        due_date: dueDate,
        amountDue,
        amount_due: amountDue,
        servicePeriod: servicePeriod ?? undefined,
        service_period: servicePeriod ?? undefined,
        invoiceUrl: params.invoiceUrl ?? undefined,
        invoice_url: params.invoiceUrl ?? undefined,
        payUrl: params.payUrl ?? params.invoiceUrl ?? undefined,
        pay_url: params.payUrl ?? params.invoiceUrl ?? undefined,
        organization_name: organizationName,
      },
    };
  }

  private buildServicePeriod(invoice: InvoiceDocument): string | null {
    const metadata = this.asObject(invoice.metadataJson);
    const period = this.asObject(metadata.servicePeriod);

    const start = this.toNullableString(period.start) ?? this.toNullableString(metadata.billingPeriodStart);
    const end = this.toNullableString(period.end) ?? this.toNullableString(metadata.billingPeriodEnd);

    if (start && end) return `${start} to ${end}`;
    if (start) return `Starting ${start}`;
    if (end) return `Through ${end}`;
    return null;
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private formatDate(value: Date | null): string {
    if (!value) return '-';
    return value.toISOString().split('T')[0];
  }

  private formatCurrency(amount: number, currencyCode: string): string {
    const normalized = Number.isFinite(amount) ? amount : 0;

    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
      }).format(normalized);
    } catch {
      return `$${normalized.toFixed(2)}`;
    }
  }
}
