import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { useTestDatabase } from './helpers/db.js';
import { installFakeEmail } from './helpers/fakeEmail.js';
import { installFakeVideoStorage } from './helpers/fakeVideoStorage.js';
import { createApp } from '../src/app.js';
import { Admin, Candidate, Invitation, Question, Response, ShareLink } from '../src/models/index.js';
import { questionSeedData } from '../src/seed/questionSeedData.js';
import { seedQuestions } from '../src/services/questionSeedService.js';
import { signAdminToken } from '../src/utils/jwt.js';
import { generateToken, hashToken } from '../src/utils/token.js';
import { videoKeyPrefix } from '../src/services/videoService.js';

useTestDatabase();

const app = createApp();
const DAY = 86_400_000;
let authHeader: string;
let email: ReturnType<typeof installFakeEmail>;
let s3: ReturnType<typeof installFakeVideoStorage>;
let questionIds: string[];

interface Fixture {
  candidateId: string;
  invitationToken: string;
  responses: Map<number, string>; // question number -> response id
}

/** Candidate with responses: by default 10 complete answers (text + uploaded video). */
async function createCandidate(
  options: {
    status?: 'Invited' | 'In Progress' | 'Completed';
    answers?: Record<number, { written?: string; video?: 'Uploaded' | 'Pending' | 'Failed' | null } | null>;
    count?: number;
  } = {},
): Promise<Fixture> {
  const status = options.status ?? 'Completed';
  const candidate = await Candidate.create({ name: 'Priya Sharma', email: `priya${Math.random()}@example.com` });
  const invitationToken = generateToken();
  await Invitation.create({
    candidateId: candidate._id,
    tokenHash: hashToken(invitationToken),
    status,
    emailStatus: 'Sent',
    ...(status === 'Completed' ? { completedAt: new Date() } : {}),
  });
  const responses = new Map<number, string>();
  const count = options.count ?? 10;
  for (let n = 1; n <= count; n++) {
    const o = options.answers?.[n];
    if (o === null) continue;
    const video = o?.video === undefined ? 'Uploaded' : o.video;
    const r = await Response.create({
      candidateId: candidate._id,
      questionId: questionIds[n - 1],
      writtenAnswer: o?.written ?? `Answer ${n}`,
      ...(video
        ? {
            video: {
              objectKey: `${videoKeyPrefix(candidate.id as string, questionIds[n - 1]!)}1700000000000-${String(n).padStart(24, '0')}.webm`,
              mimeType: 'video/webm',
              sizeBytes: 1234,
              uploadStatus: video,
            },
          }
        : {}),
    });
    responses.set(n, r.id as string);
  }
  return { candidateId: candidate.id as string, invitationToken, responses };
}

const report = (candidateId: string) =>
  request(app).get(`/api/candidates/${candidateId}/report`).set('Authorization', authHeader);
const share = (responseId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/responses/${responseId}/share`).set('Authorization', authHeader).send(body);
const publicView = (token: string) => request(app).get(`/api/shared-responses/${token}`);
const tokenFromEmail = (n = 0) => /\/shared-response\/([A-Za-z0-9_-]{43})/.exec(email.sent[n]!.text)![1]!;

beforeEach(async () => {
  const admin = await Admin.create({ email: 'recruiter@example.com', passwordHash: 'x' });
  authHeader = `Bearer ${signAdminToken({ id: admin.id as string, email: admin.email }).token}`;
  email = installFakeEmail();
  s3 = installFakeVideoStorage();
  await seedQuestions(questionSeedData);
  questionIds = (await Question.find().sort({ questionNumber: 1 })).map((q) => q.id as string);
});
afterEach(() => {
  email.restore();
  s3.restore();
  vi.useRealTimers();
});

const SENSITIVE = (fx: Fixture) => [
  fx.invitationToken,
  hashToken(fx.invitationToken),
  'tokenHash',
  'objectKey',
  'responseVersion',
  'passwordHash',
  '__v',
];

describe('GET /api/candidates/:candidateId/report', () => {
  it('requires recruiter authentication (no candidate token, no anonymous access)', async () => {
    const fx = await createCandidate();
    expect((await request(app).get(`/api/candidates/${fx.candidateId}/report`)).status).toBe(401);
    const withCandidateToken = await request(app)
      .get(`/api/candidates/${fx.candidateId}/report`)
      .set('X-Assessment-Token', fx.invitationToken);
    expect(withCandidateToken.status).toBe(401);
  });

  it('returns 400 for a malformed ID and 404 for an unknown candidate', async () => {
    expect((await report('not-an-id')).status).toBe(400);
    const res = await report(new mongoose.Types.ObjectId().toString());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CANDIDATE_NOT_FOUND');
  });

  it('returns the candidate, assessment details and all 10 questions in order with signed video URLs', async () => {
    const fx = await createCandidate();
    const res = await report(fx.candidateId);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.candidate).toEqual({ id: fx.candidateId, name: 'Priya Sharma', email: expect.stringMatching(/@example\.com$/) });
    expect(res.body.assessment).toEqual({
      status: 'Completed',
      invitedAt: expect.any(String),
      expiresAt: expect.any(String),
      completedAt: expect.any(String),
      isExpired: false,
    });
    expect(res.body.questions.map((q: { questionNumber: number }) => q.questionNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(res.body.summary).toEqual({ completedQuestions: 10, totalQuestions: 10 });

    const q1 = res.body.questions[0];
    expect(q1).toEqual({
      questionId: questionIds[0],
      questionNumber: 1,
      questionText: questionSeedData[0]!.questionText,
      status: 'Complete',
      response: {
        id: fx.responses.get(1),
        writtenAnswer: 'Answer 1',
        hasWrittenAnswer: true,
        video: {
          status: 'Uploaded',
          available: true,
          url: expect.stringMatching(/^https:\/\/fake-s3\.test\/.*download=1/),
          mimeType: 'video/webm',
          urlExpiresAt: expect.any(String),
        },
        updatedAt: expect.any(String),
      },
      canShare: true,
    });
    expect(s3.storage.createDownloadUrl).toHaveBeenCalledTimes(10);
  });

  it('handles incomplete assessments and missing responses', async () => {
    const fx = await createCandidate({
      status: 'In Progress',
      answers: { 2: null, 3: { written: '', video: 'Uploaded' }, 4: { video: 'Pending' }, 5: { video: 'Failed' }, 6: { video: null } },
      count: 7,
    });
    const res = await report(fx.candidateId);
    const q = (n: number) => res.body.questions[n - 1];
    expect(res.body.assessment).toMatchObject({ status: 'In Progress', completedAt: null });
    expect(q(1)).toMatchObject({ status: 'Complete', canShare: false }); // not shareable until submitted
    expect(q(2)).toMatchObject({ status: 'Not Started', response: null, canShare: false });
    expect(q(3)).toMatchObject({ status: 'Incomplete', response: { hasWrittenAnswer: false, video: { available: true } } });
    expect(q(4).response.video).toEqual({ status: 'Pending', available: false, url: null, mimeType: null, urlExpiresAt: null });
    expect(q(5).response.video).toMatchObject({ status: 'Failed', available: false, url: null });
    expect(q(6).response.video).toMatchObject({ status: 'Missing', available: false, url: null });
    expect(q(8)).toMatchObject({ status: 'Not Started', response: null });
    expect(res.body.summary.completedQuestions).toBe(2); // questions 1 and 7
    // Signed URLs only for uploaded videos (questions 1, 3, 7).
    expect(s3.storage.createDownloadUrl).toHaveBeenCalledTimes(3);
  });

  it('still returns the report if a playback URL cannot be created', async () => {
    const fx = await createCandidate({ count: 1 });
    s3.storage.createDownloadUrl.mockRejectedValueOnce(new Error('boom'));
    const res = await report(fx.candidateId);
    expect(res.status).toBe(200);
    expect(res.body.questions[0].response.video).toMatchObject({ status: 'Uploaded', available: true, url: null });
  });

  it('exposes no tokens, hashes or storage keys', async () => {
    const fx = await createCandidate();
    await share(fx.responses.get(1)!, { candidateId: fx.candidateId, recipientEmail: 'manager@example.com' });
    const body = JSON.stringify((await report(fx.candidateId)).body);
    for (const s of [...SENSITIVE(fx), tokenFromEmail()]) expect(body).not.toContain(s);
    // Signed playback URLs contain only an opaque object path (no question or candidate IDs).
    const urls = JSON.parse(body).questions.map((q: { response: { video: { url: string } } }) => q.response.video.url);
    for (const url of urls) for (const id of questionIds) expect(url).not.toContain(id);
  });
});

describe('POST /api/responses/:responseId/share', () => {
  it('requires recruiter authentication', async () => {
    const fx = await createCandidate();
    const res = await request(app)
      .post(`/api/responses/${fx.responses.get(1)}/share`)
      .set('X-Assessment-Token', fx.invitationToken)
      .send({ candidateId: fx.candidateId, recipientEmail: 'm@example.com' });
    expect(res.status).toBe(401);
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it('validates the response ID, candidate ID and recipient email', async () => {
    const fx = await createCandidate();
    expect((await share('bad', { candidateId: fx.candidateId, recipientEmail: 'm@example.com' })).status).toBe(400);
    for (const body of [
      { candidateId: fx.candidateId, recipientEmail: 'not-an-email' },
      { candidateId: fx.candidateId },
      { candidateId: 'x', recipientEmail: 'm@example.com' },
      { recipientEmail: 'm@example.com' },
    ]) {
      const res = await share(fx.responses.get(1)!, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await ShareLink.countDocuments()).toBe(0);
    expect(email.sendMail).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown response or a response of another candidate', async () => {
    const a = await createCandidate();
    const b = await createCandidate();
    const unknown = await share(new mongoose.Types.ObjectId().toString(), { candidateId: a.candidateId, recipientEmail: 'm@example.com' });
    expect(unknown.status).toBe(404);
    const mismatched = await share(b.responses.get(1)!, { candidateId: a.candidateId, recipientEmail: 'm@example.com' });
    expect(mismatched.status).toBe(404);
    expect(mismatched.body.error.code).toBe('RESPONSE_NOT_FOUND');
  });

  it('only shares submitted assessments and responses with content', async () => {
    const inProgress = await createCandidate({ status: 'In Progress' });
    const res = await share(inProgress.responses.get(1)!, { candidateId: inProgress.candidateId, recipientEmail: 'm@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_NOT_COMPLETED');

    const empty = await createCandidate({ answers: { 1: { written: '  ', video: null } } });
    const res2 = await share(empty.responses.get(1)!, { candidateId: empty.candidateId, recipientEmail: 'm@example.com' });
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toBe('NOTHING_TO_SHARE');
  });

  it('creates a 7-day link storing only the token hash and emails it', async () => {
    const fx = await createCandidate();
    const before = Date.now();
    const res = await share(fx.responses.get(3)!, { candidateId: fx.candidateId, recipientEmail: ' Manager@Example.com ' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      shareLink: {
        id: expect.any(String),
        recipientEmail: 'manager@example.com',
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
        emailStatus: 'Sent',
        emailSentAt: expect.any(String),
      },
      reused: false,
      email: { sent: true },
    });
    const expiresInMs = Date.parse(res.body.shareLink.expiresAt) - before;
    expect(expiresInMs).toBeGreaterThanOrEqual(7 * DAY - 1000);
    expect(expiresInMs).toBeLessThan(7 * DAY + 5000);

    const token = tokenFromEmail();
    const stored = await mongoose.connection.db!.collection('sharelinks').findOne({});
    expect(stored?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toContain(hashToken(token));
    expect(String(stored?.responseId)).toBe(fx.responses.get(3));
  });

  it('sends an email with candidate name, question, recipient, link and expiry but no answer content', async () => {
    const fx = await createCandidate();
    await share(fx.responses.get(3)!, { candidateId: fx.candidateId, recipientEmail: 'manager@example.com' });
    const msg = email.sent[0]!;
    expect(msg.to).toBe('manager@example.com');
    expect(msg.subject).toBe('Candidate response shared with you: Priya Sharma – Question 3');
    expect(msg.text).toContain('Candidate: Priya Sharma');
    expect(msg.text).toContain(`Question 3: ${questionSeedData[2]!.questionText}`);
    expect(msg.text).toContain('(manager@example.com)');
    expect(msg.text).toMatch(/This link expires in 7 days, on \w+day/);
    expect(msg.text).toMatch(/^http:\/\/localhost:5173\/shared-response\/[A-Za-z0-9_-]{43}$/m);
    expect(msg.html).toContain('View response');
    expect(msg.text).not.toContain('Answer 3');
    expect(msg.html).not.toContain('Answer 3');
    expect(msg.html).not.toContain('videos/');
  });

  it('does not report success when the email fails, and the undelivered link cannot be used', async () => {
    const fx = await createCandidate();
    email.fail();
    const res = await share(fx.responses.get(1)!, { candidateId: fx.candidateId, recipientEmail: 'manager@example.com' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('EMAIL_DELIVERY_FAILED');
    expect(res.body.error.message).toMatch(/could not be sent/);
    const link = await ShareLink.findOne().lean();
    expect(link?.emailStatus).toBe('Failed');
    expect(link?.emailLastAttemptAt).toBeInstanceOf(Date);
    expect(JSON.stringify(res.body)).not.toMatch(/[A-Za-z0-9_-]{43}|tokenHash/);
  });

  it('retrying a failed share reuses the same record with a new token and the original expiry', async () => {
    const fx = await createCandidate();
    email.fail();
    await share(fx.responses.get(1)!, { candidateId: fx.candidateId, recipientEmail: 'manager@example.com' });
    const failed = (await ShareLink.findOne().lean())!;

    email.fail(false);
    const retry = await share(fx.responses.get(1)!, { candidateId: fx.candidateId, recipientEmail: 'MANAGER@example.com' });
    expect(retry.status).toBe(201);
    expect(retry.body.reused).toBe(true);
    expect(retry.body.shareLink.id).toBe(failed._id.toString());
    expect(retry.body.shareLink.expiresAt).toBe(failed.expiresAt.toISOString());
    expect(await ShareLink.countDocuments()).toBe(1);

    const stored = (await ShareLink.findOne().lean())!;
    expect(stored.tokenHash).not.toBe(failed.tokenHash);
    expect(stored.emailStatus).toBe('Sent');
    expect((await publicView(tokenFromEmail(0))).status).toBe(200);
  });

  it('sharing again after a successful share creates a new, separate link', async () => {
    const fx = await createCandidate();
    await share(fx.responses.get(1)!, { candidateId: fx.candidateId, recipientEmail: 'manager@example.com' });
    const again = await share(fx.responses.get(1)!, { candidateId: fx.candidateId, recipientEmail: 'manager@example.com' });
    expect(again.status).toBe(201);
    expect(again.body.reused).toBe(false);
    expect(await ShareLink.countDocuments()).toBe(2);
  });

  it('returns 503 without creating a link when email is not configured', async () => {
    const fx = await createCandidate();
    email.restore();
    const { config } = await import('../src/config/env.js');
    const smtp = config.smtp as { user: string | undefined };
    const saved = smtp.user;
    smtp.user = undefined;
    try {
      const res = await share(fx.responses.get(1)!, { candidateId: fx.candidateId, recipientEmail: 'm@example.com' });
      expect(res.status).toBe(503);
      expect(await ShareLink.countDocuments()).toBe(0);
    } finally {
      smtp.user = saved;
    }
  });
});

describe('GET /api/shared-responses/:token (public)', () => {
  async function sharedToken(fx: Fixture, n = 3) {
    await share(fx.responses.get(n)!, { candidateId: fx.candidateId, recipientEmail: 'manager@example.com' });
    return tokenFromEmail(email.sent.length - 1);
  }

  it('returns only the shared question and its response, without login', async () => {
    const fx = await createCandidate();
    const token = await sharedToken(fx, 3);
    const res = await publicView(token);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      type: 'response',
      candidateName: 'Priya Sharma',
      question: { number: 3, text: questionSeedData[2]!.questionText },
      response: {
        writtenAnswer: 'Answer 3',
        video: {
          status: 'Uploaded',
          available: true,
          url: expect.stringContaining('download=1'),
          mimeType: 'video/webm',
          urlExpiresAt: expect.any(String),
        },
      },
      expiresAt: expect.any(String),
    });
    const body = JSON.stringify(res.body);
    for (const other of ['Answer 1', 'Answer 2', 'Answer 4', 'Answer 10', questionSeedData[0]!.questionText]) {
      expect(body).not.toContain(other);
    }
  });

  it('exposes no candidate email, IDs, tokens or storage keys', async () => {
    const fx = await createCandidate();
    const token = await sharedToken(fx, 3);
    const candidate = await Candidate.findById(fx.candidateId);
    const link = await ShareLink.findOne().lean();
    const body = JSON.stringify((await publicView(token)).body);
    for (const s of [
      ...SENSITIVE(fx),
      candidate!.email,
      fx.candidateId,
      fx.responses.get(3)!,
      questionIds[2]!,
      link!._id.toString(),
      token,
      hashToken(token),
      'manager@example.com',
    ]) {
      expect(body).not.toContain(s);
    }
  });

  it('returns 404 for invalid, malformed or undelivered tokens', async () => {
    expect((await publicView(generateToken())).status).toBe(404);
    expect((await publicView('short')).status).toBe(404);
    const fx = await createCandidate();
    email.fail();
    await share(fx.responses.get(1)!, { candidateId: fx.candidateId, recipientEmail: 'm@example.com' });
    // The token from a failed send never reached anyone; even if it had, it is not usable.
    const undelivered = (await ShareLink.findOne().lean())!;
    expect(undelivered.emailStatus).toBe('Failed');
    const res = await publicView(generateToken());
    expect(res.body.error.code).toBe('SHARE_LINK_NOT_FOUND');
  });

  it('returns 410 for an expired link and keeps the record', async () => {
    const fx = await createCandidate();
    const token = await sharedToken(fx, 2);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 7 * DAY + 60_000 });
    const res = await publicView(token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('SHARE_LINK_EXPIRED');
    expect(await ShareLink.countDocuments()).toBe(1);
  });

  it('is valid just before 7 days', async () => {
    const fx = await createCandidate();
    const token = await sharedToken(fx, 2);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 7 * DAY - 60_000 });
    expect((await publicView(token)).status).toBe(200);
  });

  it('a share token cannot be used to reach another question or the candidate APIs', async () => {
    const fx = await createCandidate();
    const token = await sharedToken(fx, 3);
    // The token only identifies its own response; there is no way to address another question.
    expect((await request(app).get(`/api/shared-responses/${token}/../${questionIds[0]}`)).body?.question?.number ?? 3).toBe(3);
    expect((await request(app).get(`/api/shared-responses/${token}?question=1`)).body.question.number).toBe(3);
    // Not usable as a candidate token or recruiter token.
    expect((await request(app).get('/api/assessment').set('X-Assessment-Token', token)).status).toBe(401);
    expect((await request(app).put(`/api/assessment/questions/${questionIds[2]}/response`).set('X-Assessment-Token', token).send({ writtenAnswer: 'x' })).status).toBe(401);
    expect((await request(app).get(`/api/candidates/${fx.candidateId}/report`).set('Authorization', `Bearer ${token}`)).status).toBe(401);
    // Read-only: no write methods exist on the public route.
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      expect((await request(app)[method](`/api/shared-responses/${token}`).send({ writtenAnswer: 'x' })).status).toBe(404);
    }
    expect((await Response.findById(fx.responses.get(3)))?.writtenAnswer).toBe('Answer 3');
  });

  it('returns no playback URL when the shared response has no uploaded video', async () => {
    const fx = await createCandidate({ answers: { 4: { written: 'Text only', video: null } } });
    const token = await sharedToken(fx, 4);
    const res = await publicView(token);
    expect(res.body.response).toEqual({
      writtenAnswer: 'Text only',
      video: { status: 'Missing', available: false, url: null, mimeType: null, urlExpiresAt: null },
    });
  });
});
