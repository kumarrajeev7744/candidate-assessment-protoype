import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { useTestDatabase } from './helpers/db.js';
import { installFakeEmail } from './helpers/fakeEmail.js';
import { installFakeVideoStorage } from './helpers/fakeVideoStorage.js';
import { createApp } from '../src/app.js';
import { Admin, Candidate, Invitation, Question, Response } from '../src/models/index.js';
import { questionSeedData } from '../src/seed/questionSeedData.js';
import { seedQuestions } from '../src/services/questionSeedService.js';
import { signAdminToken } from '../src/utils/jwt.js';
import { generateToken, hashToken } from '../src/utils/token.js';
import { config } from '../src/config/env.js';

useTestDatabase();

const app = createApp();
let email: ReturnType<typeof installFakeEmail>;
let s3: ReturnType<typeof installFakeVideoStorage>;
let questionIds: string[];

interface Fixture {
  token: string;
  candidateId: mongoose.Types.ObjectId;
  invitationId: mongoose.Types.ObjectId;
}

async function createCandidate(overrides: Record<string, unknown> = {}): Promise<Fixture> {
  const candidate = await Candidate.create({ name: 'Priya Sharma', email: `priya${Math.random()}@example.com` });
  const token = generateToken();
  const invitation = await Invitation.create({
    candidateId: candidate._id,
    tokenHash: hashToken(token),
    status: 'In Progress',
    emailStatus: 'Sent',
    ...overrides,
  });
  return { token, candidateId: candidate._id, invitationId: invitation._id };
}

/** Writes responses directly; by default all 10 questions get a written answer and an uploaded video. */
async function addResponses(
  fx: Fixture,
  overrides: Record<number, { writtenAnswer?: string; videoStatus?: 'Pending' | 'Uploaded' | 'Failed' | null } | null> = {},
) {
  for (let i = 0; i < questionIds.length; i++) {
    const n = i + 1;
    const o = overrides[n];
    if (o === null) continue; // no response record at all
    const videoStatus = o?.videoStatus === undefined ? 'Uploaded' : o.videoStatus;
    await Response.create({
      candidateId: fx.candidateId,
      questionId: questionIds[i],
      writtenAnswer: o?.writtenAnswer ?? `Answer ${n}`,
      ...(videoStatus
        ? {
            video: {
              objectKey: `videos/${fx.candidateId}/${questionIds[i]}/1700000000000-${'a'.repeat(24)}.webm`,
              mimeType: 'video/webm',
              sizeBytes: 1000,
              uploadStatus: videoStatus,
            },
          }
        : {}),
    });
  }
}

const submit = (token: string) => request(app).post('/api/assessment/submit').set('X-Assessment-Token', token);
const saveAnswer = (token: string, qid: string, writtenAnswer: string) =>
  request(app).put(`/api/assessment/questions/${qid}/response`).set('X-Assessment-Token', token).send({ writtenAnswer });

beforeEach(async () => {
  email = installFakeEmail();
  s3 = installFakeVideoStorage();
  await seedQuestions(questionSeedData);
  questionIds = (await Question.find().sort({ questionNumber: 1 })).map((q) => q.id as string);
});

afterEach(() => {
  email.restore();
  s3.restore();
  (config as { companyName: string | undefined }).companyName = undefined;
});

describe('POST /api/assessment/submit', () => {
  it('submits a complete assessment and saves the completion timestamp', async () => {
    const fx = await createCandidate();
    await addResponses(fx);
    const before = Date.now();

    const res = await submit(fx.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      assessment: { status: 'Completed', completedAt: expect.any(String) },
      message: 'Assessment submitted successfully.',
      confirmationEmail: { sent: true },
    });
    const completedAt = Date.parse(res.body.assessment.completedAt);
    expect(completedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(completedAt).toBeLessThanOrEqual(Date.now());

    const inv = await Invitation.findById(fx.invitationId).lean();
    expect(inv?.status).toBe('Completed');
    expect(inv?.completedAt?.toISOString()).toBe(res.body.assessment.completedAt);
  });

  it.each([
    ['missing written answer', { 3: { writtenAnswer: '' } }, [{ questionNumber: 3, writtenMissing: true, videoMissing: false }]],
    ['whitespace-only written answer', { 4: { writtenAnswer: '   \n ' } }, [{ questionNumber: 4, writtenMissing: true, videoMissing: false }]],
    ['missing video', { 5: { videoStatus: null } }, [{ questionNumber: 5, writtenMissing: false, videoMissing: true }]],
    ['video Pending', { 6: { videoStatus: 'Pending' } }, [{ questionNumber: 6, writtenMissing: false, videoMissing: true }]],
    ['video Failed', { 7: { videoStatus: 'Failed' } }, [{ questionNumber: 7, writtenMissing: false, videoMissing: true }]],
    ['no response record', { 2: null }, [{ questionNumber: 2, writtenMissing: true, videoMissing: true }]],
  ] as const)('rejects submission with a %s and lists the missing parts', async (_label, overrides, missing) => {
    const fx = await createCandidate();
    await addResponses(fx, overrides as never);

    const res = await submit(fx.token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSESSMENT_INCOMPLETE');
    expect(res.body.error.details).toEqual({ missing });
    expect(res.body.error.message).toMatch(new RegExp(`question ${missing[0]!.questionNumber}`));
    expect((await Invitation.findById(fx.invitationId))?.status).toBe('In Progress');
    expect(email.sendMail).not.toHaveBeenCalled();
  });

  it('lists every incomplete question', async () => {
    const fx = await createCandidate();
    await addResponses(fx, { 1: null, 9: { writtenAnswer: '', videoStatus: 'Failed' }, 10: { videoStatus: null } });
    const res = await submit(fx.token);
    expect(res.body.error.details.missing).toEqual([
      { questionNumber: 1, writtenMissing: true, videoMissing: true },
      { questionNumber: 9, writtenMissing: true, videoMissing: true },
      { questionNumber: 10, writtenMissing: false, videoMissing: true },
    ]);
    expect(res.body.error.message).toBe('Your assessment is not complete yet. Please finish questions 1, 9, 10.');
  });

  it('rejects submission when the number of active questions is wrong', async () => {
    const fx = await createCandidate();
    await addResponses(fx);
    await Question.updateOne({ questionNumber: 10 }, { isActive: false });
    const res = await submit(fx.token);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ASSESSMENT_UNAVAILABLE');
    expect((await Invitation.findById(fx.invitationId))?.status).toBe('In Progress');
  });

  it('rejects an expired invitation', async () => {
    const fx = await createCandidate({ invitedAt: new Date(Date.now() - 8 * 86400_000), expiresAt: new Date(Date.now() - 1000) });
    await addResponses(fx);
    const res = await submit(fx.token);
    expect(res.status).toBe(410);
    expect((await Invitation.findById(fx.invitationId))?.status).toBe('In Progress');
  });

  it('rejects missing or invalid tokens', async () => {
    expect((await request(app).post('/api/assessment/submit')).status).toBe(401);
    expect((await submit(generateToken())).status).toBe(401);
  });

  it('rejects an assessment that was never started', async () => {
    const fx = await createCandidate({ status: 'Invited' });
    const res = await submit(fx.token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_NOT_STARTED');
  });

  it('cannot be submitted twice', async () => {
    const fx = await createCandidate();
    await addResponses(fx);
    const first = await submit(fx.token);
    const second = await submit(fx.token);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ASSESSMENT_COMPLETED');
    const inv = await Invitation.findById(fx.invitationId).lean();
    expect(inv?.completedAt?.toISOString()).toBe(first.body.assessment.completedAt);
    expect(email.sendMail).toHaveBeenCalledTimes(1);
  });

  it('completes exactly once under concurrent submissions', async () => {
    const fx = await createCandidate();
    await addResponses(fx);
    const results = await Promise.all(Array.from({ length: 6 }, () => submit(fx.token)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(email.sendMail).toHaveBeenCalledTimes(1);
    const winner = results.find((r) => r.status === 200)!;
    const inv = await Invitation.findById(fx.invitationId).lean();
    expect(inv?.completedAt?.toISOString()).toBe(winner.body.assessment.completedAt);
  });

  it('never lets an answer saved concurrently with submission change a completed assessment', async () => {
    for (let round = 0; round < 5; round++) {
      const fx = await createCandidate();
      await addResponses(fx);
      const [submitRes, saveRes] = await Promise.all([
        submit(fx.token),
        saveAnswer(fx.token, questionIds[0]!, `Late edit ${round}`),
      ]);
      expect(submitRes.status).toBe(200);
      const stored = await Response.findOne({ candidateId: fx.candidateId, questionId: questionIds[0] }).lean();
      const inv = await Invitation.findById(fx.invitationId).lean();
      if (saveRes.status === 200) {
        // The edit committed before completion and is part of the submitted assessment.
        expect(stored?.writtenAnswer).toBe(`Late edit ${round}`);
        expect(stored!.updatedAt.getTime()).toBeLessThanOrEqual(inv!.completedAt!.getTime());
      } else {
        expect(saveRes.status).toBe(409);
        expect(stored?.writtenAnswer).toBe('Answer 1');
      }
    }
  });
});

describe('Locking after completion', () => {
  async function completedFixture() {
    const fx = await createCandidate();
    await addResponses(fx);
    expect((await submit(fx.token)).status).toBe(200);
    return fx;
  }

  it('rejects written-answer edits', async () => {
    const fx = await completedFixture();
    const res = await saveAnswer(fx.token, questionIds[0]!, 'Changed after submit');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_COMPLETED');
    expect((await Response.findOne({ candidateId: fx.candidateId, questionId: questionIds[0] }))?.writtenAnswer).toBe('Answer 1');
  });

  it('rejects video upload URLs, confirmations and replacement', async () => {
    const fx = await completedFixture();
    const key = `videos/${fx.candidateId}/${questionIds[0]}/1800000000000-${'b'.repeat(24)}.webm`;
    s3.put(key);
    const url = await request(app)
      .post(`/api/assessment/questions/${questionIds[0]}/video-upload-url`)
      .set('X-Assessment-Token', fx.token)
      .send({ mimeType: 'video/webm', sizeBytes: 100 });
    const confirm = await request(app)
      .post(`/api/assessment/questions/${questionIds[0]}/video-confirm`)
      .set('X-Assessment-Token', fx.token)
      .send({ objectKey: key });
    expect(url.status).toBe(409);
    expect(confirm.status).toBe(409);
    const stored = await Response.findOne({ candidateId: fx.candidateId, questionId: questionIds[0] }).lean();
    expect(stored?.video?.objectKey).not.toBe(key);
    expect(s3.storage.deleteObject).not.toHaveBeenCalled();
  });

  it('rejects restarting or reloading the assessment for editing', async () => {
    const fx = await completedFixture();
    expect((await request(app).post('/api/assessment/start').set('X-Assessment-Token', fx.token)).status).toBe(409);
    expect((await request(app).get('/api/assessment').set('X-Assessment-Token', fx.token)).status).toBe(409);
    expect((await Invitation.findById(fx.invitationId))?.status).toBe('Completed');
  });

  it('rejects a video confirmation that races with completion', async () => {
    const fx = await createCandidate();
    await addResponses(fx);
    const key = `videos/${fx.candidateId}/${questionIds[1]}/1800000000000-${'c'.repeat(24)}.webm`;
    s3.put(key);
    const [submitRes, confirmRes] = await Promise.all([
      submit(fx.token),
      request(app)
        .post(`/api/assessment/questions/${questionIds[1]}/video-confirm`)
        .set('X-Assessment-Token', fx.token)
        .send({ objectKey: key }),
    ]);
    expect(submitRes.status).toBe(200);
    const stored = await Response.findOne({ candidateId: fx.candidateId, questionId: questionIds[1] }).lean();
    const inv = await Invitation.findById(fx.invitationId).lean();
    if (confirmRes.status === 200) expect(stored!.updatedAt.getTime()).toBeLessThanOrEqual(inv!.completedAt!.getTime());
    else expect(stored?.video?.objectKey).not.toBe(key);
  });
});

describe('Confirmation email', () => {
  it('is sent after submission with the candidate name and completion time, and nothing sensitive', async () => {
    const fx = await createCandidate();
    await addResponses(fx);
    const res = await submit(fx.token);

    expect(email.sent).toHaveLength(1);
    const msg = email.sent[0]!;
    const candidate = await Candidate.findById(fx.candidateId);
    expect(msg.to).toBe(candidate!.email);
    expect(msg.subject).toBe('Your assessment has been submitted');
    expect(msg.text).toContain('Dear Priya Sharma,');
    expect(msg.text).toMatch(/submitted successfully on \w+day, \d{1,2} \w+ \d{4}/);
    expect(msg.text).toContain('Thank you for completing your assessment.');
    expect(msg.html).toContain('submitted successfully');
    expect(msg.text).toContain('The Recruitment Team');
    for (const secret of [fx.token, hashToken(fx.token), fx.invitationId.toString(), fx.candidateId.toString(), 'Answer 1', 'videos/', 'http']) {
      expect(msg.text).not.toContain(secret);
      expect(msg.html).not.toContain(secret);
    }

    const inv = await Invitation.findById(fx.invitationId).lean();
    expect(inv?.confirmationEmailStatus).toBe('Sent');
    expect(inv?.confirmationEmailSentAt).toBeInstanceOf(Date);
    expect(inv?.emailStatus).toBe('Sent'); // invitation email status is separate and unchanged
    expect(res.body.confirmationEmail).toEqual({ sent: true });
  });

  it('includes the company name only when configured', async () => {
    (config as { companyName: string | undefined }).companyName = 'Acme Sales';
    const fx = await createCandidate();
    await addResponses(fx);
    await submit(fx.token);
    expect(email.sent[0]!.text).toContain('Thank you for completing your assessment for Acme Sales.');
    expect(email.sent[0]!.text).toContain('The Acme Sales Recruitment Team');
  });

  it('does not roll back completion when the email fails, and records the failure', async () => {
    email.fail();
    const fx = await createCandidate();
    await addResponses(fx);

    const res = await submit(fx.token);
    expect(res.status).toBe(200);
    expect(res.body.confirmationEmail).toEqual({ sent: false });
    const inv = await Invitation.findById(fx.invitationId).lean();
    expect(inv?.status).toBe('Completed');
    expect(inv?.completedAt).toBeInstanceOf(Date);
    expect(inv?.confirmationEmailStatus).toBe('Failed');
    expect(inv?.confirmationEmailLastAttemptAt).toBeInstanceOf(Date);
    expect(inv?.confirmationEmailSentAt).toBeUndefined();
    expect(inv?.emailStatus).toBe('Sent');
  });

  it('records a failure when SMTP is not configured', async () => {
    email.restore();
    const smtp = config.smtp as { user: string | undefined };
    const saved = smtp.user;
    smtp.user = undefined;
    try {
      const fx = await createCandidate();
      await addResponses(fx);
      const res = await submit(fx.token);
      expect(res.status).toBe(200);
      expect((await Invitation.findById(fx.invitationId))?.confirmationEmailStatus).toBe('Failed');
    } finally {
      smtp.user = saved;
    }
  });
});

describe('POST /api/invitations/:id/resend-confirmation', () => {
  let authHeader: string;
  beforeEach(async () => {
    const admin = await Admin.create({ email: 'recruiter@example.com', passwordHash: 'x' });
    authHeader = `Bearer ${signAdminToken({ id: admin.id as string, email: admin.email }).token}`;
  });
  const resendConfirmation = (id: string, auth = true) => {
    const req = request(app).post(`/api/invitations/${id}/resend-confirmation`);
    return auth ? req.set('Authorization', authHeader) : req;
  };

  async function completedWithFailedEmail() {
    email.fail();
    const fx = await createCandidate();
    await addResponses(fx);
    await submit(fx.token);
    email.fail(false);
    return fx;
  }

  it('lets a recruiter resend a failed confirmation email without changing the completion', async () => {
    const fx = await completedWithFailedEmail();
    const before = await Invitation.findById(fx.invitationId).lean();

    const res = await resendConfirmation(fx.invitationId.toString());
    expect(res.status).toBe(200);
    expect(res.body.email).toEqual({ sent: true });
    expect(res.body.invitation).toMatchObject({
      status: 'Completed',
      confirmationEmailStatus: 'Sent',
      confirmationEmailSentAt: expect.any(String),
    });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.subject).toBe('Your assessment has been submitted');

    const after = await Invitation.findById(fx.invitationId).lean();
    expect(after?.status).toBe('Completed');
    expect(after?.completedAt?.getTime()).toBe(before?.completedAt?.getTime());
    expect(after?.tokenHash).toBe(before?.tokenHash);
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash|responseVersion/);
  });

  it('records another failure if the retry also fails', async () => {
    const fx = await completedWithFailedEmail();
    email.fail();
    const res = await resendConfirmation(fx.invitationId.toString());
    expect(res.status).toBe(200);
    expect(res.body.email.sent).toBe(false);
    expect(res.body.invitation.confirmationEmailStatus).toBe('Failed');
  });

  it('refuses to resend a confirmation that was already sent', async () => {
    const fx = await createCandidate();
    await addResponses(fx);
    await submit(fx.token);
    const res = await resendConfirmation(fx.invitationId.toString());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFIRMATION_ALREADY_SENT');
    expect(email.sendMail).toHaveBeenCalledTimes(1);
  });

  it('refuses incomplete assessments', async () => {
    const fx = await createCandidate();
    const res = await resendConfirmation(fx.invitationId.toString());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_NOT_COMPLETED');
    expect(email.sendMail).not.toHaveBeenCalled();
  });

  it('requires recruiter authentication and valid IDs', async () => {
    const fx = await completedWithFailedEmail();
    expect((await resendConfirmation(fx.invitationId.toString(), false)).status).toBe(401);
    const candidateTokenAttempt = await request(app)
      .post(`/api/invitations/${fx.invitationId}/resend-confirmation`)
      .set('X-Assessment-Token', fx.token);
    expect(candidateTokenAttempt.status).toBe(401);
    expect((await resendConfirmation('bad-id')).status).toBe(400);
    expect((await resendConfirmation(new mongoose.Types.ObjectId().toString())).status).toBe(404);
  });

  it('cannot resend the invitation of a completed assessment (existing rule still applies)', async () => {
    const fx = await completedWithFailedEmail();
    const res = await request(app).post(`/api/invitations/${fx.invitationId}/resend`).set('Authorization', authHeader);
    expect(res.status).toBe(409);
  });
});
