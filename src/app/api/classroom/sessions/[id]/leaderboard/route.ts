// GET /api/classroom/sessions/[id]/leaderboard
// Returns ranked participants by points earned during the session.
// Points sources (in this order):
//   - LiveHookResponse.isCorrect=true → 10 pts each
//   - LiveHookResponse with response → 3 pts each (participation)
//   - EngagementSignal kind=CHAT_MESSAGE → 1 pt each (capped 20)
//   - EngagementSignal kind=HAND_RAISE  → 2 pts each (capped 10)
// Anonymous toggle (?anonymous=true) replaces user names with "Resident #N".

import { z } from 'zod';
import { db } from '@/lib/db';
import { handleUnexpected, jsonOk, parseQuery, requireAuth } from '@/server/services/api-helpers';
import { EngagementSignalKind, Role } from '@prisma/client';

const querySchema = z.object({
  anonymous: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const q = await parseQuery(req, querySchema);
  if (!q.ok) return q.response;
  const { id: sessionId } = await ctx.params;

  try {
    // Pull all relevant rows once; aggregate in memory (per-session volume is small).
    const [hookResponses, signals, participants] = await Promise.all([
      db.liveHookResponse.findMany({
        where: { hook: { sessionId } },
        select: { userId: true, isCorrect: true, response: true },
      }),
      db.engagementSignal.findMany({
        where: { sessionId, kind: { in: [EngagementSignalKind.CHAT_MESSAGE, EngagementSignalKind.HAND_RAISE] } },
        select: { userId: true, kind: true },
      }),
      db.sessionParticipant.findMany({
        where: { sessionId },
        select: { userId: true, user: { select: { id: true, name: true, role: true } } },
      }),
    ]);

    const points = new Map<string, { correct: number; participation: number; chats: number; raises: number }>();
    const ensure = (uid: string) => {
      let row = points.get(uid);
      if (!row) {
        row = { correct: 0, participation: 0, chats: 0, raises: 0 };
        points.set(uid, row);
      }
      return row;
    };

    for (const h of hookResponses) {
      const row = ensure(h.userId);
      row.participation += 1;
      if (h.isCorrect) row.correct += 1;
    }
    for (const s of signals) {
      const row = ensure(s.userId);
      if (s.kind === EngagementSignalKind.CHAT_MESSAGE) row.chats += 1;
      if (s.kind === EngagementSignalKind.HAND_RAISE) row.raises += 1;
    }

    const showAnonymous = q.data.anonymous;
    const userById = new Map(participants.map((p) => [p.userId, p.user]));

    const rows = Array.from(points.entries()).map(([uid, p]) => {
      const chatPts = Math.min(20, p.chats);
      const raisePts = Math.min(10, p.raises * 2);
      const total = p.correct * 10 + p.participation * 3 + chatPts + raisePts;
      const u = userById.get(uid);
      return {
        userId: uid,
        name: showAnonymous && u?.role === Role.RESIDENT ? null : u?.name ?? null,
        role: u?.role ?? null,
        points: total,
        breakdown: { correct: p.correct, participation: p.participation, chats: p.chats, raises: p.raises },
      };
    });
    rows.sort((a, b) => b.points - a.points);
    if (showAnonymous) {
      rows.forEach((r, idx) => {
        if (r.name === null) r.name = `Student #${idx + 1}`;
      });
    }

    return jsonOk({ leaderboard: rows, anonymous: showAnonymous ?? false });
  } catch (err) {
    return handleUnexpected(err);
  }
}
