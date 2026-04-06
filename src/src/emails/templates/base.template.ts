export function renderBaseEmail(params: {
  title: string;
  previewText?: string;
  contentHtml: string;
}) {
  const logoUrl =
    process.env.EMAIL_LOGO_URL ||
    'https://orchestrateops.com/orchestrate-logo.png';

  const brandName = process.env.EMAIL_BRAND_NAME || 'Orchestrate';

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>${params.title}</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #f6f7f9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #111827;
      }
      .preheader {
        display: none !important;
        visibility: hidden;
        opacity: 0;
        color: transparent;
        height: 0;
        width: 0;
        overflow: hidden;
        mso-hide: all;
      }
      .container {
        max-width: 560px;
        margin: 40px auto;
        background: #ffffff;
        border-radius: 16px;
        padding: 32px;
        box-shadow: 0 2px 10px rgba(15,23,42,0.05);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 28px;
      }
      .brand-mark {
        width: 40px;
        height: 40px;
        border-radius: 999px;
        border: 1px solid #e5e7eb;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background: #ffffff;
      }
      .brand-mark img {
        display: block;
        width: 28px;
        height: 28px;
      }
      .brand-text {
        font-size: 18px;
        line-height: 1.2;
        font-weight: 700;
        color: #0f172a;
        letter-spacing: -0.02em;
      }
      h1 {
        font-size: 24px;
        line-height: 1.2;
        margin: 0 0 16px 0;
        font-weight: 700;
        color: #111827;
        letter-spacing: -0.02em;
      }
      p {
        font-size: 14px;
        line-height: 1.7;
        margin: 12px 0;
        color: #374151;
      }
      .button {
        display: inline-block;
        margin-top: 20px;
        padding: 12px 20px;
        background: #111827;
        color: #ffffff !important;
        text-decoration: none;
        border-radius: 10px;
        font-size: 14px;
      }
      .footer {
        margin-top: 32px;
        font-size: 12px;
        color: #667085;
        line-height: 1.7;
      }
      .divider {
        margin: 24px 0;
        height: 1px;
        background: #e5e7eb;
      }
      @media only screen and (max-width: 600px) {
        .container {
          margin: 16px;
          padding: 24px;
        }
      }
    </style>
  </head>
  <body>
    <div class="preheader">${params.previewText || ''}</div>

    <div class="container">
      <div class="brand">
        <div class="brand-mark">
          <img
            src="${logoUrl}"
            alt="${brandName}"
            width="28"
            height="28"
            style="display:block;"
          />
        </div>
        <div class="brand-text">${brandName}</div>
      </div>

      ${params.contentHtml}

      <div class="divider"></div>

      <div class="footer">
        Orchestrate is a product of Aura Platform LLC<br/>
        40065 Eaton St Apt 101<br/>
        Canton, MI 48187<br/>
        United States
      </div>
    </div>
  </body>
  </html>
  `;
}
