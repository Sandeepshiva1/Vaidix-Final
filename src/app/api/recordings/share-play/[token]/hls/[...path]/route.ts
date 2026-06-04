// ════════════════════════════════════════════════════════════════════════════
// GET /api/recordings/share-play/[token]/hls/[...path]
// ════════════════════════════════════════════════════════════════════════════
// Public-share HLS proxy. The `token` here is the short-lived playback token
// minted by accessShare() AFTER the user supplied the correct password (if
// any). The token carries the shareId + expiry, signed with NEXTAUTH_SECRET,
// so we can validate without re-asking for the password on every segment.
// We still re-check the share's revoked/expired state on each request — token
// possession alone must not outlive a manual revoke.

import type { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@/lib/db';
import { s3, BUCKET } from '@/lib/storage';
import { verifySharePlaybackToken } from '@/server/services/recordings/share-playback-token';
import { RecordingStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; path: string[] }> }
) {
  const { token, path } = await ctx.params;

  const verified = verifySharePlaybackToken(token);
  if (!verified) return new Response('Invalid or expired playback token', { status: 401 });

  const subPath = path.join('/');
  if (!subPath || subPath.startsWith('/') || subPath.split('/').some((seg) => seg === '..' || seg === '')) {
    return new Response('Bad path', { status: 400 });
  }

  const share = await db.recordingShare.findUnique({
    where: { id: verified.shareId },
    select: {
      revokedAt: true,
      expiresAt: true,
      recording: {
        select: { hlsPath: true, status: true, expungedAt: true },
      },
    },
  });
  if (!share) return new Response('Not found', { status: 404 });
  if (share.revokedAt) return new Response('Share revoked', { status: 410 });
  if (share.expiresAt.getTime() < Date.now()) return new Response('Share expired', { status: 410 });
  if (!share.recording || share.recording.expungedAt) return new Response('Recording unavailable', { status: 404 });
  const playable = new Set<RecordingStatus>([
    RecordingStatus.TRANSCRIBING,
    RecordingStatus.TRANSCRIBING_FAILED,
    RecordingStatus.AI_PROCESSING,
    RecordingStatus.AI_PROCESSING_FAILED,
    RecordingStatus.READY,
  ]);
  if (!share.recording.hlsPath || !playable.has(share.recording.status)) {
    return new Response('Not ready', { status: 409 });
  }

  const lastSlash = share.recording.hlsPath.lastIndexOf('/');
  const prefix = lastSlash >= 0 ? share.recording.hlsPath.slice(0, lastSlash) : '';
  const key = prefix ? `${prefix}/${subPath}` : subPath;

  const range = req.headers.get('range') ?? undefined;
  let out;
  try {
    out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: range }));
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    if (name === 'NoSuchKey' || name === 'NotFound') return new Response('Not found', { status: 404 });
    console.error('[share-hls-proxy] S3 GetObject failed', { key, err });
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
  headers.set(
    'cache-control',
    subPath.endsWith('.ts') ? 'private, max-age=86400, immutable' : 'private, no-store'
  );

  const webStream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
  const status = out.ContentRange ? 206 : 200;
  return new Response(webStream, { status, headers });
}
