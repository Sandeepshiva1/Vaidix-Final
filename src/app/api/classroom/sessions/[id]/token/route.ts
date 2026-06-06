// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/token
// ════════════════════════════════════════════════════════════════════════════
// Mints a LiveKit JWT for the authenticated user. Role is derived server-side
// from SessionParticipant + User — NEVER trusted from the client.
//
// Returns one of:
//   { state: 'JOINED', token, url, role }       — user may join immediately
//   { state: 'WAITING', admissionId }           — request admission, poll
//   { state: 'DENIED', reason }                 — admission previously denied
//
// Share-token query param bypasses visibility into the waiting-room path.

import { z } from 'zod';
import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { getEffectiveSessionRole, verifyShareToken } from '@/server/services/session-service';
import { requestAdmission, getAdmissionStatus } from '@/server/services/admission-service';
import { mintLiveKitToken, sessionRoomName } from '@/lib/livekit';
import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { AdmissionStatus } from '@prisma/client';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { user } = gate;

    const { id: sessionId } = await ctx.params;

    let shareToken: string | null = null;
    try {
      const raw = await req.text();
      if (raw) {
        const bodySchema = z.object({ shareToken: z.string().max(128).optional() });
        const parsed = bodySchema.safeParse(JSON.parse(raw));
        if (parsed.success) shareToken = parsed.data.shareToken ?? null;
      }
    } catch {
      // Malformed or empty body — treat as no shareToken.
    }

    // DB-authoritative display name. Auth.js's session.user.name can be
    // stale on legacy JWTs, but the User table always carries a non-null
    // `name` (column is NOT NULL in the schema). Fall back to email-prefix
    // as a last defence; the LiveKit JWT then carries this as the `name`
    // claim so peers see the registered Vaidix name.
    // avatarUrl is read here so the LiveKit metadata carries it through to
    // every other participant — that's what `participant-avatar-circle.tsx`
    // reads to render a real photo when the user's camera is off. If
    // `User.avatarUrl` is null (no upload yet) the component falls back to
    // deterministic initials.
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { name: true, email: true, avatarUrl: true },
    });
    const displayName =
      (dbUser?.name ?? '').trim() ||
      (user.name ?? '').trim() ||
      (dbUser?.email ?? user.email ?? '').split('@')[0];

    const session = await db.teachingSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        status: true,
        approvalStatus: true,
        maxParticipants: true,
        isWebinar: true,
      },
    });
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
    if (session.approvalStatus !== 'APPROVED') {
      return jsonError('NOT_APPROVED', 'Session is not approved', 409);
    }

    // If previously denied, surface that instead of looping
    const existingAdm = await getAdmissionStatus(sessionId, user.id);
    if (existingAdm?.status === AdmissionStatus.DENIED) {
      return jsonOk({ state: 'DENIED', reason: existingAdm.denyReason });
    }

    const effectiveRole = await getEffectiveSessionRole(sessionId, user.id, user.role);

    if (!effectiveRole || effectiveRole === 'VIEWER') {
      // Not visible to this user under visibility rules.
      // Two ways in: (a) valid share token → queue in waiting room; (b) nothing → 403
      if (effectiveRole === 'VIEWER') {
        // Admin/Proposer auditing — skip admission, mint viewer token.
        // Carry avatarUrl too so the auditor's tile shows their photo.
        const token = await mintLiveKitToken({
          identity: user.id,
          name: displayName,
          roomName: sessionRoomName(sessionId),
          role: 'viewer',
          metadata: { avatarUrl: dbUser?.avatarUrl ?? null },
        });
        return jsonOk({ state: 'JOINED', token, url: env.LIVEKIT_URL, role: 'VIEWER' });
      }

      if (!shareToken) {
        return jsonError('NO_ACCESS', 'You are not permitted to join this session', 403);
      }
      const valid = await verifyShareToken(sessionId, shareToken);
      if (!valid) {
        return jsonError('SHARE_TOKEN_INVALID', 'Share link is invalid or expired', 410);
      }
      const adm = await requestAdmission({
        sessionId,
        userId: user.id,
        displayName,
      });
      return jsonOk({ state: 'WAITING', admissionId: adm.id });
    }

    // Webinar mode: only HOST/CO_HOST get publish privileges; everyone else
    // is demoted to VIEWER regardless of their effectiveRole. This is the
    // attendee/presenter split — we don't want a webinar registrant
    // accidentally turning their camera on or chat-spamming via the
    // PARTICIPANT capability set. The classroom UI already strips publish
    // controls when role==='VIEWER'; this is the server-side enforcement.
    const isPresenter = effectiveRole === 'HOST' || effectiveRole === 'CO_HOST';
    const tokenRole = session.isWebinar && !isPresenter ? 'VIEWER' : effectiveRole;

    const lkRole =
      tokenRole === 'HOST' ? 'host'
      : tokenRole === 'CO_HOST' ? 'co_host'
      : tokenRole === 'VIEWER' ? 'viewer'
      : 'participant';

    const token = await mintLiveKitToken({
      identity: user.id,
      name: user.name,
      roomName: sessionRoomName(sessionId),
      role: lkRole,
      metadata: {
        effectiveRole: tokenRole,
        userRole: user.role,
        isWebinarAttendee: session.isWebinar && !isPresenter,
        // Forwarded through the JWT → ParticipantTile metadata so the
        // avatar overlay can render the user's real photo. Null (no upload)
        // is fine — component degrades to initials.
        avatarUrl: dbUser?.avatarUrl ?? null,
      },
    });

    return jsonOk({ state: 'JOINED', token, url: env.LIVEKIT_URL, role: tokenRole });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'WAITING_ROOM_FULL') {
      return jsonError('WAITING_ROOM_FULL', 'Waiting room is full, try again later', 429);
    }
    return handleUnexpected(err);
  }
}
