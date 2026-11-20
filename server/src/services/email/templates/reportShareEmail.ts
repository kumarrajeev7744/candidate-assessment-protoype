import { escapeHtml, formatDateTime } from '../../../utils/html.js';
import type { EmailMessage } from '../emailService.js';
import { renderButton, renderEmailLayout } from './layout.js';

export interface ReportShareEmailInput {
  to: string;
  candidateName: string;
  questionCount: number;
  shareUrl: string;
  expiresAt: Date;
  timeZone: string;
}

/** Email to a hiring manager with a link to a candidate's FULL assessment. Contains no answer content. */
export function buildReportShareEmail(input: ReportShareEmailInput): EmailMessage {
  const expiry = formatDateTime(input.expiresAt, input.timeZone);
  const name = escapeHtml(input.candidateName);
  const subject = `Candidate assessment shared with you: ${input.candidateName}`;

  const bodyHtml = `
<p style="margin:0 0 16px;">Hello,</p>
<p style="margin:0 0 16px;">A recruiter has shared a candidate's complete assessment with you (<strong>${escapeHtml(input.to)}</strong>).</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:15px;">
  <tr><td style="padding:2px 12px 2px 0;color:#5b6776;">Candidate</td><td style="padding:2px 0;"><strong>${name}</strong></td></tr>
  <tr><td style="padding:2px 12px 2px 0;color:#5b6776;">Includes</td><td style="padding:2px 0;">All ${input.questionCount} questions with written and video answers</td></tr>
</table>
<p style="margin:0 0 4px;">Use the button below to view the assessment. No login is required.</p>
${renderButton(input.shareUrl, 'View assessment')}
<p style="margin:0 0 8px;font-size:13px;color:#5b6776;">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(input.shareUrl)}" style="color:#1f4e79;">${escapeHtml(input.shareUrl)}</a></p>
<p style="margin:0 0 16px;"><strong>This link expires in 7 days</strong>, on ${escapeHtml(expiry)}.</p>
<p style="margin:0;font-size:13px;color:#5b6776;">This link was shared with you personally. Please do not forward it.</p>`;

  const text = [
    'Hello,',
    '',
    `A recruiter has shared a candidate's complete assessment with you (${input.to}).`,
    '',
    `Candidate: ${input.candidateName}`,
    `Includes: all ${input.questionCount} questions with written and video answers`,
    '',
    'View the assessment (no login required):',
    input.shareUrl,
    '',
    `This link expires in 7 days, on ${expiry}.`,
    '',
    'This link was shared with you personally. Please do not forward it.',
  ].join('\n');

  return { to: input.to, subject, html: renderEmailLayout({ title: 'Candidate assessment shared with you', bodyHtml }), text };
}
