// ════════════════════════════════════════════════════════════════════════════
// Local-FS upload backend — dev only
// ════════════════════════════════════════════════════════════════════════════
// PUT /api/uploads/local/[fileId]
//   Browser uploads bytes here when the storage backend is local FS instead of
//   S3 (NODE_ENV !== 'production'). The matching SessionFile row was created
//   by /api/classroom/sessions/[id]/files. Only the original uploader may PUT,
//   and only before finalize. Body is the raw file payload (Content-Type
//   echoes whatever the browser sent).
//
// GET /api/uploads/local/[fileId]
//   Streams the bytes back. Same auth gate as the parent session: any user
//   who can see the SessionFile can download it.
//
// Production NEVER hits these handlers — the files POST returns an S3
// presigned URL there. Guarded explicitly so a misconfigured deploy fails
// loudly instead of leaking writes onto the app server's disk.

import { Readable } from 'node:stream';
import { promises as fs, createReadStream } from 'node:fs';
import { jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import {
  isLocalStorageBackend,
  localUploadPath,
  writeLocalUpload,
  ensureLocalUploadsDir,
} from '@/lib/storage';

const MAX_BYTES = 50 * 1024 * 1024; // mirror the cap in /classroom/.../files

export async function PUT(req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  if (!isLocalStorageBackend()) {
    return jsonError('NOT_FOUND', 'Local upload backend is disabled in production', 404);
  }
  const gate = await requireAuth();
  if (!gate.ok) return gate.response;
  const { fileId } = await ctx.params;

  const row = await db.sessionFile.findUnique({
    where: { id: fileId },
    select: { id: true, sessionId: true, uploadedById: true, sizeBytes: true, sha256: true },
  });
  if (!row) return jsonError('NOT_FOUND', 'File not found', 404);
  if (row.uploadedById !== gate.user.id) {
    return jsonError('FORBIDDEN', 'Only the uploader may PUT this file', 403);
  }
  if (row.sha256) {
    // Once finalize has been called the file is immutable. Re-uploading
    // would silently let the uploader swap content under a "shared" pointer.
    return jsonError('CONFLICT', 'File already finalized', 409);
  }
  if (row.sizeBytes > MAX_BYTES) {
    return jsonError('PAYLOAD_TOO_LARGE', 'File exceeds 50 MB limit', 413);
  }

  if (!req.body) return jsonError('BAD_REQUEST', 'Empty body', 400);

  // Read the body into a buffer with a hard cap so an attacker can't fill
  // the disk by streaming forever. We accumulate chunks rather than piping
  // straight to disk because the reserved sizeBytes is authoritative and
  // the file is small enough that this is fine.
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = req.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        return jsonError('PAYLOAD_TOO_LARGE', 'Upload exceeds size cap', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  await ensureLocalUploadsDir();
  await writeLocalUpload(row.id, Buffer.concat(chunks));
  return jsonOk({ ok: true, bytesWritten: total });
}

export async function GET(_req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  if (!isLocalStorageBackend()) {
    return jsonError('NOT_FOUND', 'Local upload backend is disabled in production', 404);
  }
  const gate = await requireAuth();
  if (!gate.ok) return gate.response;
  const { fileId } = await ctx.params;

  const row = await db.sessionFile.findUnique({
    where: { id: fileId },
    select: { id: true, sessionId: true, name: true, mimeType: true, sizeBytes: true },
  });
  if (!row) return jsonError('NOT_FOUND', 'File not found', 404);

  const role = await getEffectiveSessionRole(row.sessionId, gate.user.id, gate.user.role);
  if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

  const diskPath = localUploadPath(row.id);
  try {
    await fs.access(diskPath);
  } catch {
    return jsonError('NOT_FOUND', 'File not yet uploaded', 404);
  }

  // Stream the file body back. Convert the Node Readable to a Web ReadableStream
  // so the Next.js Response can hand it to the runtime fetch implementation.
  const nodeStream = createReadStream(diskPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': row.mimeType || 'application/octet-stream',
      'Content-Length': String(row.sizeBytes),
      'Content-Disposition': `inline; filename="${encodeURIComponent(row.name)}"`,
      'Cache-Control': 'private, max-age=600',
    },
  });
}
