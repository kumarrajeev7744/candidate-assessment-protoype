import { vi } from 'vitest';
import {
  setVideoStorageForTesting,
  type StoredObjectInfo,
  type VideoStorage,
} from '../../src/services/storage/videoStorage.js';

/** In-memory S3 stand-in. Tests "upload" by calling `put(key, info)`. */
export function installFakeVideoStorage() {
  const objects = new Map<string, StoredObjectInfo>();
  let failDelete = false;
  const storage = {
    createUploadUrl: vi.fn(async (key: string, contentType: string, sizeBytes: number, expires: number) =>
      `https://fake-s3.test/${key}?type=${encodeURIComponent(contentType)}&size=${sizeBytes}&expires=${expires}&sig=x`),
    createDownloadUrl: vi.fn(async (key: string, contentType: string, expires: number) =>
      `https://fake-s3.test/${key}?download=1&type=${encodeURIComponent(contentType)}&expires=${expires}&sig=y`),
    headObject: vi.fn(async (key: string) => objects.get(key) ?? null),
    deleteObject: vi.fn(async (key: string) => {
      if (failDelete) throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' });
      objects.delete(key);
    }),
    listObjectKeys: vi.fn(async (prefix: string) => [...objects.keys()].filter((k) => k.startsWith(prefix))),
  } satisfies VideoStorage;
  setVideoStorageForTesting(storage);
  return {
    storage,
    objects,
    put: (key: string, info: StoredObjectInfo = { sizeBytes: 5_000_000, contentType: 'video/webm' }) =>
      objects.set(key, info),
    failDelete: (value = true) => {
      failDelete = value;
    },
    restore: () => setVideoStorageForTesting(null),
  };
}
