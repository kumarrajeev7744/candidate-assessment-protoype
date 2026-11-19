import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { useTestDatabase } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { Admin, Candidate, Invitation, Question, Response } from '../src/models/index.js';
import { questionSeedData } from '../src/seed/questionSeedData.js';
import { seedQuestions } from '../src/services/questionSeedService.js';
import { signAdminToken } from '../src/utils/jwt.js';
import { generateToken, hashToken } from '../src/utils/token.js';

useTestDatabase();

const app = createApp();
const DAY_MS = 24 * 60 * 60 * 1000;

interface Fixture {
  token: string;
  candidateId: mongoose.Types.ObjectId;
  invitationId: mongoose.Types.ObjectId;
}

async function createCandidate(
  email: string,
  overrides: Partial<{ status: 'Invited' | 'In Progress' | 'Completed'; expiresAt: Date; completedAt: Date }> = {},
): Promise<Fixture> {
  const candidate = await Candidate.create({ name: `Name ${email}`, email });
  const token = generateToken();
  const invitation = await Invitation.create({
    candidateId: candidate._id,
    tokenHash: hashToken(token),
    emailStatus: 'Sent',
    ...overrides,
  });
  return { token, candidateId: candidate._id, invitationId: invitation._id };
}

const start = (token?: string) => {
  const req = request(app).post('/api/assessment/start');
  return token === undefined ? req : req.set('X-Assessment-Token', token);
};
const getAssessment = (token: string) => request(app).get('/api/assessment').set('X-Assessment-Token', token);
const save = (token: string, questionId: string, body: unknown) =>
  request(app)
    .put(`/api/assessment/questions/${questionId}/response`)
    .set('X-Assessment-Token', token)
    .send(body as object);

let questionIds: string[];

beforeEach(async () => {
  await seedQuestions(questionSeedData);
  questionIds = (await Question.find().sort({ questionNumber: 1 })).map((q) => q.id as string);
});

describe('requireCandidate (X-Assessment-Token)', () => {
  it('rejects a missing token', async () => {
    const res = await request(app).get('/api/assessment');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_ASSESSMENT_TOKEN');
  });

  it('rejects malformed and unknown tokens', async () => {
    for (const token of ['abc', generateToken()]) {
      const res = await getAssessment(token);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_ASSESSMENT_TOKEN');
    }
  });

  it('does not accept the token as a query parameter or recruiter JWT', async () => {
    const { token } = await createCandidate('a@example.com');
    expect((await request(app).get(`/api/assessment?token=${token}`)).status).toBe(401);

    const admin = await Admin.create({ email: 'r@example.com', passwordHash: 'x' });
    const jwt = signAdminToken({ id: admin.id as string, email: admin.email }).token;
    expect((await request(app).get('/api/assessment').set('Authorization', `Bearer ${jwt}`)).status).toBe(401);
  });

  it('rejects an old token after the invitation is resent (token replaced)', async () => {
    const { token, invitationId } = await createCandidate('a@example.com');
    await Invitation.updateOne({ _id: invitationId }, { tokenHash: hashToken(generateToken()) });
    expect((await getAssessment(token)).status).toBe(401);
  });
});

describe('POST /api/assessment/start', () => {
  it('starts a valid invitation and returns the candidate details', async () => {
    const { token, invitationId } = await createCandidate('jane@example.com');
    const res = await start(token);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      candidate: { name: 'Name jane@example.com', email: 'jane@example.com' },
      assessment: {
        status: 'In Progress',
        expiresAt: expect.any(String),
        totalQuestions: 10,
        writtenAnswerMaxLength: 1000,
        videoMaxSeconds: 120,
      },
    });
    expect((await Invitation.findById(invitationId))?.status).toBe('In Progress');
  });

  it('allows resuming an assessment that is already In Progress', async () => {
    const { token, invitationId } = await createCandidate('jane@example.com', { status: 'In Progress' });
    const res = await start(token);
    expect(res.status).toBe(200);
    expect(res.body.assessment.status).toBe('In Progress');
    expect((await Invitation.findById(invitationId))?.status).toBe('In Progress');
    expect((await start(token)).status).toBe(200);
  });

  it('returns 410 for an expired invitation and does not change its status', async () => {
    const { token, invitationId } = await createCandidate('jane@example.com', {
      invitedAt: new Date(Date.now() - 8 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    } as never);
    const res = await start(token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITATION_EXPIRED');
    expect((await Invitation.findById(invitationId))?.status).toBe('Invited');
  });

  it('returns 409 for a completed invitation', async () => {
    const { token } = await createCandidate('jane@example.com', { status: 'Completed', completedAt: new Date() });
    const res = await start(token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_COMPLETED');
  });

  it('rejects a missing token', async () => {
    expect((await start()).status).toBe(401);
  });
});

describe('Status changes only on explicit start', () => {
  it('GET /api/assessment, saving attempts and public validation never start the assessment', async () => {
    const { token, invitationId } = await createCandidate('jane@example.com');

    const res = await getAssessment(token);
    expect(res.status).toBe(200);
    expect(res.body.assessment.status).toBe('Invited');
    await request(app).get(`/api/invitations/validate/${token}`);

    const saveRes = await save(token, questionIds[0]!, { writtenAnswer: 'Hi' });
    expect(saveRes.status).toBe(409);
    expect(saveRes.body.error.code).toBe('ASSESSMENT_NOT_STARTED');

    expect((await Invitation.findById(invitationId))?.status).toBe('Invited');
    expect(await Response.countDocuments()).toBe(0);
  });
});

describe('GET /api/assessment', () => {
  it('returns the candidate, the 10 active questions in order and progress', async () => {
    const { token } = await createCandidate('jane@example.com', { status: 'In Progress' });
    const res = await getAssessment(token);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.candidate).toEqual({ name: 'Name jane@example.com', email: 'jane@example.com' });
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.questions.map((q: { questionNumber: number }) => q.questionNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(res.body.questions[0]).toEqual({
      id: questionIds[0],
      questionNumber: 1,
      questionText: questionSeedData[0]!.questionText,
      status: 'Not Started',
      response: null,
    });
    expect(res.body.progress).toEqual({ writtenAnswered: 0, videosUploaded: 0, questionsComplete: 0, total: 10 });
  });

  it('returns questions in questionNumber order regardless of insertion order', async () => {
    await Question.deleteMany({});
    for (const n of [7, 3, 10, 1, 5, 2, 9, 4, 8, 6]) {
      await Question.create({ questionNumber: n, questionText: `Q${n}` });
    }
    const { token } = await createCandidate('jane@example.com', { status: 'In Progress' });
    const res = await getAssessment(token);
    expect(res.body.questions.map((q: { questionText: string }) => q.questionText)).toEqual(
      ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9', 'Q10'],
    );
  });

  it('returns 503 if the active questions are misconfigured', async () => {
    await Question.updateOne({ questionNumber: 4 }, { isActive: false });
    const { token } = await createCandidate('jane@example.com', { status: 'In Progress' });
    const res = await getAssessment(token);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ASSESSMENT_UNAVAILABLE');
  });

  it('includes saved responses and per-question status for resume', async () => {
    const { token, candidateId } = await createCandidate('jane@example.com', { status: 'In Progress' });
    await save(token, questionIds[0]!, { writtenAnswer: 'First answer' });
    await save(token, questionIds[2]!, { writtenAnswer: 'Third answer' });
    await Response.updateOne(
      { candidateId, questionId: questionIds[2] },
      { video: { objectKey: 'k', mimeType: 'video/webm', sizeBytes: 1, uploadStatus: 'Uploaded' } },
    );

    const res = await getAssessment(token);
    const [q1, q2, q3] = res.body.questions;
    expect(q1.response).toEqual({
      questionId: questionIds[0],
      writtenAnswer: 'First answer',
      videoStatus: 'Missing',
      updatedAt: expect.any(String),
    });
    expect(q1.status).toBe('In Progress');
    expect(q2.response).toBeNull();
    expect(q3.status).toBe('Complete');
    expect(res.body.progress).toEqual({ writtenAnswered: 2, videosUploaded: 1, questionsComplete: 1, total: 10 });
    // Video storage details are not exposed.
    expect(JSON.stringify(res.body)).not.toContain('objectKey');
  });

  it('never returns another candidate’s responses', async () => {
    const a = await createCandidate('a@example.com', { status: 'In Progress' });
    const b = await createCandidate('b@example.com', { status: 'In Progress' });
    await save(a.token, questionIds[0]!, { writtenAnswer: 'Secret answer from A' });

    const res = await getAssessment(b.token);
    expect(res.body.candidate.email).toBe('b@example.com');
    expect(res.body.questions[0].response).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Secret answer from A');
    expect(JSON.stringify(res.body)).not.toContain('a@example.com');
  });

  it('rejects expired and completed invitations', async () => {
    const expired = await createCandidate('e@example.com', {
      status: 'In Progress',
      invitedAt: new Date(Date.now() - 8 * DAY_MS),
      expiresAt: new Date(Date.now() - DAY_MS),
    } as never);
    const completed = await createCandidate('c@example.com', { status: 'Completed', completedAt: new Date() });
    expect((await getAssessment(expired.token)).status).toBe(410);
    expect((await getAssessment(completed.token)).status).toBe(409);
  });
});

describe('PUT /api/assessment/questions/:questionId/response', () => {
  let fx: Fixture;
  beforeEach(async () => {
    fx = await createCandidate('jane@example.com', { status: 'In Progress' });
  });

  it('saves a written response', async () => {
    const res = await save(fx.token, questionIds[0]!, { writtenAnswer: 'My answer' });
    expect(res.status).toBe(200);
    expect(res.body.response).toEqual({
      questionId: questionIds[0],
      writtenAnswer: 'My answer',
      videoStatus: 'Missing',
      updatedAt: expect.any(String),
    });
    const stored = await Response.findOne({ candidateId: fx.candidateId, questionId: questionIds[0] });
    expect(stored?.writtenAnswer).toBe('My answer');
  });

  it('updates an existing response in place', async () => {
    await save(fx.token, questionIds[0]!, { writtenAnswer: 'Draft' });
    const before = await Response.findOne({ candidateId: fx.candidateId });
    const res = await save(fx.token, questionIds[0]!, { writtenAnswer: 'Final answer' });
    expect(res.body.response.writtenAnswer).toBe('Final answer');
    const after = await Response.findOne({ candidateId: fx.candidateId });
    expect(after?.id).toBe(before?.id);
    expect(after?.writtenAnswer).toBe('Final answer');
  });

  it('allows clearing an answer', async () => {
    await save(fx.token, questionIds[0]!, { writtenAnswer: 'Draft' });
    const res = await save(fx.token, questionIds[0]!, { writtenAnswer: '' });
    expect(res.status).toBe(200);
    expect(res.body.response.writtenAnswer).toBe('');
  });

  it('does not create duplicate records on repeated or concurrent saves', async () => {
    for (let i = 0; i < 3; i++) await save(fx.token, questionIds[0]!, { writtenAnswer: `v${i}` });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => save(fx.token, questionIds[1]!, { writtenAnswer: `c${i}` })),
    );
    expect(await Response.countDocuments({ candidateId: fx.candidateId, questionId: questionIds[0] })).toBe(1);
    expect(await Response.countDocuments({ candidateId: fx.candidateId, questionId: questionIds[1] })).toBe(1);
    expect(await Response.countDocuments()).toBe(2);
  });

  it('accepts exactly 1,000 characters and rejects 1,001', async () => {
    expect((await save(fx.token, questionIds[0]!, { writtenAnswer: 'a'.repeat(1000) })).status).toBe(200);
    const res = await save(fx.token, questionIds[0]!, { writtenAnswer: 'b'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ writtenAnswer: 'Written answer cannot exceed 1000 characters' });
    expect((await Response.findOne({ candidateId: fx.candidateId }))?.writtenAnswer).toBe('a'.repeat(1000));
  });

  it.each([[{}], [{ writtenAnswer: 42 }], [{ writtenAnswer: null }], [{ writtenAnswer: ['x'] }]])(
    'rejects a non-string writtenAnswer %j',
    async (body) => {
      const res = await save(fx.token, questionIds[0]!, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('rejects an invalid question ID with 400', async () => {
    for (const bad of ['not-an-id', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
      const res = await save(fx.token, bad, { writtenAnswer: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    }
  });

  it('rejects an unknown or inactive question with 404', async () => {
    const unknown = await save(fx.token, new mongoose.Types.ObjectId().toString(), { writtenAnswer: 'x' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('QUESTION_NOT_FOUND');

    await Question.updateOne({ _id: questionIds[9] }, { isActive: false });
    expect((await save(fx.token, questionIds[9]!, { writtenAnswer: 'x' })).status).toBe(404);
  });

  it('derives the candidate from the token, ignoring candidateId in the payload', async () => {
    const other = await createCandidate('other@example.com', { status: 'In Progress' });
    const res = await save(fx.token, questionIds[0]!, {
      writtenAnswer: 'Mine',
      candidateId: other.candidateId.toString(),
      questionId: questionIds[5],
    });
    expect(res.status).toBe(200);
    expect(await Response.countDocuments({ candidateId: other.candidateId })).toBe(0);
    const stored = await Response.findOne({ candidateId: fx.candidateId });
    expect(stored?.questionId.toString()).toBe(questionIds[0]);
  });

  it('cannot modify another candidate’s response', async () => {
    const other = await createCandidate('other@example.com', { status: 'In Progress' });
    await save(other.token, questionIds[0]!, { writtenAnswer: 'Other original' });
    await save(fx.token, questionIds[0]!, { writtenAnswer: 'Mine' });
    const otherResponse = await Response.findOne({ candidateId: other.candidateId });
    expect(otherResponse?.writtenAnswer).toBe('Other original');
  });

  it('cannot update a completed assessment', async () => {
    await save(fx.token, questionIds[0]!, { writtenAnswer: 'Before submit' });
    await Invitation.updateOne({ _id: fx.invitationId }, { status: 'Completed', completedAt: new Date() });

    const res = await save(fx.token, questionIds[0]!, { writtenAnswer: 'After submit' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_COMPLETED');
    expect((await Response.findOne({ candidateId: fx.candidateId }))?.writtenAnswer).toBe('Before submit');
  });

  it('cannot update after the invitation expires', async () => {
    await Invitation.updateOne({ _id: fx.invitationId }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await save(fx.token, questionIds[0]!, { writtenAnswer: 'x' })).status).toBe(410);
  });

  it('rejects a missing or invalid token', async () => {
    const noToken = await request(app)
      .put(`/api/assessment/questions/${questionIds[0]}/response`)
      .send({ writtenAnswer: 'x' });
    expect(noToken.status).toBe(401);
    expect((await save(generateToken(), questionIds[0]!, { writtenAnswer: 'x' })).status).toBe(401);
    expect(await Response.countDocuments()).toBe(0);
  });
});

describe('CORS', () => {
  it('allows the X-Assessment-Token header from the frontend origin', async () => {
    const res = await request(app)
      .options('/api/assessment')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'x-assessment-token,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toMatch(/X-Assessment-Token/i);
  });
});
