// ════════════════════════════════════════════════════════════════════════════
// Share Playback Token — short-lived HMAC-signed handle for HLS proxy fetches
// ════════════════════════════════════════════════════════════════════════════
// The public share viewer authenticates *once* with token (+ optional password)
// via /api/recordings/share/[token]. After the password check passes we hand
// it a separate playback token that the HLS proxy accepts on each segment
// request. The original share token is the user-visible bearer credential and
// is also accepted directly for un-passworded shares (no password to gate
// behind), but for password-protected shares the playback token is what
// proves the password check actually happened.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))
//   payload = { s: shareId, e: expiresAtEpochSeconds }
// Signed with NEXTAUTH_SECRET so no separate key management.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

interface PlaybackTokenPayload {
  s: string;
  e: number;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payload: string): string {
  return b64urlEncode(createHmac('sha256', env.NEXTAUTH_SECRET).update(payload).digest());
}

export function mintSharePlaybackToken(shareId: string, expiresAt: Date): string {
  const payload: PlaybackTokenPayload = { s: shareId, e: Math.floor(expiresAt.getTime() / 1000) };
  const payloadStr = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  return `${payloadStr}.${sign(payloadStr)}`;
}

export function verifySharePlaybackToken(token: string): { shareId: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payloadStr);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload: PlaybackTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadStr).toString('utf8')) as PlaybackTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.s !== 'string' || typeof payload.e !== 'number') return null;
  if (payload.e * 1000 < Date.now()) return null;
  return { shareId: payload.s };
}
