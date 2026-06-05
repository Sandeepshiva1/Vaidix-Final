// ════════════════════════════════════════════════════════════════════════════
// POST /api/classroom/sessions/[id]/mute-all
// ════════════════════════════════════════════════════════════════════════════
// Host / faculty-only. Server-mutes every OTHER participant's microphone track
// in the LiveKit room. Participants can re-unmute themselves (the prod LiveKit
// config sets room.enable_remote_unmute: true), matching standard "mute all"
// semantics. The dock "Mute all" button previously only greyed the host's own
// local UI — this makes the action real for the whole room.

import { Role } from '@prisma/client';
import { TrackSource } from 'livekit-server-sdk';
import { db } from '@/lib/db';
import { requireAuth, jsonError, jsonOk, handleUnexpected } from '@/server/services/api-helpers';
import { listParticipants, muteTrack, sessionRoomName } from '@/lib/livekit';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: sessionId } = await ctx.params;

  // Same gate as the live page (src/app/(platform)/session/[id]/live/page.tsx):
  // the session host, or any faculty-like role, may moderate the room.
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  if (!session) return jsonError('NOT_FOUND', 'Session not found', 404);
  const isHost = session.hostId === auth.user.id;
  if (!isHost && !FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Only the host or faculty can mute the room', 403);
  }

  try {
    const room = sessionRoomName(sessionId);

    // listParticipants throws if the room isn't active yet — that just means
    // there's no one to mute, so report success with a zero count.
    let participants;
    try {
      participants = await listParticipants(room);
    } catch {
      return jsonOk({ muted: 0, note: 'room not active' });
    }

    let muted = 0;
    for (const p of participants) {
      if (p.identity === auth.user.id) continue; // never mute the moderator
      for (const t of p.tracks) {
        if (t.source === TrackSource.MICROPHONE && !t.muted) {
          // Best-effort per track: one participant leaving mid-call shouldn't
          // abort muting the rest.
          await muteTrack(room, p.identity, t.sid, true).catch(() => {});
          muted++;
        }
      }
    }

    return jsonOk({ muted });
  } catch (err) {
    return handleUnexpected(err);
  }
}
