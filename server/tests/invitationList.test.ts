import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { useTestDatabase } from './helpers/db.js';
import { installFakeEmail } from './helpers/fakeEmail.js';
import { createApp } from '../src/app.js';
import { Admin, Candidate, Invitation } from '../src/models/index.js';
import { signAdminToken } from '../src/utils/jwt.js';
import { generateToken, hashToken } from '../src/utils/token.js';
import { escapeRegExp } from '../src/services/invitationListService.js';

useTestDatabase();

const app = createApp();
const DAY = 86_400_000;
let authHeader: string;
let email: ReturnType<typeof installFakeEmail>;

beforeEach(async () => {
  const admin = await Admin.create({ email: 'recruiter@example.com', passwordHash: '$2b$12$secret-hash' });
  authHeader = `Bearer ${signAdminToken({ id: admin.id as string, email: admin.email }).token}`;
  email = installFakeEmail();
});
afterEach(() => email.restore());

const list = (query = '') => request(app).get(`/api/invitations${query}`).set('Authorization', authHeader);

async function seed(
  name: string,
  candidateEmail: string,
  daysAgo: number,
  extra: Record<string, unknown> = {},
) {
  const candidate = await Candidate.create({ name, email: candidateEmail });
  const invitedAt = new Date(Date.now() - daysAgo * DAY);
  const invitation = await Invitation.create({
    candidateId: candidate._id,
    tokenHash: hashToken(generateToken()),
    invitedAt,
    expiresAt: new Date(invitedAt.getTime() + 7 * DAY),
    emailStatus: 'Sent',
    ...extra,
  });
  return { candidate, invitation };
}

describe('GET /api/invitations', () => {
  it('rejects unauthenticated and candidate-token requests', async () => {
    expect((await request(app).get('/api/invitations')).status).toBe(401);
    expect((await request(app).get('/api/invitations').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await request(app).get('/api/invitations').set('X-Assessment-Token', generateToken())).status).toBe(401);
  });

  it('returns an empty list correctly', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 }, search: '' });
  });

  it('returns candidates with dates, status and email statuses, newest first', async () => {
    const old = await seed('Old Invited', 'old@example.com', 10);
    const mid = await seed('Mid Progress', 'mid@example.com', 3, { status: 'In Progress' });
    const done = await seed('New Done', 'done@example.com', 1, {
      status: 'Completed',
      completedAt: new Date(Date.now() - DAY / 2),
      confirmationEmailStatus: 'Failed',
      confirmationEmailLastAttemptAt: new Date(),
    });

    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { candidate: { name: string } }) => i.candidate.name)).toEqual([
      'New Done',
      'Mid Progress',
      'Old Invited',
    ]);
    expect(res.body.pagination).toEqual({ page: 1, limit: 50, total: 3, totalPages: 1 });

    const [first, second, third] = res.body.items;
    expect(first).toEqual({
      id: done.invitation.id,
      candidate: { id: done.candidate.id, name: 'New Done', email: 'done@example.com' },
      status: 'Completed',
      invitedAt: done.invitation.invitedAt.toISOString(),
      expiresAt: done.invitation.expiresAt.toISOString(),
      completedAt: done.invitation.completedAt!.toISOString(),
      isExpired: false,
      emailStatus: 'Sent',
      confirmationEmailStatus: 'Failed',
      confirmationEmailSentAt: null,
      canResendInvitation: false,
      canResendConfirmation: true,
    });
    expect(second).toMatchObject({ id: mid.invitation.id, status: 'In Progress', completedAt: null, canResendInvitation: true, canResendConfirmation: false });
    expect(third).toMatchObject({ id: old.invitation.id, status: 'Invited', isExpired: true, canResendInvitation: true, confirmationEmailStatus: null });
  });

  it('marks confirmation resend unavailable once the confirmation was sent', async () => {
    await seed('Done', 'done@example.com', 1, {
      status: 'Completed',
      completedAt: new Date(),
      confirmationEmailStatus: 'Sent',
      confirmationEmailSentAt: new Date(),
    });
    const [item] = (await list()).body.items;
    expect(item).toMatchObject({ canResendConfirmation: false, confirmationEmailStatus: 'Sent', confirmationEmailSentAt: expect.any(String) });
  });

  it('never exposes tokens, hashes, password hashes or internal fields', async () => {
    const token = generateToken();
    const candidate = await Candidate.create({ name: 'Secret', email: 'secret@example.com' });
    await Invitation.create({ candidateId: candidate._id, tokenHash: hashToken(token), responseVersion: 7 });
    const body = JSON.stringify((await list()).body);
    for (const forbidden of [token, hashToken(token), 'tokenHash', 'responseVersion', 'passwordHash', '$2b$', '__v', 'objectKey', 'videos/']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('searches by name or email, case-insensitively', async () => {
    await seed('Priya Sharma', 'priya@acme.com', 3);
    await seed('Arjun Mehta', 'arjun@globex.com', 2);
    await seed('Ravi Kumar', 'ravi.priya@initech.com', 1);

    const byName = await list('?search=arjun');
    expect(byName.body.items.map((i: { candidate: { name: string } }) => i.candidate.name)).toEqual(['Arjun Mehta']);
    expect(byName.body.search).toBe('arjun');

    const byEmailOrName = await list('?search=PRIYA');
    expect(byEmailOrName.body.items.map((i: { candidate: { name: string } }) => i.candidate.name)).toEqual([
      'Ravi Kumar',
      'Priya Sharma',
    ]);

    const byDomain = await list(`?search=${encodeURIComponent('@globex.com')}`);
    expect(byDomain.body.pagination.total).toBe(1);

    const none = await list('?search=nobody');
    expect(none.body).toMatchObject({ items: [], pagination: { total: 0 } });

    const trimmed = await list('?search=%20%20arjun%20');
    expect(trimmed.body.search).toBe('arjun');
    expect(trimmed.body.pagination.total).toBe(1);
  });

  it('treats regex characters in search as literal text', async () => {
    await seed('A.B (Test)', 'ab@example.com', 1);
    await seed('AXB Test', 'axb@example.com', 2);
    const res = await list(`?search=${encodeURIComponent('A.B (')}`);
    expect(res.body.items.map((i: { candidate: { name: string } }) => i.candidate.name)).toEqual(['A.B (Test)']);
    expect((await list(`?search=${encodeURIComponent('.*')}`)).body.pagination.total).toBe(0);
    expect(escapeRegExp('a.b*(c)')).toBe('a\\.b\\*\\(c\\)');
  });

  it('rejects invalid search and paging input with 400', async () => {
    for (const q of [`?search=${'x'.repeat(101)}`, '?search=a&search=b', '?page=0', '?page=abc', '?limit=0', '?limit=101', '?page=1.5']) {
      const res = await list(q);
      expect(res.status, q).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    // Express 5 does not build nested objects from query strings: "search[$ne]" is just an unknown key.
    await seed('Only', 'only@example.com', 1);
    const nosql = await list('?search[$ne]=x');
    expect(nosql.status).toBe(200);
    expect(nosql.body.search).toBe('');
  });

  it('paginates', async () => {
    for (let i = 0; i < 5; i++) await seed(`C${i}`, `c${i}@example.com`, 10 - i);
    const page1 = await list('?limit=2&page=1');
    const page3 = await list('?limit=2&page=3');
    expect(page1.body.items.map((i: { candidate: { name: string } }) => i.candidate.name)).toEqual(['C4', 'C3']);
    expect(page3.body.items.map((i: { candidate: { name: string } }) => i.candidate.name)).toEqual(['C0']);
    expect(page1.body.pagination).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
    expect((await list('?limit=2&page=9')).body.items).toEqual([]);
  });

  it('reflects invitations created and resent through the existing APIs', async () => {
    const created = await request(app)
      .post('/api/invitations')
      .set('Authorization', authHeader)
      .send({ name: 'New Person', email: 'new@example.com' });
    expect(created.status).toBe(201);
    const duplicate = await request(app)
      .post('/api/invitations')
      .set('Authorization', authHeader)
      .send({ name: 'New Person', email: 'NEW@example.com' });
    expect(duplicate.status).toBe(409);

    let items = (await list()).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: created.body.invitation.id, status: 'Invited', emailStatus: 'Sent' });

    email.fail();
    await request(app).post(`/api/invitations/${created.body.invitation.id}/resend`).set('Authorization', authHeader);
    items = (await list()).body.items;
    expect(items).toHaveLength(1);
    expect(items[0].emailStatus).toBe('Failed');
  });
});
