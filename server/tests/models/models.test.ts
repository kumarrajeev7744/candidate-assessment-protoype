import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { useTestDatabase } from '../helpers/db.js';
import {
  Admin,
  Candidate,
  Invitation,
  Question,
  Response,
  ShareLink,
  WRITTEN_ANSWER_MAX_LENGTH,
} from '../../src/models/index.js';
import { generateToken, hashToken } from '../../src/utils/token.js';

useTestDatabase();

const DAY_MS = 24 * 60 * 60 * 1000;

async function createCandidate(email = 'jane@example.com') {
  return Candidate.create({ name: 'Jane Doe', email });
}

async function createQuestion(questionNumber = 1) {
  return Question.create({ questionNumber, questionText: `Question ${questionNumber}` });
}

describe('Admin model', () => {
  it('creates an admin with normalized email and timestamps', async () => {
    const admin = await Admin.create({ email: '  Recruiter@Example.COM ', passwordHash: '$2b$10$hash' });
    expect(admin.email).toBe('recruiter@example.com');
    expect(admin.createdAt).toBeInstanceOf(Date);
    expect(admin.updatedAt).toBeInstanceOf(Date);
  });

  it('requires email and passwordHash', async () => {
    const err = await Admin.create({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(mongoose.Error.ValidationError);
    const { errors } = err as mongoose.Error.ValidationError;
    expect(Object.keys(errors).sort()).toEqual(['email', 'passwordHash']);
  });

  it('rejects an invalid email', async () => {
    await expect(Admin.create({ email: 'not-an-email', passwordHash: 'x' })).rejects.toThrow(/Email is invalid/);
  });

  it('enforces a unique email (case-insensitive)', async () => {
    await Admin.create({ email: 'admin@example.com', passwordHash: 'x' });
    await expect(Admin.create({ email: 'ADMIN@example.com', passwordHash: 'y' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('does not return passwordHash by default', async () => {
    await Admin.create({ email: 'admin@example.com', passwordHash: 'secret-hash' });
    const found = await Admin.findOne({ email: 'admin@example.com' });
    expect(found?.passwordHash).toBeUndefined();
    const withHash = await Admin.findOne({ email: 'admin@example.com' }).select('+passwordHash');
    expect(withHash?.passwordHash).toBe('secret-hash');
  });
});

describe('Candidate model', () => {
  it('creates a candidate', async () => {
    const c = await createCandidate('  JANE@Example.com ');
    expect(c.name).toBe('Jane Doe');
    expect(c.email).toBe('jane@example.com');
  });

  it('requires name and email', async () => {
    const err = (await Candidate.create({}).catch((e: unknown) => e)) as mongoose.Error.ValidationError;
    expect(Object.keys(err.errors).sort()).toEqual(['email', 'name']);
  });

  it('enforces a unique email', async () => {
    await createCandidate();
    await expect(createCandidate('Jane@example.com')).rejects.toMatchObject({ code: 11000 });
  });
});

describe('Invitation model', () => {
  it('creates an invitation with defaults and a 7-day expiry', async () => {
    const candidate = await createCandidate();
    const invitedAt = new Date('2026-01-01T10:00:00Z');
    const inv = await Invitation.create({ candidateId: candidate._id, tokenHash: hashToken(generateToken()), invitedAt });
    expect(inv.status).toBe('Invited');
    expect(inv.emailStatus).toBe('Pending');
    expect(inv.completedAt).toBeUndefined();
    expect(inv.expiresAt.getTime() - invitedAt.getTime()).toBe(7 * DAY_MS);
  });

  it('requires candidateId and tokenHash', async () => {
    const err = (await Invitation.create({}).catch((e: unknown) => e)) as mongoose.Error.ValidationError;
    expect(Object.keys(err.errors).sort()).toEqual(['candidateId', 'tokenHash']);
  });

  it('stores only the token hash, never the plaintext token', async () => {
    const candidate = await createCandidate();
    const token = generateToken();
    const inv = await Invitation.create({ candidateId: candidate._id, tokenHash: hashToken(token) });

    const raw = await mongoose.connection.db!.collection('invitations').findOne({ _id: inv._id });
    expect(raw?.tokenHash).toBe(hashToken(token));
    expect(raw?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(raw)).not.toContain(token);

    const found = await Invitation.findOne({ tokenHash: hashToken(token) });
    expect(found?._id.equals(inv._id)).toBe(true);
  });

  it('rejects a plaintext token in the tokenHash field', async () => {
    const candidate = await createCandidate();
    await expect(
      Invitation.create({ candidateId: candidate._id, tokenHash: generateToken() }),
    ).rejects.toThrow(/SHA-256/);
  });

  it('rejects invalid status and email status values', async () => {
    const candidate = await createCandidate();
    const err = (await Invitation.create({
      candidateId: candidate._id,
      tokenHash: hashToken('t'),
      status: 'Done' as never,
      emailStatus: 'Bounced' as never,
    }).catch((e: unknown) => e)) as mongoose.Error.ValidationError;
    expect(Object.keys(err.errors).sort()).toEqual(['emailStatus', 'status']);
  });

  it('allows only one invitation per candidate and unique token hashes', async () => {
    const c1 = await createCandidate('a@example.com');
    const c2 = await createCandidate('b@example.com');
    await Invitation.create({ candidateId: c1._id, tokenHash: hashToken('one') });
    await expect(Invitation.create({ candidateId: c1._id, tokenHash: hashToken('two') })).rejects.toMatchObject({ code: 11000 });
    await expect(Invitation.create({ candidateId: c2._id, tokenHash: hashToken('one') })).rejects.toMatchObject({ code: 11000 });
  });

  it('only allows completedAt on completed invitations', async () => {
    const candidate = await createCandidate();
    await expect(
      Invitation.create({ candidateId: candidate._id, tokenHash: hashToken('x'), completedAt: new Date() }),
    ).rejects.toThrow(/completedAt/);
    const done = await Invitation.create({
      candidateId: candidate._id,
      tokenHash: hashToken('x'),
      status: 'Completed',
      completedAt: new Date(),
    });
    expect(done.completedAt).toBeInstanceOf(Date);
  });

  it('keeps expired invitations (no TTL index)', async () => {
    const candidate = await createCandidate();
    await Invitation.create({
      candidateId: candidate._id,
      tokenHash: hashToken('old'),
      invitedAt: new Date('2020-01-01'),
      expiresAt: new Date('2020-01-08'),
    });
    const indexes = await Invitation.collection.indexes();
    expect(indexes.some((i) => i.expireAfterSeconds !== undefined)).toBe(false);
    expect(await Invitation.countDocuments()).toBe(1);
  });
});

describe('Question model', () => {
  it('creates an active question by default', async () => {
    const q = await createQuestion(3);
    expect(q.isActive).toBe(true);
    expect(q.questionNumber).toBe(3);
  });

  it('requires questionNumber and questionText', async () => {
    const err = (await Question.create({}).catch((e: unknown) => e)) as mongoose.Error.ValidationError;
    expect(Object.keys(err.errors).sort()).toEqual(['questionNumber', 'questionText']);
  });

  it.each([0, 11, 2.5])('rejects questionNumber %s', async (n) => {
    await expect(Question.create({ questionNumber: n, questionText: 'Q' })).rejects.toBeInstanceOf(
      mongoose.Error.ValidationError,
    );
  });

  it('enforces a unique question number', async () => {
    await createQuestion(1);
    await expect(createQuestion(1)).rejects.toMatchObject({ code: 11000 });
  });
});

describe('Response model', () => {
  it('creates a response with an empty answer and no video by default', async () => {
    const [c, q] = await Promise.all([createCandidate(), createQuestion()]);
    const r = await Response.create({ candidateId: c._id, questionId: q._id });
    expect(r.writtenAnswer).toBe('');
    expect(r.video).toBeUndefined();
  });

  it('stores video metadata with a default Pending status', async () => {
    const [c, q] = await Promise.all([createCandidate(), createQuestion()]);
    const r = await Response.create({
      candidateId: c._id,
      questionId: q._id,
      writtenAnswer: 'My answer',
      video: { objectKey: 'videos/c/q.webm', mimeType: 'video/webm;codecs=vp8,opus', sizeBytes: 1024 },
    });
    expect(r.video).toMatchObject({ objectKey: 'videos/c/q.webm', sizeBytes: 1024, uploadStatus: 'Pending' });
  });

  it('validates video metadata', async () => {
    const [c, q] = await Promise.all([createCandidate(), createQuestion()]);
    const err = (await Response.create({
      candidateId: c._id,
      questionId: q._id,
      video: { mimeType: 'image/png', sizeBytes: -1, uploadStatus: 'Done' as never },
    }).catch((e: unknown) => e)) as mongoose.Error.ValidationError;
    expect(Object.keys(err.errors).sort()).toEqual([
      'video.mimeType',
      'video.objectKey',
      'video.sizeBytes',
      'video.uploadStatus',
    ]);
  });

  it('requires candidateId and questionId', async () => {
    const err = (await Response.create({}).catch((e: unknown) => e)) as mongoose.Error.ValidationError;
    expect(Object.keys(err.errors).sort()).toEqual(['candidateId', 'questionId']);
  });

  it('accepts a written answer of exactly 1,000 characters', async () => {
    const [c, q] = await Promise.all([createCandidate(), createQuestion()]);
    const r = await Response.create({
      candidateId: c._id,
      questionId: q._id,
      writtenAnswer: 'a'.repeat(WRITTEN_ANSWER_MAX_LENGTH),
    });
    expect(r.writtenAnswer).toHaveLength(1000);
  });

  it('rejects a written answer over 1,000 characters', async () => {
    const [c, q] = await Promise.all([createCandidate(), createQuestion()]);
    await expect(
      Response.create({ candidateId: c._id, questionId: q._id, writtenAnswer: 'a'.repeat(1001) }),
    ).rejects.toThrow(/cannot exceed 1000 characters/);
  });

  it('enforces one response per candidate per question', async () => {
    const [c, q1, q2] = await Promise.all([createCandidate(), createQuestion(1), createQuestion(2)]);
    await Response.create({ candidateId: c._id, questionId: q1._id });
    await Response.create({ candidateId: c._id, questionId: q2._id });
    await expect(Response.create({ candidateId: c._id, questionId: q1._id })).rejects.toMatchObject({
      code: 11000,
    });
  });
});

describe('ShareLink model', () => {
  async function createResponse() {
    const [c, q] = await Promise.all([createCandidate(), createQuestion()]);
    return Response.create({ candidateId: c._id, questionId: q._id });
  }

  it('creates a share link with a 7-day expiry and stores only the token hash', async () => {
    const response = await createResponse();
    const token = generateToken();
    const before = Date.now();
    const link = await ShareLink.create({
      responseId: response._id,
      tokenHash: hashToken(token),
      recipientEmail: 'Manager@Example.com',
    });
    expect(link.recipientEmail).toBe('manager@example.com');
    expect(link.createdAt).toBeInstanceOf(Date);
    const expiryMs = link.expiresAt.getTime() - before;
    expect(expiryMs).toBeGreaterThanOrEqual(7 * DAY_MS);
    expect(expiryMs).toBeLessThan(7 * DAY_MS + 5_000);

    const raw = await mongoose.connection.db!.collection('sharelinks').findOne({ _id: link._id });
    expect(raw?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(raw)).not.toContain(token);
  });

  it('requires responseId, tokenHash and recipientEmail', async () => {
    const err = (await ShareLink.create({}).catch((e: unknown) => e)) as mongoose.Error.ValidationError;
    expect(Object.keys(err.errors).sort()).toEqual(['recipientEmail', 'responseId', 'tokenHash']);
  });

  it('allows multiple share links per response', async () => {
    const response = await createResponse();
    await ShareLink.create({ responseId: response._id, tokenHash: hashToken('a'), recipientEmail: 'a@x.com' });
    await ShareLink.create({ responseId: response._id, tokenHash: hashToken('b'), recipientEmail: 'a@x.com' });
    expect(await ShareLink.countDocuments({ responseId: response._id })).toBe(2);
  });

  it('enforces unique token hashes', async () => {
    const response = await createResponse();
    await ShareLink.create({ responseId: response._id, tokenHash: hashToken('a'), recipientEmail: 'a@x.com' });
    await expect(
      ShareLink.create({ responseId: response._id, tokenHash: hashToken('a'), recipientEmail: 'b@x.com' }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('Indexes', () => {
  it('creates the expected indexes on every collection', async () => {
    const keysOf = async (m: mongoose.Model<never>) =>
      (await m.collection.indexes()).map((i) => ({ key: i.key, unique: Boolean(i.unique) }));

    expect(await keysOf(Admin as never)).toContainEqual({ key: { email: 1 }, unique: true });
    expect(await keysOf(Candidate as never)).toContainEqual({ key: { email: 1 }, unique: true });
    expect(await keysOf(Candidate as never)).toContainEqual({ key: { name: 1 }, unique: false });
    expect(await keysOf(Invitation as never)).toEqual(
      expect.arrayContaining([
        { key: { candidateId: 1 }, unique: true },
        { key: { tokenHash: 1 }, unique: true },
      ]),
    );
    expect(await keysOf(Question as never)).toContainEqual({ key: { questionNumber: 1 }, unique: true });
    expect(await keysOf(Response as never)).toContainEqual({ key: { candidateId: 1, questionId: 1 }, unique: true });
    expect(await keysOf(ShareLink as never)).toEqual(
      expect.arrayContaining([
        { key: { responseId: 1 }, unique: false },
        { key: { tokenHash: 1 }, unique: true },
      ]),
    );
  });
});
