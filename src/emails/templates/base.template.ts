export function renderBaseEmail(params: {
  title: string;
  previewText?: string;
  contentHtml: string;
}) {
  const logoUrl =
    process.env.EMAIL_LOGO_URL ||
    'https://orchestrateops.com/orchestrate-logo.png';

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
        color: #111;
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
        border-radius: 12px;
        padding: 32px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.04);
      }
      .logo {
        text-align: center;
        margin-bottom: 24px;
      }
      .logo img {
        display: block;
        margin: 0 auto;
      }
      h1 {
        font-size: 20px;
        margin-bottom: 16px;
        font-weight: 600;
      }
      p {
        font-size: 14px;
        line-height: 1.6;
        margin: 12px 0;
      }
      .button {
        display: inline-block;
        margin-top: 20px;
        padding: 12px 20px;
        background: #111;
        color: #fff !important;
        text-decoration: none;
        border-radius: 8px;
        font-size: 14px;
      }
      .footer {
        margin-top: 32px;
        font-size: 12px;
        color: #666;
        line-height: 1.5;
      }
      .divider {
        margin: 24px 0;
        height: 1px;
        background: #eee;
      }
    </style>
  </head>
  <body>
    <div class="preheader">${params.previewText || ''}</div>

    <div class="container">
      <div class="logo">
        <img
          src="${logoUrl}"
          alt="Orchestrate"
          width="140"
          style="display:block; margin:0 auto;"
        />
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