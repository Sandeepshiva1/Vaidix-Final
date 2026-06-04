// /api/learners/[id]/blooms-progression
// Aggregates the learner's case attempts bucketed by Case.difficultyLevel
// (1–6 maps to Bloom's). Each bucket reports attempted vs strong-score events.

import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { handleUnexpected, jsonError, jsonOk, requireAuth } from '@/server/services/api-helpers';
import { isUserInProgram } from '@/server/services/program-service';

const VIEWER_ROLES_FOR_OTHERS: Role[] = [Role.ADMIN, Role.PROGRAM_DIRECTOR, Role.FACULTY];

interface BloomsBucket {
  level: number;
  attempted: number;
  strong: number;
  recent7d: number;
  averageHead: number | null;
  averageHeart: number | null;
  averageHands: number | null;
}

const STRONG_THRESHOLD = 4; // 0–5 axis subscore, ≥4 = "strong"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: learnerId } = await ctx.params;

  if (learnerId !== auth.user.id && !VIEWER_ROLES_FOR_OTHERS.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Cannot view another learner', 403);
  }
  if (learnerId !== auth.user.id) {
    const sameProgram = auth.user.activeProgramId
      ? await isUserInProgram(learnerId, auth.user.activeProgramId)
      : false;
    if (!sameProgram) return jsonError('FORBIDDEN', 'Learner is not in your active program', 403);
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000);
    const events = await db.scoringEvent.findMany({
      where: { residentId: learnerId, voidedAt: null },
      select: {
        createdAt: true,
        headScore: true,
        heartScore: true,
        handsScore: true,
        case: { select: { difficultyLevel: true } },
      },
      take: 1000,
      orderBy: { createdAt: 'desc' },
    });

    const buckets = new Map<number, BloomsBucket>();
    for (let lvl = 1; lvl <= 6; lvl++) {
      buckets.set(lvl, {
        level: lvl,
        attempted: 0,
        strong: 0,
        recent7d: 0,
        averageHead: null,
        averageHeart: null,
        averageHands: null,
      });
    }
    const sums = new Map<number, { head: number; heart: number; hands: number; n: number }>();

    for (const e of events) {
      const lvl = Math.max(1, Math.min(6, e.case?.difficultyLevel ?? 3));
      const b = buckets.get(lvl)!;
      b.attempted += 1;
      const head = e.headScore ? Number(e.headScore) : 0;
      const heart = e.heartScore ? Number(e.heartScore) : 0;
      const hands = e.handsScore ? Number(e.handsScore) : 0;
      const minStrong = Math.min(head, heart, hands);
      if (minStrong >= STRONG_THRESHOLD) b.strong += 1;
      if (e.createdAt >= sevenDaysAgo) b.recent7d += 1;
      const s = sums.get(lvl) ?? { head: 0, heart: 0, hands: 0, n: 0 };
      s.head += head;
      s.heart += heart;
      s.hands += hands;
      s.n += 1;
      sums.set(lvl, s);
    }
    for (const [lvl, s] of sums) {
      const b = buckets.get(lvl)!;
      if (s.n > 0) {
        b.averageHead = Number((s.head / s.n).toFixed(2));
        b.averageHeart = Number((s.heart / s.n).toFixed(2));
        b.averageHands = Number((s.hands / s.n).toFixed(2));
      }
    }

    return jsonOk({
      learnerId,
      buckets: Array.from(buckets.values()),
      totalEvents: events.length,
      sourceNote:
        "Bloom's level is derived from Case.difficultyLevel (1–6). Strong = all three H aggregates ≥4/5.",
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}
