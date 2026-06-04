// ════════════════════════════════════════════════════════════════════════════
// Storage Client — S3/MinIO in prod, local filesystem in dev
// ════════════════════════════════════════════════════════════════════════════
// Local dev: bytes land in `.local-uploads/<fileId>` so devs don't need a
// running MinIO container or a bucket. Production: AWS S3 / GCS via the same
// API. Backend chosen automatically by NODE_ENV (production = S3, anything
// else = local FS).
//
// Pre-signed URLs used for S3 uploads + playback (CloudFront cookies in prod).
// Local backend uses same-origin /api/uploads/local/<fileId> URLs so the
// browser can PUT without CORS / DNS / signature concerns.

import { promises as fs, createReadStream, type ReadStream } from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

// ─── Local-FS backend ──────────────────────────────────────────────────────
// Toggle: anything other than NODE_ENV=production stays on local FS so
// nobody needs MinIO running to work on uploads. Production deploys never
// hit this branch because NODE_ENV is forced to 'production' by `next start`.
export function isLocalStorageBackend(): boolean {
  return process.env.NODE_ENV !== 'production';
}

const LOCAL_UPLOADS_ROOT = path.resolve(process.cwd(), '.local-uploads');

/** Absolute on-disk path for a local-backed upload. fileId is opaque so this
 *  is path-traversal-safe without a sanitiser. */
export function localUploadPath(fileId: string): string {
  return path.join(LOCAL_UPLOADS_ROOT, fileId);
}

export async function ensureLocalUploadsDir(): Promise<void> {
  await fs.mkdir(LOCAL_UPLOADS_ROOT, { recursive: true });
}

export async function writeLocalUpload(fileId: string, bytes: Buffer | Uint8Array): Promise<void> {
  await ensureLocalUploadsDir();
  await fs.writeFile(localUploadPath(fileId), bytes);
}

export async function readLocalUpload(fileId: string): Promise<ReadStream> {
  return createReadStream(localUploadPath(fileId));
}

export async function localUploadExists(fileId: string): Promise<boolean> {
  try {
    await fs.access(localUploadPath(fileId));
    return true;
  } catch {
    return false;
  }
}

export async function deleteLocalUpload(fileId: string): Promise<void> {
  try {
    await fs.unlink(localUploadPath(fileId));
  } catch {
    /* ignore missing */
  }
}

const globalForS3 = globalThis as unknown as { s3?: S3Client; s3public?: S3Client };

// Server-side client — uses the internal Docker hostname (e.g. http://minio:9000).
// Never put presigned URLs from this client in responses the browser will use directly.
export const s3 =
  globalForS3.s3 ??
  new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: true,          // required for MinIO
    // @aws-sdk/client-s3 v3.729+ adds CRC32 flexible-checksum headers by
    // default, which MinIO rejects with "NotImplemented". Only send checksums
    // when the operation actually requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

// Browser-facing client — signs presigned URLs against the PUBLIC endpoint
// (e.g. https://s3.vaidix.lvpei.org) so browsers can actually reach the URL.
// Defaults to the internal client when S3_PUBLIC_ENDPOINT is not set (local dev).
const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
export const s3public =
  globalForS3.s3public ??
  new S3Client({
    endpoint: publicEndpoint,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

if (process.env.NODE_ENV !== 'production') {
  globalForS3.s3 = s3;
  globalForS3.s3public = s3public;
}

export const BUCKET = env.S3_BUCKET;

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
  // Allow browsers to PUT via presigned URLs from any origin.
  // Without this, MinIO/S3 blocks the CORS preflight and the chat
  // attachment upload fails with "Failed to fetch".
  //
  // Best-effort: older MinIO builds don't implement PutBucketCors and return
  // "NotImplemented" (501). That only affects browser→MinIO presigned uploads;
  // the server-proxied upload path (POST /api/documents/upload) does not need
  // bucket CORS at all. So swallow the unsupported-op error rather than letting
  // it 500 the whole upload.
  try {
    await s3.send(new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: {
        CORSRules: [{
          AllowedHeaders: ['*'],
          AllowedMethods: ['PUT', 'GET', 'HEAD'],
          AllowedOrigins: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        }],
      },
    }));
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    // Unsupported by this object store (e.g. MinIO) — non-fatal.
    if (name !== 'NotImplemented' && !/not implemented/i.test(String((err as Error)?.message))) {
      console.warn('[storage] PutBucketCors failed (non-fatal):', name || err);
    }
  }
}

export async function presignUpload(
  key: string,
  contentType: string,
  ttlSeconds = 900
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  // Use the public client so the signed URL hostname is reachable by browsers.
  return getSignedUrl(s3public, cmd, { expiresIn: ttlSeconds });
}

export async function presignDownload(key: string, ttlSeconds = 900): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  // Use the public client so the download URL is reachable by browsers.
  return getSignedUrl(s3public, cmd, { expiresIn: ttlSeconds });
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}
