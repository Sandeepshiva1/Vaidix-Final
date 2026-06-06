// ════════════════════════════════════════════════════════════════════════════
// POST /api/admin/avatar
// ════════════════════════════════════════════════════════════════════════════
// Generic avatar presign — used by both the invite modal (no user yet) and
// the edit-user modal (existing user). Returns a presigned PUT URL the client
// uses to upload directly to object storage, plus the URL the caller stores
// on the User row (or carries on the Invitation row until accept).
//
// Flow:
//   1) Client POSTs { contentType, sizeBytes } → receives { uploadUrl, avatarUrl }
//   2) Client PUTs the file bytes to uploadUrl
//   3) Client persists avatarUrl via:
//        - PATCH /api/admin/users/[id]      (existing user)
//        - POST  /api/invitations           (new invite — flows to User on accept)
//
// Key prefix is content-addressable (random 8-byte hex) so re-uploads don't
// collide with cached old versions.

import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  jsonOk,
  jsonError,
  requireRole,
  parseBody,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { presignUpload, BUCKET, isLocalStorageBackend } from '@/lib/storage';
import { env } from '@/lib/env';
import { mintToken } from '@/server/services/tokens';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const bodySchema = z.object({
  contentType: z.string().refine((t) => t in ALLOWED_TYPES, {
    message: 'Unsupported image type. Use JPEG, PNG, or WebP.',
  }),
  sizeBytes: z.number().int().positive().max(MAX_BYTES, 'Image must be 5 MB or smaller'),
});

export async function POST(req: Request) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;

    const ext = ALLOWED_TYPES[body.data.contentType];

    // Local-FS dev backend: no MinIO/S3 is running, so a presigned URL would
    // point at an unreachable host and the browser PUT fails with "Failed to
    // fetch". Hand back a same-origin URL the dev app can serve instead. The
    // same URL is used for both upload (PUT) and view (GET).
    if (isLocalStorageBackend()) {
      const localUrl = `/api/uploads/local-avatar/${mintToken(8)}.${ext}`;
      return jsonOk({ uploadUrl: localUrl, avatarUrl: localUrl });
    }

    const key = `avatars/${mintToken(8)}.${ext}`;

    const uploadUrl = await presignUpload(key, body.data.contentType);
    // Stable view URL pointed at the bucket. For MinIO / any custom endpoint we
    // use path-style (endpoint/bucket/key); for AWS S3 (no endpoint set) we use
    // virtual-host style (bucket.s3.<region>.amazonaws.com/key). Both assume
    // public-read (or CloudFront) on the avatars/ prefix.
    const viewBase = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
    const avatarUrl = viewBase
      ? `${viewBase.replace(/\/$/, '')}/${BUCKET}/${key}`
      : `https://${BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`;

    return jsonOk({ uploadUrl, avatarUrl });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export function GET() {
  return jsonError('METHOD_NOT_ALLOWED', 'Use POST', 405);
}
