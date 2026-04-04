import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { chromium, Browser } from 'playwright';
import { PrismaService } from '../database/prisma.service';
import { InvoiceDocumentBuilder } from './dto/invoice-document.builder';
import { InvoiceHtmlRenderer } from './dto/invoice-html.renderer';

@Injectable()
export class InvoicePdfService implements OnModuleDestroy {
  private browserPromise: Promise<Browser> | null = null;

  constructor(
    private readonly db: PrismaService,
    private readonly invoiceDocumentBuilder: InvoiceDocumentBuilder,
    private readonly invoiceHtmlRenderer: InvoiceHtmlRenderer,
  ) {}

  async generatePdfBuffer(invoiceId: string): Promise<Buffer> {
    const document = await this.invoiceDocumentBuilder.buildByInvoiceId(invoiceId);
    const html = this.invoiceHtmlRenderer.render(document);
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: 'networkidle' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '24px',
          right: '24px',
          bottom: '24px',
          left: '24px',
        },
      });

      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async generateAndPersistPdf(invoiceId: string): Promise<{
    invoiceId: string;
    invoiceNumber: string;
    filename: string;
    pdfBase64: string;
  }> {
    const invoice = await this.db.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const pdfBuffer = await this.generatePdfBuffer(invoiceId);
    const filename = `${invoice.invoiceNumber}.pdf`;

    await this.db.invoice.update({
      where: { id: invoiceId },
      data: {
        pdfGeneratedAt: new Date(),
      },
    });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      filename,
      pdfBase64: pdfBuffer.toString('base64'),
    };
  }

  async onModuleDestroy() {
    if (!this.browserPromise) return;

    const browser = await this.browserPromise;
    await browser.close();
    this.browserPromise = null;
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({
        headless: true,
      });
    }

    return this.browserPromise;
  }
}