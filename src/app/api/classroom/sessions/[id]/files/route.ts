// POST /api/classroom/sessions/[id]/files
//   Creates a SessionFile row in pending state and returns a presigned S3
//   PUT URL. The client uploads directly to S3 then calls
//   /files/[fileId]/finalize. Two-step instead of multipart-through-Next so
//   we don't proxy multi-MB blobs through the app server.
//
// GET /api/classroom/sessions/[id]/files
//   Lists session files (only those with sha256 set, i.e. fully uploaded)
//   for the chat scrollback / handout panel.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import { presignUpload, presignDownload, isLocalStorageBackend } from '@/lib/storage';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const writeSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024), // 50MB cap per file
});

// Mime-type allowlist — slides, docs, images, PDFs, archives. Block scripts
// and executables outright. The list deliberately excludes video/audio:
// recordings of the session live in the Recording pipeline; participants
// don't drop raw video into chat.
const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
  'text/markdown',
];

function mimeAllowed(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const body = await parseBody(req, writeSchema);
    if (!body.ok) return body.response;
    const { id: sessionId } = await ctx.params;

    if (!mimeAllowed(body.data.mimeType)) {
      return jsonError('UNSUPPORTED_MEDIA_TYPE', 'File type not allowed', 415);
    }

    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (!role || role === 'VIEWER') {
      return jsonError('FORBIDDEN', 'No upload permission', 403);
    }

    const rl = await checkRateLimit({
      bucket: `session-file:${auth.user.id}`,
      ...LIMITS.SESSION_FILE_UPLOAD,
    });
    if (!rl.allowed) {
      // Propagate `reason` and `degraded` so the client can distinguish a
      // genuine quota hit ("limit") from a Redis outage on a fail-closed bucket
      // ("redis_down_fail_closed"). Without this the UI shows the same
      // "try again in N min" copy for both cases, and a 5-second Redis-outage
      // reset gets misread as a real rate limit.
      return jsonError('RATE_LIMITED', 'Upload rate exceeded', 429, {
        resetAt: rl.resetAt.toISOString(),
        reason: rl.reason,
        degraded: rl.degraded,
      });
    }

    const safeName = body.data.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);

    // Two-phase create: insert with a placeholder s3Key, then update once we
    // know the row's id. Avoids depending on a non-prisma cuid generator.
    const placeholder = `pending/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const created = await db.sessionFile.create({
      data: {
        sessionId,
        uploadedById: auth.user.id,
        name: body.data.name,
        mimeType: body.data.mimeType,
        sizeBytes: body.data.sizeBytes,
        s3Key: placeholder,
      },
    });
    const finalKey = `session-files/${sessionId}/${created.id}/${safeName}`;
    const file = await db.sessionFile.update({
      where: { id: created.id },
      data: { s3Key: finalKey },
    });

    // Local-FS dev backend: bytes live in `.local-uploads/<fileId>` and the
    // browser PUTs to a same-origin URL. Production keeps the S3 presigned
    // URL flow so behaviour matches the existing CDN-backed deploys.
    const uploadUrl = isLocalStorageBackend()
      ? `/api/uploads/local/${file.id}`
      : await presignUpload(finalKey, body.data.mimeType, 900);
    return jsonOk({ file: { id: file.id, name: file.name }, uploadUrl }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const { id: sessionId } = await ctx.params;
    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

    const files = await db.sessionFile.findMany({
      where: { sessionId, sha256: { not: null } },
      orderBy: { createdAt: 'asc' },
      include: { uploadedBy: { select: { id: true, name: true, avatarUrl: true } } },
    });
    // Issue a short-lived download URL per file. Listing is generally infrequent
    // (loaded with chat scrollback once on join) so the cost is fine.
    const local = isLocalStorageBackend();
    const withUrls = await Promise.all(
      files.map(async (f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        uploadedBy: f.uploadedBy,
        createdAt: f.createdAt,
        downloadUrl: local ? `/api/uploads/local/${f.id}` : await presignDownload(f.s3Key, 3600),
      }))
    );
    return jsonOk({ files: withUrls });
  } catch (err) {
    return handleUnexpected(err);
  }
}
