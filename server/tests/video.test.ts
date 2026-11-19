import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { useTestDatabase } from './helpers/db.js';
import { installFakeVideoStorage } from './helpers/fakeVideoStorage.js';
import { createApp } from '../src/app.js';
import { Candidate, Invitation, Question, Response } from '../src/models/index.js';
import { questionSeedData } from '../src/seed/questionSeedData.js';
import { seedQuestions } from '../src/services/questionSeedService.js';
import { generateToken, hashToken } from '../src/utils/token.js';
import { S3VideoStorage, createS3Client } from '../src/services/storage/videoStorage.js';
import { normalizeVideoMimeType, videoKeyPrefix } from '../src/services/videoService.js';

useTestDatabase();

const app = createApp();
const MB = 1024 * 1024;
let s3: ReturnType<typeof installFakeVideoStorage>;
let questionIds: string[];

interface Fixture {
  token: string;
  candidateId: mongoose.Types.ObjectId;
  invitationId: mongoose.Types.ObjectId;
}

async function createCandidate(email: string, status: 'Invited' | 'In Progress' = 'In Progress'): Promise<Fixture> {
  const candidate = await Candidate.create({ name: email, email });
  const token = generateToken();
  const invitation = await Invitation.create({
    candidateId: candidate._id,
    tokenHash: hashToken(token),
    status,
    emailStatus: 'Sent',
  });
  return { token, candidateId: candidate._id, invitationId: invitation._id };
}

const uploadUrl = (token: string, qid: string, body: unknown = { mimeType: 'video/webm', sizeBytes: 5_000_000 }) =>
  request(app)
    .post(`/api/assessment/questions/${qid}/video-upload-url`)
    .set('X-Assessment-Token', token)
    .send(body as object);
const confirm = (token: string, qid: string, objectKey: unknown) =>
  request(app)
    .post(`/api/assessment/questions/${qid}/video-confirm`)
    .set('X-Assessment-Token', token)
    .send({ objectKey });
const videoUrl = (token: string, qid: string) =>
  request(app).get(`/api/assessment/questions/${qid}/video-url`).set('X-Assessment-Token', token);

/** Requests a URL, simulates the browser PUT to S3, and confirms. */
async function uploadVideo(fx: Fixture, qid: string, info = { sizeBytes: 5_000_000, contentType: 'video/webm' }) {
  const res = await uploadUrl(fx.token, qid, { mimeType: info.contentType, sizeBytes: info.sizeBytes });
  s3.put(res.body.objectKey, info);
  const confirmed = await confirm(fx.token, qid, res.body.objectKey);
  return { objectKey: res.body.objectKey as string, confirmed };
}

beforeEach(async () => {
  s3 = installFakeVideoStorage();
  await seedQuestions(questionSeedData);
  questionIds = (await Question.find().sort({ questionNumber: 1 })).map((q) => q.id as string);
});

afterEach(() => s3.restore());

describe('POST /video-upload-url', () => {
  it('returns a short-lived presigned PUT URL with a server-generated key and headers', async () => {
    const fx = await createCandidate('a@example.com');
    const res = await uploadUrl(fx.token, questionIds[0]!, { mimeType: 'video/webm;codecs=vp8,opus', sizeBytes: 1234 });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      uploadUrl: expect.stringMatching(/^https:\/\/fake-s3\.test\//),
      objectKey: expect.stringMatching(/^videos\/[a-f0-9]{32}\/\d{13}-[a-f0-9]{24}\.webm$/),
      method: 'PUT',
      headers: { 'Content-Type': 'video/webm' },
      expiresAt: expect.any(String),
    });
    expect(res.body.objectKey.startsWith(videoKeyPrefix(fx.candidateId.toString(), questionIds[0]!))).toBe(true);
    // The key reveals no internal IDs.
    expect(res.body.objectKey).not.toContain(fx.candidateId.toString());
    expect(res.body.objectKey).not.toContain(questionIds[0]);
    expect(s3.storage.createUploadUrl).toHaveBeenCalledWith(res.body.objectKey, 'video/webm', 1234, 900);
    const expiresInMs = Date.parse(res.body.expiresAt) - Date.now();
    expect(expiresInMs).toBeGreaterThan(14 * 60_000);
    expect(expiresInMs).toBeLessThanOrEqual(15 * 60_000);
  });

  it('accepts MP4 (Safari) and generates a unique key every time', async () => {
    const fx = await createCandidate('a@example.com');
    const a = await uploadUrl(fx.token, questionIds[0]!, { mimeType: 'video/mp4', sizeBytes: 10 });
    const b = await uploadUrl(fx.token, questionIds[0]!, { mimeType: 'video/mp4', sizeBytes: 10 });
    expect(a.body.objectKey).toMatch(/\.mp4$/);
    expect(a.body.objectKey).not.toBe(b.body.objectKey);
  });

  it('does not mark anything as uploaded', async () => {
    const fx = await createCandidate('a@example.com');
    await uploadUrl(fx.token, questionIds[0]!);
    expect(await Response.countDocuments()).toBe(0);
  });

  it('ignores any objectKey supplied by the client', async () => {
    const fx = await createCandidate('a@example.com');
    const res = await uploadUrl(fx.token, questionIds[0]!, {
      mimeType: 'video/webm',
      sizeBytes: 10,
      objectKey: 'videos/evil/key.webm',
    });
    expect(res.body.objectKey).not.toBe('videos/evil/key.webm');
    expect(res.body.objectKey.startsWith(videoKeyPrefix(fx.candidateId.toString(), questionIds[0]!))).toBe(true);
  });

  it('rejects missing or invalid candidate tokens', async () => {
    const noToken = await request(app)
      .post(`/api/assessment/questions/${questionIds[0]}/video-upload-url`)
      .send({ mimeType: 'video/webm', sizeBytes: 10 });
    expect(noToken.status).toBe(401);
    expect((await uploadUrl(generateToken(), questionIds[0]!)).status).toBe(401);
    expect(s3.storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects invalid and unknown question IDs', async () => {
    const fx = await createCandidate('a@example.com');
    expect((await uploadUrl(fx.token, 'not-an-id')).status).toBe(400);
    expect((await uploadUrl(fx.token, new mongoose.Types.ObjectId().toString())).status).toBe(404);
  });

  it.each(['video/quicktime', 'image/png', 'application/octet-stream', 'video/x-matroska'])(
    'rejects unsupported MIME type %s',
    async (mimeType) => {
      const fx = await createCandidate('a@example.com');
      const res = await uploadUrl(fx.token, questionIds[0]!, { mimeType, sizeBytes: 10 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_VIDEO_TYPE');
    },
  );

  it('rejects oversized, empty and non-numeric sizes', async () => {
    const fx = await createCandidate('a@example.com');
    const big = await uploadUrl(fx.token, questionIds[0]!, { mimeType: 'video/webm', sizeBytes: 200 * MB + 1 });
    expect(big.status).toBe(400);
    expect(big.body.error).toEqual({ code: 'VIDEO_TOO_LARGE', message: 'The video is too large (maximum 200 MB).' });
    expect((await uploadUrl(fx.token, questionIds[0]!, { mimeType: 'video/webm', sizeBytes: 200 * MB })).status).toBe(200);
    for (const sizeBytes of [0, -5, 1.5, '100']) {
      expect((await uploadUrl(fx.token, questionIds[0]!, { mimeType: 'video/webm', sizeBytes })).status).toBe(400);
    }
  });

  it('requires the assessment to be started', async () => {
    const fx = await createCandidate('a@example.com', 'Invited');
    const res = await uploadUrl(fx.token, questionIds[0]!);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_NOT_STARTED');
  });

  it('returns 503 when video storage is not configured', async () => {
    s3.restore();
    const { config } = await import('../src/config/env.js');
    const saved = config.video.bucket;
    (config.video as { bucket: string | undefined }).bucket = undefined;
    try {
      const fx = await createCandidate('a@example.com');
      const res = await uploadUrl(fx.token, questionIds[0]!);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('VIDEO_STORAGE_NOT_CONFIGURED');
    } finally {
      (config.video as { bucket: string | undefined }).bucket = saved;
    }
  });
});

describe('POST /video-confirm', () => {
  it('verifies the object in S3 and saves the video metadata', async () => {
    const fx = await createCandidate('a@example.com');
    await request(app)
      .put(`/api/assessment/questions/${questionIds[0]}/response`)
      .set('X-Assessment-Token', fx.token)
      .send({ writtenAnswer: 'Written first' });

    const { objectKey, confirmed } = await uploadVideo(fx, questionIds[0]!, { sizeBytes: 4321, contentType: 'video/webm' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.response).toEqual({
      questionId: questionIds[0],
      writtenAnswer: 'Written first',
      videoStatus: 'Uploaded',
      updatedAt: expect.any(String),
    });
    expect(s3.storage.headObject).toHaveBeenCalledWith(objectKey);

    const stored = await Response.findOne({ candidateId: fx.candidateId, questionId: questionIds[0] }).lean();
    expect(stored?.video).toEqual({
      objectKey,
      mimeType: 'video/webm',
      sizeBytes: 4321,
      uploadStatus: 'Uploaded',
      uploadedAt: expect.any(Date),
    });
    expect(stored?.writtenAnswer).toBe('Written first'); // existing response record reused
    expect(await Response.countDocuments()).toBe(1);
  });

  it('creates the response record if no written answer was saved yet', async () => {
    const fx = await createCandidate('a@example.com');
    const { confirmed } = await uploadVideo(fx, questionIds[1]!);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.response.writtenAnswer).toBe('');
  });

  it('does not mark the video Uploaded when the object is missing in S3 (failed upload)', async () => {
    const fx = await createCandidate('a@example.com');
    const res = await uploadUrl(fx.token, questionIds[0]!);
    const confirmed = await confirm(fx.token, questionIds[0]!, res.body.objectKey); // never PUT
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error.code).toBe('VIDEO_NOT_UPLOADED');
    expect(await Response.countDocuments()).toBe(0);
  });

  it('keeps the previous video when a replacement upload fails', async () => {
    const fx = await createCandidate('a@example.com');
    const { objectKey: first } = await uploadVideo(fx, questionIds[0]!);
    const res = await uploadUrl(fx.token, questionIds[0]!);
    expect((await confirm(fx.token, questionIds[0]!, res.body.objectKey)).status).toBe(409);
    const stored = await Response.findOne({ candidateId: fx.candidateId }).lean();
    expect(stored?.video?.objectKey).toBe(first);
    expect(stored?.video?.uploadStatus).toBe('Uploaded');
    expect(s3.objects.has(first)).toBe(true);
  });

  it("rejects another candidate's object key", async () => {
    const a = await createCandidate('a@example.com');
    const b = await createCandidate('b@example.com');
    const { objectKey: aKey } = await uploadVideo(a, questionIds[0]!);

    const res = await confirm(b.token, questionIds[0]!, aKey);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_OBJECT_KEY');
    expect(await Response.countDocuments({ candidateId: b.candidateId })).toBe(0);
    expect(s3.storage.headObject).toHaveBeenCalledTimes(1); // only A's confirm touched S3
  });

  it('rejects keys for a different question or arbitrary keys', async () => {
    const fx = await createCandidate('a@example.com');
    const res = await uploadUrl(fx.token, questionIds[0]!);
    s3.put(res.body.objectKey);
    expect((await confirm(fx.token, questionIds[1]!, res.body.objectKey)).status).toBe(403);
    for (const key of ['videos/../secret.webm', 'other/key.webm', `${res.body.objectKey}/../x`, '']) {
      const r = await confirm(fx.token, questionIds[0]!, key);
      expect([400, 403]).toContain(r.status);
    }
  });

  it('rejects and deletes an object with the wrong content type or size', async () => {
    const fx = await createCandidate('a@example.com');
    const res = await uploadUrl(fx.token, questionIds[0]!);
    s3.put(res.body.objectKey, { sizeBytes: 100, contentType: 'text/html' });
    const bad = await confirm(fx.token, questionIds[0]!, res.body.objectKey);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_VIDEO_UPLOAD');
    expect(s3.objects.has(res.body.objectKey)).toBe(false);

    const res2 = await uploadUrl(fx.token, questionIds[0]!);
    s3.put(res2.body.objectKey, { sizeBytes: 201 * MB, contentType: 'video/webm' });
    expect((await confirm(fx.token, questionIds[0]!, res2.body.objectKey)).status).toBe(400);
    expect(await Response.countDocuments()).toBe(0);
  });

  it('replaces the active video and deletes the previous S3 object', async () => {
    const fx = await createCandidate('a@example.com');
    const { objectKey: first } = await uploadVideo(fx, questionIds[0]!);
    const { objectKey: second, confirmed } = await uploadVideo(fx, questionIds[0]!, { sizeBytes: 999, contentType: 'video/mp4' });

    expect(confirmed.status).toBe(200);
    expect(second).not.toBe(first);
    const stored = await Response.findOne({ candidateId: fx.candidateId }).lean();
    expect(stored?.video).toMatchObject({ objectKey: second, mimeType: 'video/mp4', sizeBytes: 999 });
    expect(s3.storage.deleteObject).toHaveBeenCalledWith(first);
    expect(s3.objects.has(first)).toBe(false);
    expect(s3.objects.has(second)).toBe(true);
    expect(await Response.countDocuments()).toBe(1);
  });

  it('still succeeds when deleting the previous object fails', async () => {
    const fx = await createCandidate('a@example.com');
    const { objectKey: first } = await uploadVideo(fx, questionIds[0]!);
    s3.failDelete();
    const { objectKey: second, confirmed } = await uploadVideo(fx, questionIds[0]!);

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.response.videoStatus).toBe('Uploaded');
    expect((await Response.findOne({ candidateId: fx.candidateId }).lean())?.video?.objectKey).toBe(second);
    expect(s3.objects.has(first)).toBe(true); // left for later cleanup
  });

  it('is idempotent when the same upload is confirmed twice', async () => {
    const fx = await createCandidate('a@example.com');
    const { objectKey } = await uploadVideo(fx, questionIds[0]!);
    const again = await confirm(fx.token, questionIds[0]!, objectKey);
    expect(again.status).toBe(200);
    expect(s3.storage.deleteObject).not.toHaveBeenCalled();
  });

  it('cannot replace videos after the assessment is completed', async () => {
    const fx = await createCandidate('a@example.com');
    const res = await uploadUrl(fx.token, questionIds[0]!);
    s3.put(res.body.objectKey);
    await Invitation.updateOne({ _id: fx.invitationId }, { status: 'Completed', completedAt: new Date() });
    expect((await confirm(fx.token, questionIds[0]!, res.body.objectKey)).status).toBe(409);
    expect((await uploadUrl(fx.token, questionIds[0]!)).status).toBe(409);
    expect(await Response.countDocuments()).toBe(0);
  });

  it('marks the question Complete only with a written answer and uploaded video', async () => {
    const fx = await createCandidate('a@example.com');
    await uploadVideo(fx, questionIds[0]!);
    let assessment = await request(app).get('/api/assessment').set('X-Assessment-Token', fx.token);
    expect(assessment.body.questions[0].status).toBe('In Progress');

    await request(app)
      .put(`/api/assessment/questions/${questionIds[0]}/response`)
      .set('X-Assessment-Token', fx.token)
      .send({ writtenAnswer: 'Now complete' });
    assessment = await request(app).get('/api/assessment').set('X-Assessment-Token', fx.token);
    expect(assessment.body.questions[0].status).toBe('Complete');
    expect(assessment.body.progress).toMatchObject({ writtenAnswered: 1, videosUploaded: 1, questionsComplete: 1 });
    expect(JSON.stringify(assessment.body)).not.toContain('videos/');
  });
});

describe('GET /video-url', () => {
  it('returns a presigned playback URL for the candidate’s uploaded video', async () => {
    const fx = await createCandidate('a@example.com');
    const { objectKey } = await uploadVideo(fx, questionIds[0]!);
    const res = await videoUrl(fx.token, questionIds[0]!);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ url: expect.stringContaining('download=1'), mimeType: 'video/webm', expiresAt: expect.any(String) });
    expect(s3.storage.createDownloadUrl).toHaveBeenCalledWith(objectKey, 'video/webm', 900);
  });

  it('returns 404 when no video is uploaded', async () => {
    const fx = await createCandidate('a@example.com');
    const res = await videoUrl(fx.token, questionIds[0]!);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VIDEO_NOT_FOUND');
  });

  it("never returns another candidate's video", async () => {
    const a = await createCandidate('a@example.com');
    const b = await createCandidate('b@example.com');
    await uploadVideo(a, questionIds[0]!);
    const res = await videoUrl(b.token, questionIds[0]!);
    expect(res.status).toBe(404);
    expect(s3.storage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens and question IDs', async () => {
    const fx = await createCandidate('a@example.com');
    expect((await videoUrl(generateToken(), questionIds[0]!)).status).toBe(401);
    expect((await videoUrl(fx.token, 'bad')).status).toBe(400);
  });
});

describe('S3 presigned URLs (real SDK, no network)', () => {
  const storage = new S3VideoStorage(createS3Client('ap-south-1'), 'test-video-bucket');

  it('signs Content-Type and Content-Length into the PUT URL without a body checksum', async () => {
    const url = new URL(await storage.createUploadUrl('videos/a/b/c.webm', 'video/webm', 1234, 900));
    expect(url.host).toBe('test-video-bucket.s3.ap-south-1.amazonaws.com');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    // A checksum here would be of an empty body and break browser uploads.
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().startsWith('x-amz-checksum'))).toBe(false);
    expect(url.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(false);
  });

  it('creates a short-lived GET URL (bucket stays private)', async () => {
    const url = new URL(await storage.createDownloadUrl('videos/a/b/c.webm', 'video/webm', 900));
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('response-content-type')).toBe('video/webm');
  });
});

describe('normalizeVideoMimeType', () => {
  it.each([
    ['video/webm', 'video/webm'],
    ['video/webm;codecs=vp9,opus', 'video/webm'],
    ['VIDEO/MP4; codecs="avc1.42E01E, mp4a.40.2"', 'video/mp4'],
    ['video/ogg', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeVideoMimeType(input)).toBe(expected);
  });
});
