import { renderBaseEmail } from './base.template';

export function agreementSignedTemplate(params: {
  name?: string;
  agreementTitle?: string;
  agreementReference?: string;
  signedDate?: string;
  downloadUrl?: string;
}) {
  const greeting = params.name ? `Hi ${params.name},` : 'Hello,';

  return renderBaseEmail({
    title: 'Agreement signed confirmation',
    previewText: 'This confirms that your agreement has been signed.',
    contentHtml: `
      <h1>Agreement signed confirmation</h1>

      <p>${greeting}</p>

      <p>This confirms that your service agreement has been signed.</p>

      <p>
        The contracting legal party is <strong>Aura Platform LLC</strong>.
      </p>

      ${params.agreementTitle ? `<p><strong>Agreement:</strong> ${params.agreementTitle}</p>` : ''}
      ${params.agreementReference ? `<p><strong>Reference:</strong> ${params.agreementReference}</p>` : ''}
      ${params.signedDate ? `<p><strong>Signed date:</strong> ${params.signedDate}</p>` : ''}

      ${
        params.downloadUrl
          ? `<a href="${params.downloadUrl}" class="button">Download Signed Agreement</a>`
          : ''
      }

      <p>
        Keep this email for your records.
      </p>
    `,
  });
}