export const INVITATION_EXPIRY_DAYS = 7;
export const SHARE_LINK_EXPIRY_DAYS = 7;

export const TOTAL_QUESTIONS = 10;
export const WRITTEN_ANSWER_MAX_LENGTH = 1000;

export const INVITATION_STATUSES = ['Invited', 'In Progress', 'Completed'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const EMAIL_STATUSES = ['Pending', 'Sent', 'Failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const VIDEO_UPLOAD_STATUSES = ['Pending', 'Uploaded', 'Failed'] as const;
export type VideoUploadStatus = (typeof VIDEO_UPLOAD_STATUSES)[number];
