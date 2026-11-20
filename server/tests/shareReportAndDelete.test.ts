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
  responseIds: string[];
  videoKeys: string[];
}

async function createCandidate(status: 'In Progress' | 'Completed' = 'Completed', count = 10): Promise<Fixture> {
  const candidate = await Candidate.create({ name: 'Priya Sharma', email: `p${Math.random()}@example.com` });
  const invitationToken = generateToken();
  await Invitation.create({
    candidateId: candidate._id,
    tokenHash: hashToken(invitationToken),
    status,
    emailStatus: 'Sent',
    ...(status === 'Completed' ? { completedAt: new Date() } : {}),
  });
  const responseIds: string[] = [];
  const videoKeys: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = `${videoKeyPrefix(candidate.id as string, questionIds[i]!)}1700000000000-${'a'.repeat(24)}.webm`;
    s3.put(key);
    videoKeys.push(key);
    const r = await Response.create({
      candidateId: candidate._id,
      questionId: questionIds[i],
      writtenAnswer: `Answer ${i + 1}`,
      video: { objectKey: key, mimeType: 'video/webm', sizeBytes: 100, uploadStatus: 'Uploaded' },
    });
    responseIds.push(r.id as string);
  }
  return { candidateId: candidate.id as string, invitationToken, responseIds, videoKeys };
}

const shareReport = (candidateId: string, body: unknown, auth = true) => {
  const req = request(app).post(`/api/candidates/${candidateId}/share`);
  return (auth ? req.set('Authorization', authHeader) : req).send(body as object);
};
const removeCandidate = (candidateId: string, auth = true) => {
  const req = request(app).delete(`/api/candidates/${candidateId}`);
  return auth ? req.set('Authorization', authHeader) : req;
};
const publicView = (token: string) => request(app).get(`/api/shared-responses/${token}`);
const lastShareToken = () => /\/shared-response\/([A-Za-z0-9_-]{43})/.exec(email.sent.at(-1)!.text)![1]!;

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

describe('POST /api/candidates/:candidateId/share (share full report)', () => {
  it('requires recruiter authentication and valid input', async () => {
    const fx = await createCandidate();
    expect((await shareReport(fx.candidateId, { recipientEmail: 'm@example.com' }, false)).status).toBe(401);
    expect(
      (await request(app).post(`/api/candidates/${fx.candidateId}/share`).set('X-Assessment-Token', fx.invitationToken).send({ recipientEmail: 'm@example.com' })).status,
    ).toBe(401);
    expect((await shareReport(fx.candidateId, { recipientEmail: 'bad' })).status).toBe(400);
    expect((await shareReport('bad-id', { recipientEmail: 'm@example.com' })).status).toBe(400);
    expect((await shareReport(new mongoose.Types.ObjectId().toString(), { recipientEmail: 'm@example.com' })).status).toBe(404);
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it('only shares completed assessments', async () => {
    const fx = await createCandidate('In Progress');
    const res = await shareReport(fx.candidateId, { recipientEmail: 'm@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_NOT_COMPLETED');
  });

  it('creates one hashed 7-day link and emails the full-assessment link without answer content', async () => {
    const fx = await createCandidate();
    const res = await shareReport(fx.candidateId, { recipientEmail: 'Manager@Example.com' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ shareLink: { recipientEmail: 'manager@example.com', emailStatus: 'Sent' }, reused: false, email: { sent: true } });

    const link = (await ShareLink.findOne().lean())!;
    expect(link.scope).toBe('report');
    expect(link.candidateId?.toString()).toBe(fx.candidateId);
    expect(link.responseId).toBeUndefined();
    const token = lastShareToken();
    expect(link.tokenHash).toBe(hashToken(token));
    expect(link.expiresAt.getTime() - link.createdAt.getTime()).toBeGreaterThanOrEqual(7 * DAY - 1000);

    const msg = email.sent.at(-1)!;
    expect(msg.subject).toBe('Candidate assessment shared with you: Priya Sharma');
    expect(msg.text).toContain('Includes: all 10 questions with written and video answers');
    expect(msg.text).toMatch(/This link expires in 7 days/);
    expect(msg.text).not.toContain('Answer 1');
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it('public link shows every question with answers and videos, and nothing sensitive', async () => {
    const fx = await createCandidate();
    await shareReport(fx.candidateId, { recipientEmail: 'manager@example.com' });
    const res = await publicView(lastShareToken());
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('report');
    expect(res.body.candidateName).toBe('Priya Sharma');
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.questions.map((q: { number: number }) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(res.body.questions[0]).toEqual({
      number: 1,
      text: questionSeedData[0]!.questionText,
      writtenAnswer: 'Answer 1',
      video: expect.objectContaining({ status: 'Uploaded', available: true, url: expect.stringContaining('download=1') }),
    });
    const body = JSON.stringify(res.body);
    for (const secret of [fx.candidateId, ...fx.responseIds, fx.invitationToken, 'tokenHash', 'objectKey', 'recipient', '@example.com']) {
      expect(body).not.toContain(secret);
    }
  });

  it('retrying after a failed email reuses the same link record; an expired link returns 410', async () => {
    const fx = await createCandidate();
    email.fail();
    expect((await shareReport(fx.candidateId, { recipientEmail: 'm@example.com' })).status).toBe(502);
    email.fail(false);
    const retry = await shareReport(fx.candidateId, { recipientEmail: 'm@example.com' });
    expect(retry.status).toBe(201);
    expect(retry.body.reused).toBe(true);
    expect(await ShareLink.countDocuments({ scope: 'report' })).toBe(1);

    const token = lastShareToken();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 7 * DAY + 60_000 });
    expect((await publicView(token)).status).toBe(410);
  });

  it('single-response shares still work and are separate from report shares', async () => {
    const fx = await createCandidate();
    await shareReport(fx.candidateId, { recipientEmail: 'm@example.com' });
    const single = await request(app)
      .post(`/api/responses/${fx.responseIds[2]}/share`)
      .set('Authorization', authHeader)
      .send({ candidateId: fx.candidateId, recipientEmail: 'm@example.com' });
    expect(single.status).toBe(201);
    expect(single.body.reused).toBe(false);
    const view = await publicView(lastShareToken());
    expect(view.body.type).toBe('response');
    expect(view.body.question.number).toBe(3);
    expect(await ShareLink.countDocuments()).toBe(2);
  });
});

describe('DELETE /api/candidates/:candidateId', () => {
  it('requires recruiter authentication and valid IDs', async () => {
    const fx = await createCandidate();
    expect((await removeCandidate(fx.candidateId, false)).status).toBe(401);
    expect((await request(app).delete(`/api/candidates/${fx.candidateId}`).set('X-Assessment-Token', fx.invitationToken)).status).toBe(401);
    expect((await removeCandidate('bad-id')).status).toBe(400);
    expect((await removeCandidate(new mongoose.Types.ObjectId().toString())).status).toBe(404);
    expect(await Candidate.countDocuments()).toBe(1);
  });

  it('deletes the candidate, invitation, responses, share links and every S3 video (incl. orphans)', async () => {
    const fx = await createCandidate();
    const other = await createCandidate();
    // A replaced/abandoned upload that no response points to any more.
    const orphan = `${videoKeyPrefix(fx.candidateId, questionIds[0]!)}1800000000000-${'b'.repeat(24)}.webm`;
    s3.put(orphan);
    await shareReport(fx.candidateId, { recipientEmail: 'm@example.com' });
    const reportToken = lastShareToken();
    await request(app)
      .post(`/api/responses/${fx.responseIds[0]}/share`)
      .set('Authorization', authHeader)
      .send({ candidateId: fx.candidateId, recipientEmail: 'm@example.com' });
    const responseToken = lastShareToken();
    // A legacy single-response link without candidateId.
    await ShareLink.create({ responseId: fx.responseIds[1], tokenHash: hashToken(generateToken()), recipientEmail: 'x@example.com', emailStatus: 'Sent' });

    const res = await removeCandidate(fx.candidateId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: { candidate: 1, invitations: 1, responses: 10, shareLinks: 3, videos: 11 } });

    expect(await Candidate.exists({ _id: fx.candidateId })).toBeNull();
    expect(await Invitation.countDocuments({ candidateId: fx.candidateId })).toBe(0);
    expect(await Response.countDocuments({ candidateId: fx.candidateId })).toBe(0);
    expect(await ShareLink.countDocuments({ $or: [{ candidateId: fx.candidateId }, { responseId: { $in: fx.responseIds } }] })).toBe(0);
    for (const key of [...fx.videoKeys, orphan]) expect(s3.objects.has(key)).toBe(false);

    // Links and the invitation token stop working.
    expect((await publicView(reportToken)).status).toBe(404);
    expect((await publicView(responseToken)).status).toBe(404);
    expect((await request(app).get('/api/assessment').set('X-Assessment-Token', fx.invitationToken)).status).toBe(401);

    // Other candidates are untouched.
    expect(await Response.countDocuments({ candidateId: other.candidateId })).toBe(10);
    for (const key of other.videoKeys) expect(s3.objects.has(key)).toBe(true);
    expect((await request(app).get('/api/invitations').set('Authorization', authHeader)).body.items).toHaveLength(1);
  });

  it('deletes candidates without any responses or videos', async () => {
    const fx = await createCandidate('In Progress', 0);
    const res = await removeCandidate(fx.candidateId);
    expect(res.body.deleted).toEqual({ candidate: 1, invitations: 1, responses: 0, shareLinks: 0, videos: 0 });
  });

  it('keeps all database records when S3 deletion fails, so the recruiter can retry', async () => {
    const fx = await createCandidate('Completed', 3);
    s3.failDelete();
    const res = await removeCandidate(fx.candidateId);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('VIDEO_DELETE_FAILED');
    expect(await Candidate.exists({ _id: fx.candidateId })).not.toBeNull();
    expect(await Response.countDocuments({ candidateId: fx.candidateId })).toBe(3);

    s3.failDelete(false);
    const retry = await removeCandidate(fx.candidateId);
    expect(retry.status).toBe(200);
    expect(retry.body.deleted.videos).toBe(3);
  });

  it('refuses to delete when video storage cannot list objects', async () => {
    const fx = await createCandidate('Completed', 2);
    s3.storage.listObjectKeys.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    const res = await removeCandidate(fx.candidateId);
    expect(res.status).toBe(502);
    expect(await Candidate.exists({ _id: fx.candidateId })).not.toBeNull();
  });
});
