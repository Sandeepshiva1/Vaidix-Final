// POST /api/classroom/sessions/[id]/files/[fileId]/finalize
//   Called by the client after the presigned PUT upload completes. Verifies
//   the S3 object exists, stores the client-computed sha256 (informational —
//   we don't trust it for integrity), and emits a FILE_SHARE replay beacon
//   into SessionAuditEvent.
//
// We deliberately keep finalize a separate call rather than fingerprinting
// in S3 lambdas: the file is "shared" the moment the uploader confirms,
// regardless of any post-upload virus scan.

import { z } from 'zod';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { objectExists, isLocalStorageBackend, localUploadExists } from '@/lib/storage';
import {
  computeTMs,
  SESSION_AUDIT,
  sessionAudit,
} from '@/server/services/session-audit';

const writeSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const body = await parseBody(req, writeSchema);
    if (!body.ok) return body.response;
    const { id: sessionId, fileId } = await ctx.params;

    const file = await db.sessionFile.findUnique({ where: { id: fileId } });
    if (!file || file.sessionId !== sessionId) {
      return jsonError('NOT_FOUND', 'File not found', 404);
    }
    if (file.uploadedById !== auth.user.id) {
      return jsonError('FORBIDDEN', 'Only the uploader can finalize', 403);
    }
    if (file.sha256) {
      // Idempotent: already finalised.
      return jsonOk({ file: { id: file.id, name: file.name, sha256: file.sha256 } });
    }

    // Local-FS dev backend looks up by fileId; S3 backend checks the s3Key.
    const exists = isLocalStorageBackend()
      ? await localUploadExists(file.id)
      : await objectExists(file.s3Key);
    if (!exists) {
      return jsonError('PRECONDITION_FAILED', 'Upload not visible in storage yet', 412);
    }

    const updated = await db.sessionFile.update({
      where: { id: fileId },
      data: { sha256: body.data.sha256.toLowerCase() },
    });

    const tMs = await computeTMs(sessionId);
    await sessionAudit({
      sessionId,
      eventType: SESSION_AUDIT.FILE_SHARE,
      actorId: auth.user.id,
      details: {
        fileId: updated.id,
        name: updated.name,
        mimeType: updated.mimeType,
        sizeBytes: updated.sizeBytes,
      },
      tMs,
    });

    return jsonOk({
      file: {
        id: updated.id,
        name: updated.name,
        sha256: updated.sha256,
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}
