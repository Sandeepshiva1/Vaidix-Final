// ════════════════════════════════════════════════════════════════════════════
// Self-service avatar — the signed-in user's OWN profile photo
// ════════════════════════════════════════════════════════════════════════════
// POST   /api/me/avatar   — upload (or replace) raw image bytes, persist to the
//                           User row, return the new stable avatarUrl.
// DELETE /api/me/avatar   — remove the photo (avatarUrl → null).
//
// Unlike POST /api/admin/avatar (ADMIN-gated, presign + deferred PATCH), this is
// a single atomic call any authenticated user may make for THEMSELVES: the bytes
// are written and `User.avatarUrl` is committed in one request, so there's no
// half-applied state to cancel. The client sends the raw file as the request
// body with the image Content-Type (no multipart needed for a single file).
//
// The stored avatarUrl is ALWAYS the backend-agnostic same-origin proxy
// `/api/avatar/<16hex>.<ext>` — identical to the admin flow, so the existing
// GET /api/avatar/[file] proxy and the workflow-shell header render it unchanged
// across local-FS (dev) and S3 (prod) backends.

import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  jsonOk,
  jsonError,
  requireAuth,
  requireCsrf,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { mintToken } from '@/server/services/tokens';
import {
  s3,
  BUCKET,
  isLocalStorageBackend,
  writeLocalUpload,
  deleteLocalUpload,
  deleteObject,
} from '@/lib/storage';
import { db } from '@/lib/db';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors /api/admin/avatar

// The proxy stores `/api/avatar/<16 hex>.<ext>`. Parse a stored avatarUrl back
// to its on-disk / S3 identifiers so we can clean up the previous image when a
// new one replaces it. Returns null for externally-shaped or legacy URLs, which
// we then simply leave in place.
function parseAvatarUrl(url: string | null): { id: string; ext: string } | null {
  if (!url) return null;
  const m = /^\/api\/avatar\/([0-9a-f]{16})\.(jpg|png|webp)$/.exec(url);
  return m ? { id: m[1], ext: m[2] } : null;
}

// Best-effort removal of the bytes behind a previous avatar. Never throws —
// a stale orphan object is harmless next to a successful profile update.
async function deletePreviousAvatar(url: string | null): Promise<void> {
  const prev = parseAvatarUrl(url);
  if (!prev) return;
  try {
    if (isLocalStorageBackend()) {
      await deleteLocalUpload(`avatar-${prev.id}.${prev.ext}`);
    } else {
      await deleteObject(`avatars/${prev.id}.${prev.ext}`);
    }
  } catch (err) {
    console.warn('[me/avatar] previous avatar cleanup failed (non-fatal):', err);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;

    const contentType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_TYPES[contentType];
    if (!ext) {
      return jsonError('UNSUPPORTED_TYPE', 'Unsupported image type. Use JPEG, PNG, or WebP.', 415);
    }

    // Reject obviously-oversized uploads before buffering, when the header is
    // present. The post-read length check below is the authoritative guard.
    const declared = Number(req.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return jsonError('PAYLOAD_TOO_LARGE', 'Image must be 5 MB or smaller.', 413);
    }

    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.byteLength === 0) {
      return jsonError('BAD_REQUEST', 'Empty image body.', 400);
    }
    if (bytes.byteLength > MAX_BYTES) {
      return jsonError('PAYLOAD_TOO_LARGE', 'Image must be 5 MB or smaller.', 413);
    }

    // Content-addressed id (16 hex) — a fresh random id per upload so the
    // immutable browser cache on /api/avatar never serves stale bytes.
    const fileId = `${mintToken(8)}.${ext}`;
    const avatarUrl = `/api/avatar/${fileId}`;

    if (isLocalStorageBackend()) {
      await writeLocalUpload(`avatar-${fileId}`, bytes);
    } else {
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: `avatars/${fileId}`,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    }

    const prev = await db.user.findUnique({
      where: { id: gate.user.id },
      select: { avatarUrl: true },
    });

    await db.user.update({
      where: { id: gate.user.id },
      data: { avatarUrl },
    });

    // Only after the row is committed do we drop the old bytes, so a failed
    // update never strands the user without any avatar.
    await deletePreviousAvatar(prev?.avatarUrl ?? null);

    return jsonOk({ avatarUrl });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const csrf = await requireCsrf(req);
    if (!csrf.ok) return csrf.response;

    const prev = await db.user.findUnique({
      where: { id: gate.user.id },
      select: { avatarUrl: true },
    });

    await db.user.update({
      where: { id: gate.user.id },
      data: { avatarUrl: null },
    });

    await deletePreviousAvatar(prev?.avatarUrl ?? null);

    return jsonOk({ avatarUrl: null });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export function GET() {
  return jsonError('METHOD_NOT_ALLOWED', 'Use POST or DELETE', 405);
}
