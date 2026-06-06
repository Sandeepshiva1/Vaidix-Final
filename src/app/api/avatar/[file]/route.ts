// ════════════════════════════════════════════════════════════════════════════
// GET /api/avatar/[file]   —  backend-agnostic avatar proxy (PUBLIC)
// ════════════════════════════════════════════════════════════════════════════
// Single, stable, same-origin URL for every avatar regardless of where the
// bytes actually live (local FS in dev; MinIO or AWS S3 — public OR private — in
// prod). `User.avatarUrl` / `Invitation.avatarUrl` store `/api/avatar/<id>.<ext>`
// and the bytes are resolved HERE at view-time, the same way documents and
// recordings resolve at view-time. This is what stops avatars from re-breaking
// on every storage-backend change:
//   • local FS            → stream the file off disk
//   • MinIO / AWS public  → stream via the server-side S3 client
//   • AWS S3 PRIVATE      → also works: the server holds the credentials, so no
//                           public-read, no CORS, and no presigned-URL expiry.
//
// Access is capability-based: the id is an unguessable 16-hex token minted by
// POST /api/admin/avatar. GET is intentionally UNAUTHENTICATED so avatars keep
// rendering on the public webinar-registration, promo, and guest-prejoin pages
// — exactly matching the previous public-read behaviour.

import { Readable } from 'node:stream';
import { createReadStream, promises as fs } from 'node:fs';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  s3,
  BUCKET,
  isLocalStorageBackend,
  localUploadPath,
} from '@/lib/storage';

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// `<file>` must be exactly `<16 hex>.<jpg|png|webp>` as minted by the avatar
// presign route. Anything else is rejected so a crafted path can't escape the
// avatars/ prefix or fetch unrelated objects (documents, recordings, …).
function parseFile(file: string): { id: string; ext: string } | null {
  const m = /^([0-9a-f]{16})\.(jpg|png|webp)$/.exec(file);
  if (!m) return null;
  return { id: m[1], ext: m[2] };
}

// Avatars are content-addressed (a fresh random id per upload), so the bytes at
// a given URL never change → cache forever in the browser. `private` keeps it
// out of shared caches since these are people's photos.
const CACHE_CONTROL = 'private, max-age=31536000, immutable';

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const parsed = parseFile(file);
  if (!parsed) return new Response('Not found', { status: 404 });

  const contentType = EXT_MIME[parsed.ext] ?? 'application/octet-stream';

  // ─── Local-FS backend (dev) ───────────────────────────────────────────────
  // Mirrors the on-disk id minted by PUT /api/uploads/local-avatar/[fileId]
  // (`avatar-<id>.<ext>`).
  if (isLocalStorageBackend()) {
    const diskPath = localUploadPath(`avatar-${parsed.id}.${parsed.ext}`);
    try {
      await fs.access(diskPath);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const webStream = Readable.toWeb(createReadStream(diskPath)) as unknown as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      status: 200,
      headers: { 'content-type': contentType, 'cache-control': CACHE_CONTROL },
    });
  }

  // ─── Object store (MinIO / AWS S3, public or private) ─────────────────────
  const key = `avatars/${parsed.id}.${parsed.ext}`;
  let out;
  try {
    out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    if (name === 'NoSuchKey' || name === 'NotFound') return new Response('Not found', { status: 404 });
    console.error('[avatar-proxy] S3 GetObject failed', { key, err });
    return new Response('Storage error', { status: 502 });
  }

  const body = out.Body as Readable | undefined;
  if (!body) return new Response('Empty body', { status: 502 });

  const headers = new Headers();
  headers.set('content-type', out.ContentType || contentType);
  if (out.ContentLength != null) headers.set('content-length', String(out.ContentLength));
  headers.set('cache-control', CACHE_CONTROL);

  const webStream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
  return new Response(webStream, { status: 200, headers });
}
