import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { useTestDatabase } from './helpers/db.js';
import { installFakeEmail } from './helpers/fakeEmail.js';
import { createApp } from '../src/app.js';
import { Admin, Candidate, Invitation } from '../src/models/index.js';
import { questionSeedData } from '../src/seed/questionSeedData.js';
import { seedQuestions } from '../src/services/questionSeedService.js';
import { signAdminToken } from '../src/utils/jwt.js';
import { generateToken, hashToken } from '../src/utils/token.js';

useTestDatabase();

const app = createApp();
let authHeader: string;

async function createCandidate(status: 'Invited' | 'In Progress' | 'Completed' = 'In Progress') {
  const candidate = await Candidate.create({ name: 'Arjun Mehta', email: `a${Math.random()}@example.com` });
  const token = generateToken();
  const invitation = await Invitation.create({
    candidateId: candidate._id,
    tokenHash: hashToken(token),
    status,
    emailStatus: 'Sent',
    ...(status === 'Completed' ? { completedAt: new Date() } : {}),
  });
  return { candidateId: candidate.id as string, invitationId: invitation.id as string, token };
}

const reject = (candidateId: string, body: unknown, auth = true) => {
  const req = request(app).post(`/api/candidates/${candidateId}/reject`);
  return (auth ? req.set('Authorization', authHeader) : req).send(body as object);
};
const undo = (candidateId: string, auth = true) => {
  const req = request(app).delete(`/api/candidates/${candidateId}/rejection`);
  return auth ? req.set('Authorization', authHeader) : req;
};
const list = () => request(app).get('/api/invitations').set('Authorization', authHeader);

beforeEach(async () => {
  const admin = await Admin.create({ email: 'recruiter@example.com', passwordHash: 'x' });
  authHeader = `Bearer ${signAdminToken({ id: admin.id as string, email: admin.email }).token}`;
  installFakeEmail();
  await seedQuestions(questionSeedData);
});

describe('POST /api/candidates/:candidateId/reject', () => {
  it('requires recruiter authentication', async () => {
    const fx = await createCandidate();
    expect((await reject(fx.candidateId, { reason: 'Not a fit' }, false)).status).toBe(401);
    const asCandidate = await request(app)
      .post(`/api/candidates/${fx.candidateId}/reject`)
      .set('X-Assessment-Token', fx.token)
      .send({ reason: 'x' });
    expect(asCandidate.status).toBe(401);
  });

  it('validates the ID and a reason of 1–500 characters', async () => {
    const fx = await createCandidate();
    expect((await reject('bad', { reason: 'x' })).status).toBe(400);
    expect((await reject(new mongoose.Types.ObjectId().toString(), { reason: 'x' })).status).toBe(404);
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(501) }, { reason: 5 }]) {
      const res = await reject(fx.candidateId, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await reject(fx.candidateId, { reason: 'y'.repeat(500) })).status).toBe(200);
  });

  it('records the reason, time and recruiter and shows it in the list and report', async () => {
    const fx = await createCandidate('Completed');
    const before = Date.now();
    const res = await reject(fx.candidateId, { reason: '  Lacks enterprise sales experience.  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      candidateId: fx.candidateId,
      rejection: { reason: 'Lacks enterprise sales experience.', rejectedAt: expect.any(String), rejectedBy: 'recruiter@example.com' },
    });
    expect(Date.parse(res.body.rejection.rejectedAt)).toBeGreaterThanOrEqual(before - 1000);

    const item = (await list()).body.items[0];
    expect(item.rejection).toEqual(res.body.rejection);
    expect(item.status).toBe('Completed'); // assessment status is unchanged
    const report = await request(app).get(`/api/candidates/${fx.candidateId}/report`).set('Authorization', authHeader);
    expect(report.body.candidate.rejection).toEqual(res.body.rejection);
  });

  it('cannot reject twice', async () => {
    const fx = await createCandidate();
    await reject(fx.candidateId, { reason: 'First' });
    const again = await reject(fx.candidateId, { reason: 'Second' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REJECTED');
    expect((await Candidate.findById(fx.candidateId).lean())?.rejection?.reason).toBe('First');
  });

  it('closes the assessment link for candidates who have not submitted, and blocks resending the invitation', async () => {
    const fx = await createCandidate('In Progress');
    expect((await request(app).get('/api/assessment').set('X-Assessment-Token', fx.token)).status).toBe(200);
    await reject(fx.candidateId, { reason: 'Position filled' });

    const res = await request(app).get('/api/assessment').set('X-Assessment-Token', fx.token);
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({ code: 'ASSESSMENT_CLOSED', message: 'This assessment is no longer available.' });
    expect(JSON.stringify(res.body)).not.toContain('Position filled'); // reason is never shown to the candidate

    const item = (await list()).body.items[0];
    expect(item.canResendInvitation).toBe(false);
    const resend = await request(app).post(`/api/invitations/${fx.invitationId}/resend`).set('Authorization', authHeader);
    expect(resend.status).toBe(409);
    expect(resend.body.error.code).toBe('CANDIDATE_REJECTED');
  });
});

describe('DELETE /api/candidates/:candidateId/rejection (undo)', () => {
  it('removes the rejection and reopens the link', async () => {
    const fx = await createCandidate('In Progress');
    await reject(fx.candidateId, { reason: 'Mistake' });
    const res = await undo(fx.candidateId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ candidateId: fx.candidateId, rejection: null });
    expect((await list()).body.items[0]).toMatchObject({ rejection: null, canResendInvitation: true });
    expect((await request(app).get('/api/assessment').set('X-Assessment-Token', fx.token)).status).toBe(200);
  });

  it('requires auth and returns 409 when not rejected, 404 for unknown candidates', async () => {
    const fx = await createCandidate();
    expect((await undo(fx.candidateId, false)).status).toBe(401);
    const notRejected = await undo(fx.candidateId);
    expect(notRejected.status).toBe(409);
    expect(notRejected.body.error.code).toBe('NOT_REJECTED');
    expect((await undo(new mongoose.Types.ObjectId().toString())).status).toBe(404);
  });
});
