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
import { presignUpload, isLocalStorageBackend } from '@/lib/storage';
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

    // Content-addressed id (16 hex). The stored avatarUrl is ALWAYS the stable,
    // same-origin proxy `/api/avatar/<id>.<ext>` — backend-agnostic, so it never
    // breaks across local FS / MinIO / AWS S3 (public or private). The bytes are
    // resolved at view-time by GET /api/avatar/[file].
    const fileId = `${mintToken(8)}.${ext}`;
    const avatarUrl = `/api/avatar/${fileId}`;

    // The UPLOAD target still depends on the backend:
    //   • local FS  → same-origin PUT the dev app serves (no MinIO/S3 running).
    //   • S3/MinIO  → presigned PUT straight to the `avatars/` prefix.
    if (isLocalStorageBackend()) {
      return jsonOk({ uploadUrl: `/api/uploads/local-avatar/${fileId}`, avatarUrl });
    }

    const uploadUrl = await presignUpload(`avatars/${fileId}`, body.data.contentType);
    return jsonOk({ uploadUrl, avatarUrl });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export function GET() {
  return jsonError('METHOD_NOT_ALLOWED', 'Use POST', 405);
}
