import { escapeHtml, formatDateTime } from '../../../utils/html.js';
import type { EmailMessage } from '../emailService.js';
import { renderButton, renderEmailLayout } from './layout.js';

export interface ShareEmailInput {
  to: string;
  candidateName: string;
  questionNumber: number;
  questionText: string;
  shareUrl: string;
  expiresAt: Date;
  timeZone: string;
}

/** Email to a hiring manager with a link to ONE candidate response. Contains no answer content. */
export function buildShareEmail(input: ShareEmailInput): EmailMessage {
  const expiry = formatDateTime(input.expiresAt, input.timeZone);
  const name = escapeHtml(input.candidateName);
  const subject = `Candidate response shared with you: ${input.candidateName} – Question ${input.questionNumber}`;

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello,</p>
<p style="margin:0 0 16px;">A recruiter has shared a candidate's assessment response with you (<strong>${escapeHtml(input.to)}</strong>).</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:15px;">
  <tr><td style="padding:2px 12px 2px 0;color:#5b6776;">Candidate</td><td style="padding:2px 0;"><strong>${name}</strong></td></tr>
  <tr><td style="padding:2px 12px 2px 0;color:#5b6776;vertical-align:top;">Question ${input.questionNumber}</td><td style="padding:2px 0;">${escapeHtml(input.questionText)}</td></tr>
</table>
<p style="margin:0 0 4px;">Use the button below to view the written answer and video for this question only. No login is required.</p>
${renderButton(input.shareUrl, 'View response')}
<p style="margin:0 0 8px;font-size:13px;color:#5b6776;">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(input.shareUrl)}" style="color:#1f4e79;">${escapeHtml(input.shareUrl)}</a></p>
<p style="margin:0 0 16px;"><strong>This link expires in 7 days</strong>, on ${escapeHtml(expiry)}.</p>
<p style="margin:0;font-size:13px;color:#5b6776;">This link was shared with you personally. Please do not forward it.</p>`;

  const text = [
    'Hello,',
    '',
    `A recruiter has shared a candidate's assessment response with you (${input.to}).`,
    '',
    `Candidate: ${input.candidateName}`,
    `Question ${input.questionNumber}: ${input.questionText}`,
    '',
    'View the written answer and video for this question only (no login required):',
    input.shareUrl,
    '',
    `This link expires in 7 days, on ${expiry}.`,
    '',
    'This link was shared with you personally. Please do not forward it.',
  ].join('\n');

  return { to: input.to, subject, html: renderEmailLayout({ title: 'Candidate response shared with you', bodyHtml }), text };
}
