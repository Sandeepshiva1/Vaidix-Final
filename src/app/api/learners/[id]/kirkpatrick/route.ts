// /api/learners/[id]/kirkpatrick — Stream D #11
// Kirkpatrick L1–L4 evaluations.
// POST: faculty/PD records an L1 (reaction survey) entry, OR auto-derives L2.
// GET: returns the current rolling L1–L4 picture.

import { z } from 'zod';
import { db } from '@/lib/db';
import { KirkpatrickLevel, Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const VIEWER_ROLES_FOR_OTHERS: Role[] = [Role.ADMIN, Role.PROGRAM_DIRECTOR, Role.FACULTY];

const submitSchema = z.object({
  level: z.nativeEnum(KirkpatrickLevel),
  sessionId: z.string().optional(),
  score: z.number().min(0).max(100),
  surveyData: z.record(z.string(), z.unknown()).optional(),
  evidence: z
    .array(
      z.object({
        evidenceType: z.enum(['SCORING_EVENT', 'DOPS', 'MINI_CEX', 'EPA', 'SURVEY', 'QUIZ']),
        evidenceId: z.string().min(1),
        weight: z.number().min(0).max(10).optional(),
      })
    )
    .max(20)
    .optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const body = await parseBody(req, submitSchema);
  if (!body.ok) return body.response;
  const { id: learnerId } = await ctx.params;

  // Self-survey allowed for L1 only. L2/L3/L4 require faculty/PD/admin.
  const isSelf = learnerId === auth.user.id;
  if (!isSelf && !VIEWER_ROLES_FOR_OTHERS.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Cannot record evaluation for another user', 403);
  }
  if (isSelf && body.data.level !== KirkpatrickLevel.L1_REACTION) {
    return jsonError('FORBIDDEN', 'Learners can only submit L1 reaction surveys themselves', 403);
  }

  const rl = await checkRateLimit({ bucket: `kp-write:${auth.user.id}`, ...LIMITS.KIRKPATRICK_WRITE });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Too many evaluations', 429, { resetAt: rl.resetAt.toISOString() });
  }

  try {
    const evaluation = await db.kirkpatrickEvaluation.create({
      data: {
        userId: learnerId,
        level: body.data.level,
        sessionId: body.data.sessionId ?? null,
        score: body.data.score,
        surveyData: (body.data.surveyData as object | undefined) ?? undefined,
        metadata: { recordedBy: auth.user.id, recordedAt: new Date().toISOString() } as object,
        evidence: body.data.evidence?.length
          ? {
              create: body.data.evidence.map((e) => ({
                evidenceType: e.evidenceType,
                evidenceId: e.evidenceId,
                weight: e.weight ?? 1.0,
              })),
            }
          : undefined,
      },
      select: { id: true, level: true, score: true, createdAt: true },
    });
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.KIRKPATRICK_RECORDED,
      entityType: 'KirkpatrickEvaluation',
      entityId: evaluation.id,
      summary: `Kirkpatrick ${evaluation.level} recorded for ${learnerId}`,
      details: { learnerId, level: evaluation.level, score: Number(evaluation.score) },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ evaluation }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id: learnerId } = await ctx.params;

  if (learnerId !== auth.user.id && !VIEWER_ROLES_FOR_OTHERS.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Cannot view another learner', 403);
  }

  try {
    const evals = await db.kirkpatrickEvaluation.findMany({
      where: { userId: learnerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { evidence: { select: { evidenceType: true, evidenceId: true, weight: true } } },
    });

    // Roll up: latest per level + 12-month trailing average per level.
    const byLevel = new Map<KirkpatrickLevel, { latest: typeof evals[number] | null; sum: number; count: number }>();
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 3600_000);
    for (const lvl of Object.values(KirkpatrickLevel)) {
      byLevel.set(lvl as KirkpatrickLevel, { latest: null, sum: 0, count: 0 });
    }
    for (const e of evals) {
      const slot = byLevel.get(e.level)!;
      if (!slot.latest) slot.latest = e;
      if (e.createdAt >= oneYearAgo) {
        slot.sum += Number(e.score);
        slot.count += 1;
      }
    }

    const summary = Array.from(byLevel.entries()).map(([level, s]) => ({
      level,
      latestScore: s.latest ? Number(s.latest.score) : null,
      latestAt: s.latest ? s.latest.createdAt.toISOString() : null,
      sessionId: s.latest?.sessionId ?? null,
      trailingAvg12mo: s.count ? Number((s.sum / s.count).toFixed(2)) : null,
      sampleSize12mo: s.count,
    }));

    return jsonOk({
      learnerId,
      summary,
      recent: evals.slice(0, 20).map((e) => ({
        id: e.id,
        level: e.level,
        score: Number(e.score),
        sessionId: e.sessionId,
        createdAt: e.createdAt.toISOString(),
        evidence: e.evidence,
      })),
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}
