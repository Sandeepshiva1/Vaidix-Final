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
  type S3ClientConfig,
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

// One config that serves BOTH backends, selected by S3_FORCE_PATH_STYLE:
//   • AWS S3 (default)     → virtual-host style + SDK default integrity checksums;
//                            endpoint=undefined → SDK targets regional S3 endpoint.
//   • MinIO / S3-compat    → path-style URLs + relaxed checksums (local dev only).
function s3Config(endpoint: string | undefined): S3ClientConfig {
  const pathStyle = env.S3_FORCE_PATH_STYLE;
  return {
    endpoint,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: pathStyle,
    // @aws-sdk/client-s3 v3.729+ adds CRC32 flexible-checksum headers by
    // default, which MinIO rejects with "NotImplemented". Send them only when
    // required for MinIO; AWS S3 keeps the SDK default (integrity on).
    ...(pathStyle
      ? {
          requestChecksumCalculation: 'WHEN_REQUIRED' as const,
          responseChecksumValidation: 'WHEN_REQUIRED' as const,
        }
      : {}),
  };
}

// Server-side client — uses internal endpoint or the regional AWS S3 default.
// Never put presigned URLs from this client in responses the browser will use.
export const s3 = globalForS3.s3 ?? new S3Client(s3Config(env.S3_ENDPOINT));

// Browser-facing client — signs presigned URLs against the public endpoint so
// browsers can reach them. For AWS S3 both endpoints are undefined, so it signs
// against AWS S3 directly (virtual-host URLs). Defaults to the internal endpoint
// when S3_PUBLIC_ENDPOINT is unset.
const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
export const s3public = globalForS3.s3public ?? new S3Client(s3Config(publicEndpoint));

if (process.env.NODE_ENV !== 'production') {
  globalForS3.s3 = s3;
  globalForS3.s3public = s3public;
}

// Uploads bucket: documents, avatars, promo assets, DSR exports.
export const BUCKET = env.S3_BUCKET;
// Recordings bucket: raw MP4s, HLS segments, audio, captions, rendered clips.
export const RECORDINGS_BUCKET = env.S3_RECORDINGS_BUCKET;

async function applyBucketCors(bucket: string): Promise<void> {
  try {
    await s3.send(new PutBucketCorsCommand({
      Bucket: bucket,
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
    if (name !== 'NotImplemented' && !/not implemented/i.test(String((err as Error)?.message))) {
      console.warn('[storage] PutBucketCors failed (non-fatal):', name || err);
    }
  }
}

export async function ensureBucket(): Promise<void> {
  for (const bucket of [BUCKET, RECORDINGS_BUCKET]) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    await applyBucketCors(bucket);
  }
}

export async function presignUpload(
  key: string,
  contentType: string,
  ttlSeconds = 900,
  bucket = BUCKET
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3public, cmd, { expiresIn: ttlSeconds });
}

export async function presignDownload(key: string, ttlSeconds = 900, bucket = BUCKET): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3public, cmd, { expiresIn: ttlSeconds });
}

export async function deleteObject(key: string, bucket = BUCKET): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function objectExists(key: string, bucket = BUCKET): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}
