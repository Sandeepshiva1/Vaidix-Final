// ════════════════════════════════════════════════════════════════════════════
// GET /api/recordings/[id]/hls/[...path]
// ════════════════════════════════════════════════════════════════════════════
// Authenticated HLS proxy. Streams master.m3u8, variant playlists, and .ts
// segments from MinIO/S3 through Next.js after enforcing the same access
// rules as the recording listing endpoint.
//
// Why a proxy and not a presigned URL: HLS players load the master playlist,
// then fetch variant playlists and segments using URLs that are RELATIVE to
// the master. Resolving a relative URL against a presigned master URL drops
// the signature query string, so MinIO/S3 returns 403 for every variant and
// segment. Production behind CloudFront would use signed cookies; this proxy
// is the dev/on-prem-MinIO equivalent and works in both deployments.
//
// Range requests are forwarded so the player can seek inside large segments.

import type { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { s3, BUCKET } from '@/lib/storage';
import { userCanViewSession } from '@/server/services/recordings/recording-service';
import { RecordingStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; path: string[] }> }
) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const { id, path } = await ctx.params;
  const subPath = path.join('/');
  // Reject absolute paths and parent-traversal — keys must stay inside the
  // recording's own hls/{sessionId}/ prefix.
  if (!subPath || subPath.startsWith('/') || subPath.split('/').some((seg) => seg === '..' || seg === '')) {
    return new Response('Bad path', { status: 400 });
  }

  const recording = await db.recording.findUnique({
    where: { id },
    select: { sessionId: true, hlsPath: true, status: true, expungedAt: true },
  });
  if (!recording || recording.expungedAt) return new Response('Not found', { status: 404 });
  // Same playable-status set as recording-service.ts: any status where the HLS
  // package is uploaded counts as playable. Transcription/AI may still be
  // running or have failed — that doesn't break video.
  const playable = new Set<RecordingStatus>([
    RecordingStatus.TRANSCRIBING,
    RecordingStatus.TRANSCRIBING_FAILED,
    RecordingStatus.AI_PROCESSING,
    RecordingStatus.AI_PROCESSING_FAILED,
    RecordingStatus.READY,
  ]);
  if (!recording.hlsPath || !playable.has(recording.status)) {
    return new Response('Not ready', { status: 409 });
  }

  const allowed = await userCanViewSession(
    { userId: session.user.id, role: session.user.role },
    recording.sessionId
  );
  if (!allowed) return new Response('Forbidden', { status: 403 });

  // hlsPath looks like "hls/{sessionId}/master.m3u8" — strip the filename
  // to get the prefix the player's relative URLs are joined against.
  const lastSlash = recording.hlsPath.lastIndexOf('/');
  const prefix = lastSlash >= 0 ? recording.hlsPath.slice(0, lastSlash) : '';
  const key = prefix ? `${prefix}/${subPath}` : subPath;

  const range = req.headers.get('range') ?? undefined;
  let out;
  try {
    out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range }));
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    if (name === 'NoSuchKey' || name === 'NotFound') return new Response('Not found', { status: 404 });
    console.error('[hls-proxy] S3 GetObject failed', { key, err });
    return new Response('Storage error', { status: 502 });
  }

  const body = out.Body as Readable | undefined;
  if (!body) return new Response('Empty body', { status: 502 });

  const headers = new Headers();
  if (out.ContentType) headers.set('content-type', out.ContentType);
  else if (subPath.endsWith('.m3u8')) headers.set('content-type', 'application/vnd.apple.mpegurl');
  else if (subPath.endsWith('.ts')) headers.set('content-type', 'video/mp2t');
  if (out.ContentLength != null) headers.set('content-length', String(out.ContentLength));
  if (out.ContentRange) headers.set('content-range', out.ContentRange);
  if (out.AcceptRanges) headers.set('accept-ranges', out.AcceptRanges);
  else headers.set('accept-ranges', 'bytes');
  // Playlists are tiny and need to reflect transcode/cleanup state quickly;
  // segments are immutable once written so they can be cached aggressively.
  headers.set(
    'cache-control',
    subPath.endsWith('.ts') ? 'private, max-age=86400, immutable' : 'private, no-store'
  );

  const webStream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
  const status = out.ContentRange ? 206 : 200;
  return new Response(webStream, { status, headers });
}
