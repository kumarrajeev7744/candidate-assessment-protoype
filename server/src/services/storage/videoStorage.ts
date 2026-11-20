import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | undefined;
}

/** Storage operations used by the video workflow (implemented by S3; replaced by a fake in tests). */
export interface VideoStorage {
  createUploadUrl(key: string, contentType: string, sizeBytes: number, expiresInSeconds: number): Promise<string>;
  createDownloadUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  /** Returns null when the object does not exist. */
  headObject(key: string): Promise<StoredObjectInfo | null>;
  deleteObject(key: string): Promise<void>;
  /** All object keys under a prefix (e.g. one candidate's video folder). */
  listObjectKeys(prefix: string): Promise<string[]>;
}

export class VideoStorageNotConfiguredError extends AppError {
  constructor() {
    super(503, 'Video storage is not configured. Set AWS_REGION and S3_VIDEO_BUCKET on the server.', 'VIDEO_STORAGE_NOT_CONFIGURED');
  }
}

export class S3VideoStorage implements VideoStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  createUploadUrl(key: string, contentType: string, sizeBytes: number, expiresIn: number): Promise<string> {
    // Content-Type and Content-Length are signed: S3 rejects uploads of a different type or size.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.client, command, {
      expiresIn,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
  }

  createDownloadUrl(key: string, contentType: string, expiresIn: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentType: contentType });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async headObject(key: string): Promise<StoredObjectInfo | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (err) {
      // Without s3:ListBucket, S3 reports a missing object as 403 instead of 404.
      if (err instanceof S3ServiceException && [403, 404].includes(err.$metadata.httpStatusCode ?? 0)) return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async listObjectKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
}

/**
 * Browser uploads use presigned PUT URLs, so the SDK must not pre-compute a body checksum
 * (it would sign a checksum of an empty body and S3 would reject the real upload).
 */
export function createS3Client(region: string, endpoint?: string): S3Client {
  return new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

let storage: VideoStorage | null = null;
let override: VideoStorage | null = null;

export function isVideoStorageConfigured(): boolean {
  return Boolean(config.video.region && config.video.bucket);
}

/** Lazily creates the S3-backed storage. Credentials come from the AWS default chain (env vars, profile or IAM role). */
export function getVideoStorage(): VideoStorage {
  if (override) return override;
  if (!isVideoStorageConfigured()) throw new VideoStorageNotConfiguredError();
  if (!storage) {
    storage = new S3VideoStorage(createS3Client(config.video.region!, config.video.endpoint), config.video.bucket!);
  }
  return storage;
}

/** Test hook: replace the storage implementation (null restores S3). */
export function setVideoStorageForTesting(fake: VideoStorage | null): void {
  override = fake;
}
