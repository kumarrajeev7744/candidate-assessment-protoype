import { escapeHtml, formatDateTime } from '../../../utils/html.js';
import { TOTAL_QUESTIONS, WRITTEN_ANSWER_MAX_LENGTH } from '../../../models/constants.js';
import type { EmailMessage } from '../emailService.js';
import { renderButton, renderEmailLayout } from './layout.js';

export const VIDEO_MAX_MINUTES = 2;

export interface InvitationEmailInput {
  to: string;
  candidateName: string;
  invitationUrl: string;
  expiresAt: Date;
  timeZone: string;
}

export function buildInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const name = escapeHtml(input.candidateName);
  const expiry = formatDateTime(input.expiresAt, input.timeZone);
  const writtenLimit = WRITTEN_ANSWER_MAX_LENGTH.toLocaleString('en-US');

  const bodyHtml = `
<p style="margin:0 0 16px;">Dear ${name},</p>
<p style="margin:0 0 16px;">You have been invited to complete an online assessment as part of our recruitment process.</p>
<p style="margin:0 0 8px;font-weight:bold;">About the assessment</p>
<ul style="margin:0 0 16px;padding-left:20px;">
  <li>The assessment contains <strong>${TOTAL_QUESTIONS} questions</strong>, answered in order.</li>
  <li>Each question requires a <strong>written response</strong> and a <strong>video response</strong>.</li>
  <li>Written responses are limited to <strong>${writtenLimit} characters</strong>.</li>
  <li>Video responses are limited to <strong>${VIDEO_MAX_MINUTES} minutes</strong>.</li>
  <li>Please use a computer with a working camera and microphone, a modern browser and a stable internet connection.</li>
  <li>You can leave and resume later using the same link, until you submit.</li>
</ul>
<p style="margin:0 0 4px;">This invitation expires on <strong>${escapeHtml(expiry)}</strong>.</p>
${renderButton(input.invitationUrl, 'Start Assessment')}
<p style="margin:0 0 8px;font-size:13px;color:#5b6776;">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0 0 16px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(input.invitationUrl)}" style="color:#1f4e79;">${escapeHtml(input.invitationUrl)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#5b6776;">This link is personal to you. Please do not share it.</p>
<p style="margin:0;">Best regards,<br>The Recruitment Team</p>`;

  const text = [
    `Dear ${input.candidateName},`,
    '',
    'You have been invited to complete an online assessment as part of our recruitment process.',
    '',
    'About the assessment:',
    `- ${TOTAL_QUESTIONS} questions, answered in order.`,
    '- Each question requires a written response and a video response.',
    `- Written responses: maximum ${writtenLimit} characters.`,
    `- Video responses: maximum ${VIDEO_MAX_MINUTES} minutes.`,
    '- Use a computer with a camera and microphone, a modern browser and a stable connection.',
    '- You can leave and resume later using the same link, until you submit.',
    '',
    `This invitation expires on ${expiry}.`,
    '',
    `Start Assessment: ${input.invitationUrl}`,
    '',
    'This link is personal to you. Please do not share it.',
    '',
    'Best regards,',
    'The Recruitment Team',
  ].join('\n');

  return {
    to: input.to,
    subject: 'Your assessment invitation',
    html: renderEmailLayout({ title: 'Your assessment invitation', bodyHtml }),
    text,
  };
}
