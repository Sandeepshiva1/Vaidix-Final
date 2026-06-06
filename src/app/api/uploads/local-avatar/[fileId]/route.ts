// ════════════════════════════════════════════════════════════════════════════
// Local-FS avatar backend — dev only
// ════════════════════════════════════════════════════════════════════════════
// PUT /api/uploads/local-avatar/[fileId]
//   Browser uploads avatar bytes here when the storage backend is local FS
//   instead of S3 (NODE_ENV !== 'production'). Unlike the session-file local
//   route this has no backing DB row — the avatar isn't committed anywhere
//   until the invite/edit form is saved — so the fileId is a self-describing
//   `<16-hex>.<ext>` token minted by POST /api/admin/avatar. PUT is admin-gated
//   to match who may presign; GET is open to any authenticated user because the
//   resulting URL is rendered in <img> tags across the app.
//
// Production NEVER hits these handlers — the avatar POST returns an S3
// presigned URL there. Guarded explicitly so a misconfigured deploy fails
// loudly instead of leaking writes onto the app server's disk.

import { Readable } from 'node:stream';
import { promises as fs, createReadStream } from 'node:fs';
import { Role } from '@prisma/client';
import { jsonError, jsonOk, requireAuth, requireRole } from '@/server/services/api-helpers';
import {
  isLocalStorageBackend,
  localUploadPath,
  writeLocalUpload,
  ensureLocalUploadsDir,
} from '@/lib/storage';

const MAX_BYTES = 5 * 1024 * 1024; // mirror the cap in /api/admin/avatar

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// fileId must be exactly `<16 hex>.<jpg|png|webp>` as minted by the avatar
// presign route. Reject anything else so a crafted id can't escape the uploads
// dir or collide with session-file storage. Returns the namespaced on-disk id
// and the ext, or null if malformed.
function parseFileId(fileId: string): { storageId: string; ext: string } | null {
  const m = /^([0-9a-f]{16})\.(jpg|png|webp)$/.exec(fileId);
  if (!m) return null;
  return { storageId: `avatar-${fileId}`, ext: m[2] };
}

export async function PUT(req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  if (!isLocalStorageBackend()) {
    return jsonError('NOT_FOUND', 'Local upload backend is disabled in production', 404);
  }
  const gate = await requireRole(Role.ADMIN);
  if (!gate.ok) return gate.response;

  const { fileId } = await ctx.params;
  const parsed = parseFileId(fileId);
  if (!parsed) return jsonError('BAD_REQUEST', 'Invalid avatar id', 400);

  if (!req.body) return jsonError('BAD_REQUEST', 'Empty body', 400);

  // Buffer with a hard cap so a runaway stream can't fill the dev disk.
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = req.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        return jsonError('PAYLOAD_TOO_LARGE', 'Image exceeds 5 MB limit', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  await ensureLocalUploadsDir();
  await writeLocalUpload(parsed.storageId, Buffer.concat(chunks));
  return jsonOk({ ok: true, bytesWritten: total });
}

export async function GET(_req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  if (!isLocalStorageBackend()) {
    return jsonError('NOT_FOUND', 'Local upload backend is disabled in production', 404);
  }
  const gate = await requireAuth();
  if (!gate.ok) return gate.response;

  const { fileId } = await ctx.params;
  const parsed = parseFileId(fileId);
  if (!parsed) return jsonError('BAD_REQUEST', 'Invalid avatar id', 400);

  const diskPath = localUploadPath(parsed.storageId);
  try {
    await fs.access(diskPath);
  } catch {
    return jsonError('NOT_FOUND', 'Avatar not yet uploaded', 404);
  }

  const nodeStream = createReadStream(diskPath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': EXT_MIME[parsed.ext] ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=600',
    },
  });
}
