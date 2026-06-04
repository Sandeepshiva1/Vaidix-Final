// ════════════════════════════════════════════════════════════════════════════
// /api/classroom/sessions/[id]/guest — anonymous guest join (Teams parity)
// ════════════════════════════════════════════════════════════════════════════
// This endpoint is the ONLY part of the classroom surface that bypasses
// requireAuth(). It is reachable only when:
//
//   - TeachingSession.openToAll = true, AND
//   - TeachingSession.approvalStatus = APPROVED
//
// Identity comes from an HttpOnly cookie ("vdx_guest_<sessionId>") whose
// value is a 32-byte cryptographic random key. The same key is stored in
// SessionAdmission.guestKey so the server can correlate "this browser →
// this waiting-room entry" without ever touching the User table.
//
// POST { name: string }
//   Creates (or refreshes) the SessionAdmission row in PENDING and sets the
//   guest cookie. Idempotent — re-POSTing from the same cookie reuses the
//   same admission. Returns { state: 'WAITING', admissionId }.
//
// GET (no body)
//   Reads the cookie, looks up the admission, returns one of:
//     { state: 'WAITING', admissionId }
//     { state: 'JOINED',  token, url, role: 'PARTICIPANT' }
//     { state: 'DENIED',  reason }
//     { state: 'UNKNOWN' }   ← no cookie / cookie's key not on file
//
// The "OPEN_NOT_PERMITTED" 403 surfaces sessions that exist but aren't
// openToAll — the page does the same check and redirects to /login, but
// this guards the API path so a stale cookie can't reach a closed session.
//
// SECURITY NOTES
//   - Guest LiveKit identity is `guest_<admissionId>` so it can never
//     collide with a real user.id (which uses cuid()).
//   - PARTICIPANT role at the LiveKit layer mirrors the answered design
//     decision; no admin grants for guests.
//   - Display names are trimmed + length-limited (1..80) to keep the
//     waiting-room list readable and prevent CSS-breaking inputs.

import { z } from 'zod';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { jsonOk, jsonError, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { requestAdmission, getGuestAdmissionStatus } from '@/server/services/admission-service';
import { mintLiveKitToken, sessionRoomName } from '@/lib/livekit';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { AdmissionStatus } from '@prisma/client';

const guestCookieName = (sessionId: string) => `vdx_guest_${sessionId}`;

const PostBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
});

async function loadOpenSession(sessionId: string) {
  return db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      openToAll: true,
      approvalStatus: true,
      isWebinar: true,
    },
  });
}

// ── POST: register a guest, set cookie, request admission ─────────────────
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await ctx.params;
    const parsed = await parseBody(req, PostBody);
    if (!parsed.ok) return parsed.response;
    const { name } = parsed.data;

    const session = await loadOpenSession(sessionId);
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
    if (!session.openToAll) {
      return jsonError(
        'OPEN_NOT_PERMITTED',
        'This session does not allow anonymous guests. Please sign in to join.',
        403,
      );
    }
    if (session.approvalStatus !== 'APPROVED') {
      return jsonError('NOT_APPROVED', 'Session is not approved', 409);
    }

    const cookieStore = await cookies();
    const cookieName = guestCookieName(sessionId);
    let guestKey = cookieStore.get(cookieName)?.value;
    if (!guestKey || guestKey.length < 32) {
      guestKey = randomBytes(24).toString('base64url');
      // 6h matches the longest realistic session block; long enough that
      // a guest can be admitted late, short enough that a stale cookie
      // can't resurface days later.
      cookieStore.set(cookieName, guestKey, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: `/`,
        maxAge: 60 * 60 * 6,
      });
    }

    const adm = await requestAdmission({ sessionId, guestKey, displayName: name });
    return jsonOk({ state: 'WAITING', admissionId: adm.id });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'WAITING_ROOM_FULL') {
      return jsonError('WAITING_ROOM_FULL', 'Waiting room is full, try again later', 429);
    }
    return handleUnexpected(err);
  }
}

// ── GET: poll status, mint LiveKit token if admitted ──────────────────────
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await ctx.params;
    const session = await loadOpenSession(sessionId);
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
    if (!session.openToAll) {
      return jsonError(
        'OPEN_NOT_PERMITTED',
        'This session does not allow anonymous guests. Please sign in to join.',
        403,
      );
    }

    const cookieStore = await cookies();
    const guestKey = cookieStore.get(guestCookieName(sessionId))?.value;
    if (!guestKey) return jsonOk({ state: 'UNKNOWN' });

    const adm = await getGuestAdmissionStatus(sessionId, guestKey);
    if (!adm) return jsonOk({ state: 'UNKNOWN' });

    if (adm.status === AdmissionStatus.DENIED) {
      return jsonOk({ state: 'DENIED', reason: adm.denyReason ?? null });
    }
    if (adm.status === AdmissionStatus.PENDING) {
      return jsonOk({ state: 'WAITING', admissionId: adm.id });
    }
    if (adm.status === AdmissionStatus.ADMITTED) {
      // Guest webinar attendees are demoted to viewer (no publish) for the
      // same reason registered webinar attendees are — webinar mode is a
      // host-driven broadcast.
      const lkRole = session.isWebinar ? 'viewer' : 'participant';
      const token = await mintLiveKitToken({
        identity: `guest_${adm.id}`,
        name: adm.displayName ?? 'Guest',
        roomName: sessionRoomName(sessionId),
        role: lkRole,
        metadata: { isGuest: true, admissionId: adm.id },
      });
      return jsonOk({
        state: 'JOINED',
        token,
        url: env.LIVEKIT_URL,
        role: lkRole === 'viewer' ? 'VIEWER' : 'PARTICIPANT',
      });
    }

    return jsonOk({ state: 'UNKNOWN' });
  } catch (err) {
    return handleUnexpected(err);
  }
}
