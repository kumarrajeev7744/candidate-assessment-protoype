import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { useTestDatabase } from './helpers/db.js';
import { extractInvitationToken, installFakeEmail } from './helpers/fakeEmail.js';
import { createApp } from '../src/app.js';
import { Admin, Candidate, Invitation } from '../src/models/index.js';
import { signAdminToken } from '../src/utils/jwt.js';
import { generateToken, hashToken } from '../src/utils/token.js';
import { config } from '../src/config/env.js';

useTestDatabase();

const DAY_MS = 24 * 60 * 60 * 1000;
const app = createApp();
let authHeader: string;
let email: ReturnType<typeof installFakeEmail>;

beforeEach(async () => {
  const admin = await Admin.create({ email: 'recruiter@example.com', passwordHash: 'x' });
  authHeader = `Bearer ${signAdminToken({ id: admin.id as string, email: admin.email }).token}`;
  email = installFakeEmail();
});

afterEach(() => {
  email.restore();
  vi.useRealTimers();
});

function createInvitation(body: Record<string, unknown> = { name: 'Jane Doe', email: 'jane@example.com' }) {
  return request(app).post('/api/invitations').set('Authorization', authHeader).send(body);
}

function validate(token: string) {
  return request(app).get(`/api/invitations/validate/${token}`);
}

function resend(id: string) {
  return request(app).post(`/api/invitations/${id}/resend`).set('Authorization', authHeader);
}

const SENSITIVE = /tokenHash|[a-f0-9]{64}|[A-Za-z0-9_-]{43}/;

describe('POST /api/invitations', () => {
  it('lets an authenticated recruiter create a candidate invitation', async () => {
    const res = await createInvitation({ name: '  Jane Doe ', email: ' Jane@Example.com ' });

    expect(res.status).toBe(201);
    expect(res.body.candidate).toEqual({
      id: expect.any(String),
      name: 'Jane Doe',
      email: 'jane@example.com',
      createdAt: expect.any(String),
    });
    expect(res.body.invitation).toMatchObject({
      id: expect.any(String),
      candidateId: res.body.candidate.id,
      status: 'Invited',
      completedAt: null,
      emailStatus: 'Sent',
      isExpired: false,
    });
    expect(res.body.email).toEqual({ sent: true });
    expect(await Candidate.countDocuments()).toBe(1);
    expect(await Invitation.countDocuments()).toBe(1);
  });

  it('never returns the raw token or token hash', async () => {
    const res = await createInvitation();
    const token = extractInvitationToken(email.sent[0]!);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(token);
    expect(body).not.toContain(hashToken(token));
    expect(body).not.toMatch(SENSITIVE);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/invitations').send({ name: 'Jane', email: 'jane@example.com' });
    expect(res.status).toBe(401);
    expect(await Candidate.countDocuments()).toBe(0);
    expect(email.sendMail).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens', async () => {
    const res = await request(app)
      .post('/api/invitations')
      .set('Authorization', 'Bearer invalid')
      .send({ name: 'Jane', email: 'jane@example.com' });
    expect(res.status).toBe(401);
  });

  it.each([
    [{}, { name: 'Name is required', email: 'Email is required' }],
    [{ name: '   ', email: 'jane@example.com' }, { name: 'Name is required' }],
    [{ name: 'Jane', email: 'not-an-email' }, { email: 'Email is invalid' }],
    [{ name: 'x'.repeat(201), email: 'jane@example.com' }, { name: 'Name must be at most 200 characters' }],
    [{ name: '<script>', email: 'jane@example.com' }, { name: 'Name contains invalid characters' }],
    [{ name: 42, email: ['a@b.com'] }, { name: 'Name is required', email: 'Email is required' }],
  ])('returns 400 for invalid input %j', async (body, details) => {
    const res = await createInvitation(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(details);
    expect(await Candidate.countDocuments()).toBe(0);
  });

  it('returns 409 for a duplicate candidate email without creating records', async () => {
    await createInvitation();
    const res = await createInvitation({ name: 'Someone Else', email: 'JANE@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: 'CANDIDATE_EXISTS',
      message: 'A candidate with this email address already exists.',
    });
    expect(await Candidate.countDocuments()).toBe(1);
    expect(await Invitation.countDocuments()).toBe(1);
    expect(email.sendMail).toHaveBeenCalledTimes(1);
  });

  it('stores only the SHA-256 hash of the token', async () => {
    await createInvitation();
    const token = extractInvitationToken(email.sent[0]!);
    const raw = await mongoose.connection.db!.collection('invitations').findOne({});
    expect(raw?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(raw)).not.toContain(token);
  });

  it('sets the invitation expiry to 7 days from the invitation date', async () => {
    const res = await createInvitation();
    const { invitedAt, expiresAt } = res.body.invitation;
    expect(Date.parse(expiresAt) - Date.parse(invitedAt)).toBe(7 * DAY_MS);
    expect(Math.abs(Date.parse(invitedAt) - Date.now())).toBeLessThan(5_000);
  });

  it('emails the candidate with their name, the rules, the expiry date and a working link', async () => {
    const res = await createInvitation({ name: "Jane O'Brien", email: 'jane@example.com' });
    expect(email.sent).toHaveLength(1);
    const msg = email.sent[0]!;

    expect(msg.to).toBe('jane@example.com');
    expect(msg.from).toBe('Candidate Assessment <sender@example.com>');
    expect(msg.subject).toBe('Your assessment invitation');
    expect(msg.text).toContain("Dear Jane O'Brien,");
    expect(msg.html).toContain('Dear Jane O&#39;Brien,');

    const token = extractInvitationToken(msg);
    const url = `${config.appBaseUrl}/assessment/${token}`;
    expect(url).toMatch(/^http:\/\/localhost:5173\/assessment\/[A-Za-z0-9_-]{43}$/);
    expect(msg.html).toContain(`href="${url}"`);
    expect(msg.html).toContain('Start Assessment');
    expect(msg.text).toContain(`Start Assessment: ${url}`);

    for (const rule of ['10 questions', 'written response', 'video response', '1,000 characters', '2 minutes']) {
      expect(msg.html).toContain(rule);
    }
    const expiry = new Date(res.body.invitation.expiresAt);
    expect(msg.text).toContain(String(expiry.getUTCFullYear()));
    expect(msg.text).toMatch(/This invitation expires on \w+day, \d{1,2} \w+ \d{4}/);

    // The emailed link validates.
    expect((await validate(token)).status).toBe(200);
  });

  it('escapes HTML in candidate names', async () => {
    await createInvitation({ name: 'Tom & "Jerry"', email: 'tom@example.com' });
    expect(email.sent[0]!.html).toContain('Dear Tom &amp; &quot;Jerry&quot;,');
  });

  it('marks emailStatus Sent after successful delivery', async () => {
    const res = await createInvitation();
    const stored = await Invitation.findById(res.body.invitation.id);
    expect(stored?.emailStatus).toBe('Sent');
  });

  it('keeps the records and marks emailStatus Failed when delivery fails', async () => {
    email.fail();
    const res = await createInvitation();

    expect(res.status).toBe(201);
    expect(res.body.invitation.emailStatus).toBe('Failed');
    expect(res.body.email).toEqual({
      sent: false,
      error: 'The email could not be delivered. Please try again later.',
    });
    expect(await Candidate.countDocuments()).toBe(1);
    const stored = await Invitation.findById(res.body.invitation.id);
    expect(stored?.emailStatus).toBe('Failed');
    expect(stored?.status).toBe('Invited');
    // SMTP details (e.g. auth errors) are not leaked to the client.
    expect(JSON.stringify(res.body)).not.toMatch(/535|Username|Password/);
  });

  it('marks emailStatus Failed with a clear message when SMTP is not configured', async () => {
    email.restore();
    const smtp = config.smtp as { user: string | undefined; pass: string | undefined };
    const saved = { ...smtp };
    smtp.user = undefined;
    smtp.pass = undefined;
    try {
      const res = await createInvitation();
      expect(res.status).toBe(201);
      expect(res.body.invitation.emailStatus).toBe('Failed');
      expect(res.body.email.error).toMatch(/Email service is not configured/);
    } finally {
      Object.assign(smtp, saved);
    }
  });
});

describe('POST /api/invitations/:id/resend', () => {
  async function createAndGetToken() {
    const res = await createInvitation();
    return { id: res.body.invitation.id as string, token: extractInvitationToken(email.sent[0]!) };
  }

  it('generates a new token, emails it and invalidates the previous link', async () => {
    const { id, token: oldToken } = await createAndGetToken();

    const res = await resend(id);
    expect(res.status).toBe(200);
    expect(res.body.invitation.emailStatus).toBe('Sent');
    expect(res.body.email).toEqual({ sent: true });
    expect(email.sent).toHaveLength(2);

    const newToken = extractInvitationToken(email.sent[1]!);
    expect(newToken).not.toBe(oldToken);
    const stored = await Invitation.findById(id);
    expect(stored?.tokenHash).toBe(hashToken(newToken));

    expect((await validate(oldToken)).status).toBe(404);
    expect((await validate(newToken)).status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(SENSITIVE);
  });

  it('resets the expiry to 7 days from the resend date and keeps the original invitation date', async () => {
    const { id } = await createAndGetToken();
    const original = await Invitation.findById(id);
    const invitedAt = new Date(Date.now() - 10 * DAY_MS);
    await Invitation.updateOne({ _id: id }, { invitedAt, expiresAt: new Date(Date.now() - 3 * DAY_MS) });

    const before = Date.now();
    const res = await resend(id);
    expect(res.status).toBe(200);
    const expiresAt = Date.parse(res.body.invitation.expiresAt);
    expect(expiresAt - before).toBeGreaterThanOrEqual(7 * DAY_MS - 1000);
    expect(expiresAt - before).toBeLessThan(7 * DAY_MS + 5_000);
    expect(res.body.invitation.invitedAt).toBe(invitedAt.toISOString());
    expect(res.body.invitation.isExpired).toBe(false);
    expect(original?.id).toBe(id);
  });

  it('does not create duplicate candidates or invitations', async () => {
    const { id } = await createAndGetToken();
    await resend(id);
    await resend(id);
    expect(await Candidate.countDocuments()).toBe(1);
    expect(await Invitation.countDocuments()).toBe(1);
  });

  it('can resend after a failed delivery and records the new status', async () => {
    email.fail();
    const created = await createInvitation();
    expect(created.body.invitation.emailStatus).toBe('Failed');

    const failedAgain = await resend(created.body.invitation.id);
    expect(failedAgain.status).toBe(200);
    expect(failedAgain.body.invitation.emailStatus).toBe('Failed');

    email.fail(false);
    const ok = await resend(created.body.invitation.id);
    expect(ok.body.invitation.emailStatus).toBe('Sent');
    expect((await Invitation.findById(created.body.invitation.id))?.emailStatus).toBe('Sent');
  });

  it('keeps the in-progress status when resending', async () => {
    const { id } = await createAndGetToken();
    await Invitation.updateOne({ _id: id }, { status: 'In Progress' });
    const res = await resend(id);
    expect(res.body.invitation.status).toBe('In Progress');
  });

  it('refuses to resend a completed assessment', async () => {
    const { id, token } = await createAndGetToken();
    await Invitation.updateOne({ _id: id }, { status: 'Completed', completedAt: new Date() });

    const res = await resend(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_COMPLETED');
    expect(email.sent).toHaveLength(1);
    expect((await Invitation.findById(id))?.tokenHash).toBe(hashToken(token));
  });

  it('returns 400 for a malformed invitation ID', async () => {
    for (const bad of ['not-an-id', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
      const res = await resend(bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    }
  });

  it('returns 404 for an unknown invitation ID', async () => {
    const res = await resend(new mongoose.Types.ObjectId().toString());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVITATION_NOT_FOUND');
  });

  it('requires authentication', async () => {
    const { id } = await createAndGetToken();
    const res = await request(app).post(`/api/invitations/${id}/resend`);
    expect(res.status).toBe(401);
    expect(email.sent).toHaveLength(1);
  });

  it('returns 503 and keeps the current link when email is not configured', async () => {
    const { id, token } = await createAndGetToken();
    email.restore();
    const smtp = config.smtp as { user: string | undefined; pass: string | undefined };
    const saved = { ...smtp };
    smtp.user = undefined;
    smtp.pass = undefined;
    try {
      const res = await resend(id);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('EMAIL_NOT_CONFIGURED');
      expect((await validate(token)).status).toBe(200);
    } finally {
      Object.assign(smtp, saved);
    }
  });
});

describe('GET /api/invitations/validate/:token', () => {
  async function createAndGetToken() {
    const res = await createInvitation();
    return { id: res.body.invitation.id as string, token: extractInvitationToken(email.sent[0]!) };
  }

  it('returns 200 with a minimal response for a valid token', async () => {
    const { token } = await createAndGetToken();
    const res = await validate(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: true, status: 'Invited', expiresAt: expect.any(String) });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('does not expose candidate details, IDs or token data', async () => {
    const { token } = await createAndGetToken();
    const res = await validate(token);
    const body = JSON.stringify(res.body);
    for (const secret of ['jane@example.com', 'Jane Doe', token, hashToken(token), 'tokenHash', 'candidateId', '_id']) {
      expect(body).not.toContain(secret);
    }
  });

  it('does not change the invitation status (safe for email link scanners)', async () => {
    const { id, token } = await createAndGetToken();
    const before = await Invitation.findById(id).lean();
    await validate(token);
    await validate(token);
    const after = await Invitation.findById(id).lean();
    expect(after?.status).toBe('Invited');
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });

  it('returns 404 for an unknown token', async () => {
    const res = await validate(generateToken());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVITATION_NOT_FOUND');
  });

  it('returns 404 for a malformed token without querying', async () => {
    for (const bad of ['short', 'x'.repeat(44), '%24ne']) {
      expect((await validate(bad)).status).toBe(404);
    }
  });

  it('returns 410 for an expired invitation and keeps the record', async () => {
    const { id, token } = await createAndGetToken();
    await Invitation.updateOne({ _id: id }, { expiresAt: new Date(Date.now() - 1000) });
    const res = await validate(token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITATION_EXPIRED');
    expect(res.body.error.message).toMatch(/expired/);
    expect(await Invitation.countDocuments({ _id: id })).toBe(1);
  });

  it('treats an invitation as expired exactly 7 days after it was sent', async () => {
    const { token } = await createAndGetToken();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 7 * DAY_MS - 60_000 });
    expect((await validate(token)).status).toBe(200);
    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect((await validate(token)).status).toBe(410);
  });

  it('returns 409 for a completed assessment', async () => {
    const { id, token } = await createAndGetToken();
    await Invitation.updateOne({ _id: id }, { status: 'Completed', completedAt: new Date() });
    const res = await validate(token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_COMPLETED');
  });

  it('is rate limited per IP', async () => {
    const limitedApp = createApp();
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await request(limitedApp).get(`/api/invitations/validate/${generateToken()}`)).status;
    }
    expect(last).toBe(429);
  });
});
