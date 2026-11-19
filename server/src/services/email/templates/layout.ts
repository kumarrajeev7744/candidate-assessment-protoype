import { escapeHtml } from '../../../utils/html.js';

/** Shared, inline-styled HTML shell for transactional emails (email clients ignore <style> blocks). */
export function renderEmailLayout(options: { title: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(options.title)}</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1d2733;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#1f4e79;color:#ffffff;padding:16px 24px;font-size:16px;font-weight:bold;">Candidate Assessment</td></tr>
        <tr><td style="padding:24px;font-size:15px;line-height:1.55;">${options.bodyHtml}</td></tr>
      </table>
      <p style="font-size:12px;color:#5b6776;margin:16px 0 0;">This is an automated message. Please do not reply to this email.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#1f4e79;border-radius:6px;">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:bold;">${escapeHtml(label)}</a>
</td></tr></table>`;
}
