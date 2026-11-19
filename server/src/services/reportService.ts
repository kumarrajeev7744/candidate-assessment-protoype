import { Types } from 'mongoose';
import { Candidate, Invitation, Response, type InvitationStatus } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { isExpired } from '../utils/dates.js';
import { loadActiveQuestions } from './assessmentService.js';
import { toVideoPlayback, type VideoPlaybackDto } from './videoPlayback.js';

export type ReportQuestionStatus = 'Complete' | 'Incomplete' | 'Not Started';

export interface ReportQuestionDto {
  questionId: string;
  questionNumber: number;
  questionText: string;
  status: ReportQuestionStatus;
  response: {
    id: string;
    writtenAnswer: string;
    hasWrittenAnswer: boolean;
    video: VideoPlaybackDto;
    updatedAt: string;
  } | null;
  canShare: boolean;
}

export interface CandidateReportDto {
  candidate: { id: string; name: string; email: string };
  assessment: {
    status: InvitationStatus;
    invitedAt: string;
    expiresAt: string;
    completedAt: string | null;
    isExpired: boolean;
  };
  questions: ReportQuestionDto[];
  summary: { completedQuestions: number; totalQuestions: number };
}

export function assertObjectId(value: string, label: string): void {
  if (!/^[a-f0-9]{24}$/i.test(value) || !Types.ObjectId.isValid(value)) {
    throw new AppError(400, `Invalid ${label} ID.`, 'INVALID_ID');
  }
}

/** Recruiter report: the candidate, their assessment status and all 10 questions with responses. */
export async function getCandidateReport(candidateId: string): Promise<CandidateReportDto> {
  assertObjectId(candidateId, 'candidate');
  const candidate = await Candidate.findById(candidateId).select('name email').lean();
  if (!candidate) throw new AppError(404, 'Candidate not found.', 'CANDIDATE_NOT_FOUND');
  const invitation = await Invitation.findOne({ candidateId: candidate._id })
    .select('status invitedAt expiresAt completedAt')
    .lean();
  if (!invitation) throw new AppError(404, 'No assessment found for this candidate.', 'CANDIDATE_NOT_FOUND');

  const [questions, responses] = await Promise.all([
    loadActiveQuestions(),
    Response.find({ candidateId: candidate._id }).lean(),
  ]);
  const byQuestion = new Map(responses.map((r) => [r.questionId.toString(), r]));
  const completed = invitation.status === 'Completed';

  const items = await Promise.all(
    questions.map(async (q): Promise<ReportQuestionDto> => {
      const r = byQuestion.get(q._id.toString());
      const hasWritten = Boolean(r?.writtenAnswer.trim());
      const video = await toVideoPlayback(r?.video);
      const hasVideo = video.status === 'Uploaded';
      const status: ReportQuestionStatus = hasWritten && hasVideo ? 'Complete' : hasWritten || hasVideo ? 'Incomplete' : 'Not Started';
      return {
        questionId: q._id.toString(),
        questionNumber: q.questionNumber,
        questionText: q.questionText,
        status,
        response: r
          ? { id: r._id.toString(), writtenAnswer: r.writtenAnswer, hasWrittenAnswer: hasWritten, video, updatedAt: r.updatedAt.toISOString() }
          : null,
        // Final answers only: shareable once the candidate has submitted and the response has content.
        canShare: completed && Boolean(r) && (hasWritten || hasVideo),
      };
    }),
  );

  return {
    candidate: { id: candidate._id.toString(), name: candidate.name, email: candidate.email },
    assessment: {
      status: invitation.status,
      invitedAt: invitation.invitedAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      completedAt: invitation.completedAt ? invitation.completedAt.toISOString() : null,
      isExpired: !completed && isExpired(invitation.expiresAt),
    },
    questions: items,
    summary: { completedQuestions: items.filter((i) => i.status === 'Complete').length, totalQuestions: items.length },
  };
}
