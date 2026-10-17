/**
 * Email template: payment-receipt
 * Real customer payment receipt template for Commons.pk
 */

export interface ReceiptEmailData {
  customerEmail: string;
  orderId: string;
  creatorName: string;
  creatorUsername: string;
  tierName: string;
  amountPKR: number;
  interval: string;
  paymentDate: string;
  renewalDate?: string;
  cardLast4?: string;
  accessUrl: string;
  manageUrl: string;
}

export const generateReceiptHtml = (data: ReceiptEmailData): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Receipt — Commons</title>
  <style>
    body { margin: 0; padding: 0; background-color: #F6F7F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #151515; line-height: 1.5; }
    table { border-collapse: collapse; }
    .wrapper { width: 100%; background-color: #F6F7F9; padding: 40px 16px 60px; }
    .container { max-width: 580px; margin: 0 auto; background-color: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden; }
    .brand-header { padding: 28px 36px 20px; border-bottom: 1px solid #F0F1F3; }
    .receipt-hero { padding: 32px 36px 24px; border-bottom: 1px solid #F0F1F3; }
    .status-badge { display: inline-block; background-color: #EAFBEE; color: #0F5132; border: 1px solid #98E9AB; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 10px; border-radius: 4px; margin-bottom: 14px; }
    .hero-title { font-size: 22px; font-weight: 800; color: #151515; margin: 0 0 6px 0; }
    .hero-subtitle { font-size: 14px; color: #555555; margin: 0 0 20px 0; }
    .amount-box { background-color: #FAFAFB; border: 1px solid #EEEEF0; border-radius: 6px; padding: 18px 22px; }
    .amount-label { font-size: 12px; font-weight: 600; color: #71717A; text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 4px 0; }
    .amount-value { font-size: 32px; font-weight: 800; color: #151515; margin: 0; }
    .receipt-body { padding: 28px 36px; }
    .section-title { font-size: 12px; font-weight: 700; color: #71717A; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 14px 0; }
    .items-table { width: 100%; margin-bottom: 24px; }
    .items-table th { font-size: 12px; font-weight: 600; color: #71717A; text-align: left; padding: 8px 0; border-bottom: 1px solid #E5E7EB; }
    .items-table td { padding: 14px 0; font-size: 14px; color: #151515; border-bottom: 1px solid #F0F1F3; vertical-align: top; }
    .item-name { font-weight: 700; color: #151515; margin: 0 0 4px 0; }
    .item-meta { font-size: 13px; color: #666666; margin: 0; }
    .summary-row td { padding: 8px 0; font-size: 13px; color: #555555; }
    .summary-row.total-row td { padding-top: 12px; font-size: 15px; font-weight: 800; color: #151515; border-top: 1px solid #E5E7EB; }
    .info-table { width: 100%; margin: 20px 0 28px; background-color: #FAFAFB; border: 1px solid #EEEEF0; border-radius: 6px; padding: 16px 20px; }
    .info-row td { padding: 6px 0; font-size: 13px; }
    .info-label { color: #71717A; width: 42%; font-weight: 500; }
    .info-value { color: #151515; font-weight: 600; text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
    .btn-primary { display: inline-block; background-color: #AE7AFF; color: #151515 !important; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 4px; border: 1px solid #151515; }
    .manage-text { font-size: 12px; color: #71717A; text-align: center; margin: 12px 0 0; }
    .manage-text a { color: #151515; text-decoration: underline; }
    .receipt-footer { background-color: #FAFAFB; padding: 24px 36px; border-top: 1px solid #E5E7EB; font-size: 12px; color: #71717A; line-height: 1.6; }
    .footer-links a { color: #555555; text-decoration: underline; margin-right: 14px; }
    @media only screen and (max-width: 600px) {
      .brand-header, .receipt-hero, .receipt-body, .receipt-footer { padding-left: 20px !important; padding-right: 20px !important; }
      .amount-value { font-size: 26px !important; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="brand-header">
        <tr>
          <td>
            <table cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="vertical-align: middle; padding-right: 10px;">
                  <svg width="28" height="28" viewBox="80 85 640 640" xmlns="http://www.w3.org/2000/svg" style="display: block;">
                    <defs>
                      <mask id="receiptBubbleMask">
                        <rect width="100%" height="100%" fill="white" />
                        <circle cx="270" cy="400" r="45" fill="black" />
                        <circle cx="400" cy="400" r="45" fill="black" />
                        <circle cx="530" cy="400" r="45" fill="black" />
                      </mask>
                    </defs>
                    <path d="M 250 200 L 550 200 A 150 150 0 0 1 700 350 L 700 450 A 150 150 0 0 1 550 600 L 330 600 L 210 740 L 250 600 A 150 150 0 0 1 100 450 L 100 350 A 150 150 0 0 1 250 200 Z" fill="#AE7AFF" mask="url(#receiptBubbleMask)" />
                  </svg>
                </td>
                <td style="vertical-align: middle;">
                  <span style="font-size: 20px; font-weight: 800; color: #151515; line-height: 1;">Commons</span>
                </td>
              </tr>
            </table>
          </td>
          <td style="text-align: right; vertical-align: middle;">
            <span style="font-size: 12px; font-weight: 700; color: #71717A; text-transform: uppercase; letter-spacing: 0.05em;">Payment Receipt</span>
          </td>
        </tr>
      </table>

      <div class="receipt-hero">
        <span class="status-badge">&#10003; Payment Successful</span>
        <h1 class="hero-title">Thank you for your payment</h1>
        <p class="hero-subtitle">Here is your receipt for your monthly membership to <strong>${data.creatorName}</strong> on Commons.</p>
        
        <div class="amount-box">
          <div class="amount-label">Total Amount Paid</div>
          <div class="amount-value">PKR ${data.amountPKR.toLocaleString()}</div>
        </div>
      </div>

      <div class="receipt-body">
        <div class="section-title">Order Summary</div>
        
        <table class="items-table" cellpadding="0" cellspacing="0" role="presentation">
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align: center; width: 80px;">Interval</th>
              <th style="text-align: right; width: 100px;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="item-name">${data.tierName}</div>
                <p class="item-meta">Creator: <strong>${data.creatorName}</strong> (@${data.creatorUsername})</p>
                <p class="item-meta" style="color: #888888; font-size: 12px; margin-top: 2px;">Billing Period: ${data.paymentDate.split(',')[0]} – ${data.renewalDate || ''}</p>
              </td>
              <td style="text-align: center; color: #555555; vertical-align: top;">
                ${data.interval}
              </td>
              <td style="text-align: right; font-weight: 700; color: #151515; vertical-align: top;">
                PKR ${data.amountPKR.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom: 24px;">
          <tr class="summary-row">
            <td style="text-align: left;">Subtotal</td>
            <td style="text-align: right;">PKR ${data.amountPKR.toLocaleString()}</td>
          </tr>
          <tr class="summary-row">
            <td style="text-align: left;">Taxes &amp; Processing Fees</td>
            <td style="text-align: right;">PKR 0</td>
          </tr>
          <tr class="summary-row total-row">
            <td style="text-align: left;">Total Paid</td>
            <td style="text-align: right; color: #151515;">PKR ${data.amountPKR.toLocaleString()}</td>
          </tr>
        </table>

        <div class="section-title">Payment Information</div>
        <table class="info-table" cellpadding="0" cellspacing="0" role="presentation">
          <tr class="info-row">
            <td class="info-label">Order ID</td>
            <td class="info-value mono">${data.orderId}</td>
          </tr>
          <tr class="info-row">
            <td class="info-label">Billed To</td>
            <td class="info-value">${data.customerEmail}</td>
          </tr>
          <tr class="info-row">
            <td class="info-label">Payment Date</td>
            <td class="info-value">${data.paymentDate}</td>
          </tr>
          <tr class="info-row">
            <td class="info-label">Payment Method</td>
            <td class="info-value">${data.cardLast4 ? `Card ending in ${data.cardLast4}` : 'Debit / Credit Card'}</td>
          </tr>
          <tr class="info-row">
            <td class="info-label">Billing Frequency</td>
            <td class="info-value">${data.interval} recurring</td>
          </tr>
          ${data.renewalDate ? `
          <tr class="info-row">
            <td class="info-label">Next Renewal Date</td>
            <td class="info-value" style="color: #151515; font-weight: 700;">${data.renewalDate} (PKR ${data.amountPKR.toLocaleString()})</td>
          </tr>` : ''}
        </table>

        <div style="text-align: center; padding: 8px 0 16px;">
          <a href="${data.accessUrl}" class="btn-primary" target="_blank">Access Your Membership</a>
          <p class="manage-text">
            Need to change your billing details or cancel? You can manage your subscription anytime in your <a href="${data.manageUrl}" target="_blank">Account Settings</a>.
          </p>
        </div>
      </div>

      <div class="receipt-footer">
        <p style="margin: 0 0 6px 0; font-weight: 700; color: #151515;">
          Commons Technologies (SMC-Private) Limited
        </p>
        <p style="margin: 0 0 10px 0;">
          H NO 131/5 ST 16 Awan Chowk Baba Farid Colony, Chungi, Lahore, Pakistan
        </p>
        <p style="margin: 0 0 14px 0;">
          For support or billing questions, contact us at <a href="mailto:support@commons.pk" style="color: #151515; font-weight: 600;">support@commons.pk</a> or call <a href="tel:+923249785408" style="color: #151515;">+92 324 9785408</a>.
        </p>
        <div class="footer-links">
          <a href="https://www.commons.pk/terms" target="_blank">Terms of Service</a>
          <a href="https://www.commons.pk/privacy" target="_blank">Privacy Policy</a>
          <a href="https://www.commons.pk/cancellation-refund" target="_blank">Refund Policy</a>
        </div>
        <p style="margin: 16px 0 0 0; font-size: 11px; color: #9A9EA5;">
          This email receipt was sent to ${data.customerEmail} for your subscription to ${data.creatorName} on Commons.pk.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;
};

export const receiptTemplate = {
  name: 'payment-receipt',
  subject: (data: ReceiptEmailData) => `Payment receipt for your subscription to ${data.creatorName} (PKR ${data.amountPKR.toLocaleString()})`,
  html: generateReceiptHtml,
};
