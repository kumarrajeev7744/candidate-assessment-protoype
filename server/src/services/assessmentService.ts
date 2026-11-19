import { Types } from 'mongoose';
import {
  Candidate,
  Invitation,
  Question,
  Response,
  TOTAL_QUESTIONS,
  WRITTEN_ANSWER_MAX_LENGTH,
  type InvitationStatus,
  type VideoUploadStatus,
} from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { CandidateSession } from '../types/assessment.js';

export const VIDEO_MAX_SECONDS = 120;

export type QuestionProgressStatus = 'Not Started' | 'In Progress' | 'Complete';

export interface SavedResponseDto {
  questionId: string;
  writtenAnswer: string;
  videoStatus: VideoUploadStatus | 'Missing';
  updatedAt: string;
}

export interface AssessmentQuestionDto {
  id: string;
  questionNumber: number;
  questionText: string;
  status: QuestionProgressStatus;
  response: SavedResponseDto | null;
}

export interface AssessmentInfoDto {
  status: InvitationStatus;
  expiresAt: string;
  totalQuestions: number;
  writtenAnswerMaxLength: number;
  videoMaxSeconds: number;
}

export interface AssessmentDto {
  candidate: { name: string; email: string };
  assessment: AssessmentInfoDto;
  questions: AssessmentQuestionDto[];
  progress: { writtenAnswered: number; videosUploaded: number; questionsComplete: number; total: number };
}

function infoDto(status: InvitationStatus, expiresAt: Date): AssessmentInfoDto {
  return {
    status,
    expiresAt: expiresAt.toISOString(),
    totalQuestions: TOTAL_QUESTIONS,
    writtenAnswerMaxLength: WRITTEN_ANSWER_MAX_LENGTH,
    videoMaxSeconds: VIDEO_MAX_SECONDS,
  };
}

async function loadCandidate(session: CandidateSession) {
  const candidate = await Candidate.findById(session.candidateId).select('name email').lean();
  if (!candidate) throw new AppError(404, 'Candidate not found.', 'CANDIDATE_NOT_FOUND');
  return { name: candidate.name, email: candidate.email };
}

async function loadActiveQuestions() {
  const questions = await Question.find({ isActive: true }).sort({ questionNumber: 1 }).lean();
  if (questions.length !== TOTAL_QUESTIONS) {
    logger.error('Assessment questions misconfigured', { activeQuestions: questions.length });
    throw new AppError(503, 'The assessment is not available right now. Please try again later.', 'ASSESSMENT_UNAVAILABLE');
  }
  return questions;
}

export function toResponseDto(r: {
  questionId: Types.ObjectId;
  writtenAnswer: string;
  video?: { uploadStatus: VideoUploadStatus } | null;
  updatedAt: Date;
}): SavedResponseDto {
  return {
    questionId: r.questionId.toString(),
    writtenAnswer: r.writtenAnswer,
    videoStatus: r.video?.uploadStatus ?? 'Missing',
    updatedAt: r.updatedAt.toISOString(),
  };
}

function questionStatus(response: SavedResponseDto | null): QuestionProgressStatus {
  if (!response) return 'Not Started';
  const hasWritten = response.writtenAnswer.trim().length > 0;
  const hasVideo = response.videoStatus === 'Uploaded';
  if (hasWritten && hasVideo) return 'Complete';
  return hasWritten || hasVideo ? 'In Progress' : 'Not Started';
}

/**
 * Moves an Invited assessment to In Progress (only on the candidate's explicit Start action).
 * Already In Progress assessments are resumed unchanged.
 */
export async function startAssessment(session: CandidateSession) {
  let status = session.status;
  if (status === 'Invited') {
    // Conditional update makes concurrent starts safe and never touches completed invitations.
    await Invitation.updateOne({ _id: session.invitationId, status: 'Invited' }, { $set: { status: 'In Progress' } });
    const fresh = await Invitation.findById(session.invitationId).select('status').lean();
    status = fresh?.status ?? 'In Progress';
    if (status === 'Completed') {
      throw new AppError(409, 'This assessment has already been submitted. Thank you!', 'ASSESSMENT_COMPLETED');
    }
    logger.info('Assessment started', { invitationId: session.invitationId.toString() });
  }
  return { candidate: await loadCandidate(session), assessment: infoDto(status, session.expiresAt) };
}

/** Returns the candidate's own assessment: fixed questions in order plus their saved responses. */
export async function getAssessment(session: CandidateSession): Promise<AssessmentDto> {
  const [candidate, questions, responses] = await Promise.all([
    loadCandidate(session),
    loadActiveQuestions(),
    // Scoped to the token's candidate only.
    Response.find({ candidateId: session.candidateId }).lean(),
  ]);

  const byQuestion = new Map(responses.map((r) => [r.questionId.toString(), toResponseDto(r)]));
  const items: AssessmentQuestionDto[] = questions.map((q) => {
    const response = byQuestion.get(q._id.toString()) ?? null;
    return {
      id: q._id.toString(),
      questionNumber: q.questionNumber,
      questionText: q.questionText,
      status: questionStatus(response),
      response,
    };
  });

  return {
    candidate,
    assessment: infoDto(session.status, session.expiresAt),
    questions: items,
    progress: {
      writtenAnswered: items.filter((i) => (i.response?.writtenAnswer.trim().length ?? 0) > 0).length,
      videosUploaded: items.filter((i) => i.response?.videoStatus === 'Uploaded').length,
      questionsComplete: items.filter((i) => i.status === 'Complete').length,
      total: items.length,
    },
  };
}

/** Saves (insert or update) the candidate's written answer for one active question. */
export async function saveWrittenAnswer(
  session: CandidateSession,
  questionId: string,
  writtenAnswer: string,
): Promise<SavedResponseDto> {
  if (session.status !== 'In Progress') {
    throw new AppError(409, 'Please start the assessment before answering questions.', 'ASSESSMENT_NOT_STARTED');
  }
  if (!/^[a-f0-9]{24}$/i.test(questionId)) {
    throw new AppError(400, 'Invalid question ID.', 'INVALID_ID');
  }
  const question = await Question.exists({ _id: questionId, isActive: true });
  if (!question) throw new AppError(404, 'Question not found.', 'QUESTION_NOT_FOUND');

  const filter = { candidateId: session.candidateId, questionId: new Types.ObjectId(questionId) };
  const upsert = () =>
    Response.findOneAndUpdate(
      filter,
      { $set: { writtenAnswer }, $setOnInsert: filter },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true, lean: true },
    );

  let saved;
  try {
    saved = await upsert();
  } catch (err) {
    // Two simultaneous first saves can race on the unique index; the retry becomes an update.
    if ((err as { code?: number }).code !== 11000) throw err;
    saved = await upsert();
  }
  if (!saved) throw new AppError(500, 'Could not save the response.', 'SAVE_FAILED');
  return toResponseDto(saved);
}
