import { escapeHtml, formatDateTime } from '../../../utils/html.js';
import type { EmailMessage } from '../emailService.js';
import { renderEmailLayout } from './layout.js';

export interface ConfirmationEmailInput {
  to: string;
  candidateName: string;
  completedAt: Date;
  timeZone: string;
  /** Employer name, only when configured (COMPANY_NAME). */
  companyName?: string;
}

/** Submission confirmation. Contains no responses, videos, IDs or links. */
export function buildConfirmationEmail(input: ConfirmationEmailInput): EmailMessage {
  const completed = formatDateTime(input.completedAt, input.timeZone);
  const company = input.companyName?.trim();
  const forCompany = company ? ` for ${company}` : '';
  const team = company ? `The ${company} Recruitment Team` : 'The Recruitment Team';

  const bodyHtml = `
<p style="margin:0 0 16px;">Dear ${escapeHtml(input.candidateName)},</p>
<p style="margin:0 0 16px;">Thank you for completing your assessment${escapeHtml(forCompany)}.</p>
<p style="margin:0 0 16px;">We confirm that your assessment was <strong>submitted successfully</strong> on <strong>${escapeHtml(completed)}</strong>.</p>
<p style="margin:0 0 16px;">Your written and video responses have been received. No further action is needed from you, and your responses can no longer be changed.</p>
<p style="margin:0 0 16px;">Thank you for the time and effort you put into your answers.</p>
<p style="margin:0;">Best regards,<br>${escapeHtml(team)}</p>`;

  const text = [
    `Dear ${input.candidateName},`,
    '',
    `Thank you for completing your assessment${forCompany}.`,
    '',
    `We confirm that your assessment was submitted successfully on ${completed}.`,
    '',
    'Your written and video responses have been received. No further action is needed from you, and your responses can no longer be changed.',
    '',
    'Thank you for the time and effort you put into your answers.',
    '',
    'Best regards,',
    team,
  ].join('\n');

  return {
    to: input.to,
    subject: 'Your assessment has been submitted',
    html: renderEmailLayout({ title: 'Assessment submitted', bodyHtml }),
    text,
  };
}
