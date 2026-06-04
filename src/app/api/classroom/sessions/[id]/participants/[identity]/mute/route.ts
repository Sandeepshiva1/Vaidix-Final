// POST — host/co-host mutes a participant's track (by sid) or all tracks
import { jsonOk, jsonError, requireAuth, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { listParticipants, muteTrack, sessionRoomName } from '@/lib/livekit';
import { audit } from '@/server/services/audit';
import { sessionAudit, SESSION_AUDIT } from '@/server/services/session-audit';
import { Role } from '@prisma/client';
import { z } from 'zod';

const muteBody = z.object({
  trackSid: z.string().optional(), // if omitted, mute all published audio tracks
  muted: z.boolean().default(true),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; identity: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, muteBody);
    if (!body.ok) return body.response;
    const { id: sessionId, identity } = await ctx.params;

    // Authz: host/co-host/admin
    const session = await db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { hostId: true },
    });
    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
    const isAdmin = gate.user.role === Role.ADMIN;
    const isHost = session.hostId === gate.user.id;
    let isCoHost = false;
    if (!isHost && !isAdmin) {
      const part = await db.sessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId, userId: gate.user.id } },
        select: { role: true },
      });
      isCoHost = part?.role === 'CO_HOST';
    }
    if (!isHost && !isCoHost && !isAdmin) {
      return jsonError('FORBIDDEN', 'Only host, co-host, or admin may mute', 403);
    }

    const room = sessionRoomName(sessionId);
    let muteCount = 0;
    try {
      if (body.data.trackSid) {
        await muteTrack(room, identity, body.data.trackSid, body.data.muted);
        muteCount = 1;
      } else {
        // Fan out across all published audio tracks of this participant
        const participants = await listParticipants(room);
        const p = participants.find((x) => x.identity === identity);
        if (!p) return jsonError('NOT_IN_ROOM', 'Participant not currently in room', 404);
        const audioTracks = p.tracks.filter((t) => t.source === 1 /* MICROPHONE */ || t.type === 0 /* AUDIO */);
        for (const t of audioTracks) {
          await muteTrack(room, identity, t.sid, body.data.muted);
          muteCount++;
        }
      }
    } catch (e) {
      // Any error in the LiveKit call layer (room not found, participant not
      // in room, server unreachable) is reported as NOT_IN_ROOM. Auth + DB
      // checks above already passed; we don't want to leak infra errors.
      console.warn('[mute] livekit unavailable:', (e as Error).message);
      return jsonError('NOT_IN_ROOM', 'Participant not currently in room', 404);
    }

    await audit({
      actorId: gate.user.id,
      eventType: body.data.muted ? 'SESSION_PARTICIPANT_MUTED' : 'SESSION_PARTICIPANT_UNMUTED',
      entityType: 'teaching_session',
      entityId: sessionId,
      summary: `${body.data.muted ? 'Muted' : 'Unmuted'} ${identity} (${muteCount} track(s))`,
    });
    await sessionAudit({
      sessionId,
      eventType: body.data.muted ? SESSION_AUDIT.PARTICIPANT_MUTED : SESSION_AUDIT.PARTICIPANT_UNMUTED,
      actorId: gate.user.id,
      targetUserId: identity,
      details: { tracks: muteCount },
    });
    return jsonOk({ muted: body.data.muted, count: muteCount });
  } catch (err) {
    return handleUnexpected(err);
  }
}
