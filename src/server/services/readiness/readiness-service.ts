// ════════════════════════════════════════════════════════════════════════════
// Readiness Service — W6.8 (Feeddback #5, Readiness Predictor)
// ════════════════════════════════════════════════════════════════════════════
// Faculty / PD see a per-learner readiness panel for an upcoming session.
// We compute a deterministic 0–100 score per learner from prep signals:
//
//   Pre-readings viewed   ×  W_READINGS  (capped at 100% of available)
//   Pre-videos watched    ×  W_VIDEOS
//   Pre-cases completed   ×  W_PRE_CASES
//   Pre-questions submitted (count, capped) × W_PRE_QUESTIONS
//   Prior-30d session attendance ratio × W_ATTENDANCE
//
// Tier bands:
//   ≥ 70  → READY
//   40–69 → AT_RISK
//   <  40 → UNDERPREPARED
//
// Why deterministic + not ML:
//   - Auditable — faculty can ask "why is Arjun underprepared?" and the answer
//     is always one of the input rows
//   - Testable — exact-value assertions in e2e tests
//   - Tunable — weights are constants, no retraining loop
//   - Codex-defensible — no model artifacts, no eval drift
//
// When weights need to change, edit the WEIGHTS object below + bump
// VERSION_TAG so cohort comparisons across sessions can detect the boundary.

import { db } from '@/lib/db';
import {
  Role,
  EngagementSignalKind,
  SessionStatus,
} from '@prisma/client';
import {
  userIsHostOrPrivileged,
  listSessionLearners,
} from '@/server/services/sessions/visibility';
import {
  aggregateLearnerStudyPack,
} from '@/server/services/study-pack/study-pack-service';
import {
  aggregateLearnerPreCases,
} from '@/server/services/study-pack/pre-case-service';

export const VERSION_TAG = 'readiness-v1';

export class ReadinessAccessError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID',
    message: string
  ) {
    super(message);
  }
}

export interface ReadinessActor {
  userId: string;
  role: Role;
}

const WEIGHTS = {
  READINGS: 25,
  VIDEOS: 25,
  PRE_CASES: 30,
  PRE_QUESTIONS: 10,
  ATTENDANCE: 10,
} as const;

/** A pre-question count is "saturating": after the 3rd one, more doesn't help. */
const PRE_QUESTION_CAP = 3;
/** How far back we look for prior-attendance signal (30 days). */
const ATTENDANCE_WINDOW_MS = 30 * 24 * 3600 * 1000;

export type ReadinessTier = 'READY' | 'AT_RISK' | 'UNDERPREPARED';

function tierFor(score: number): ReadinessTier {
  if (score >= 70) return 'READY';
  if (score >= 40) return 'AT_RISK';
  return 'UNDERPREPARED';
}

export interface ReadinessLearner {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  preReadings: { count: number; total: number };
  preVideos: { count: number; total: number };
  preCases: { count: number; total: number };
  preQuestionsSubmitted: number;
  priorAttendance30d: { joined: number; scheduled: number };
  readinessScore: number;
  tier: ReadinessTier;
  lastSignalAt: string | null;
}

export interface ReadinessSnapshot {
  sessionId: string;
  computedAt: string;
  versionTag: string;
  weights: typeof WEIGHTS;
  cohortStats: {
    totalLearners: number;
    ready: number;
    atRisk: number;
    underprepared: number;
    averageScore: number;
  };
  perLearner: ReadinessLearner[];
}

export async function computeSessionReadiness(
  actor: ReadinessActor,
  sessionId: string
): Promise<ReadinessSnapshot> {
  if (!(await userIsHostOrPrivileged(actor, sessionId))) {
    throw new ReadinessAccessError(
      'FORBIDDEN',
      'Only host / PD / admin can view readiness'
    );
  }
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, scheduledStart: true },
  });
  if (!session) throw new ReadinessAccessError('NOT_FOUND', 'Session not found');

  const learners = await listSessionLearners(sessionId);
  const computedAt = new Date();
  if (learners.length === 0) {
    return {
      sessionId,
      computedAt: computedAt.toISOString(),
      versionTag: VERSION_TAG,
      weights: WEIGHTS,
      cohortStats: {
        totalLearners: 0,
        ready: 0,
        atRisk: 0,
        underprepared: 0,
        averageScore: 0,
      },
      perLearner: [],
    };
  }

  // Pull totals (total readings/videos/preCases attached to the session) once.
  const [allLinks, allPreCases] = await Promise.all([
    db.documentSessionLink.findMany({
      where: { sessionId, isPreSession: true, document: { deletedAt: null } },
      select: { id: true, document: { select: { kind: true } } },
    }),
    db.sessionPreCase.findMany({ where: { sessionId }, select: { id: true } }),
  ]);
  const totalVideos = allLinks.filter((l) => l.document.kind === 'VIDEO').length;
  const totalReadings = allLinks.length - totalVideos;
  const totalPreCases = allPreCases.length;

  const learnerIds = learners.map((l) => l.id);
  const [studyPackByUser, preCaseByUser, preQuestions, attendanceRows, lastSignals] =
    await Promise.all([
      aggregateLearnerStudyPack(sessionId, learnerIds),
      aggregateLearnerPreCases(sessionId, learnerIds),
      db.preSessionQuestion.groupBy({
        by: ['userId'],
        where: { sessionId, userId: { in: learnerIds } },
        _count: { _all: true },
      }),
      // Prior-30d attendance: sessions whose scheduledStart is in the window
      // and whose status is LIVE or ENDED (i.e., actually happened).
      db.sessionParticipant.findMany({
        where: {
          userId: { in: learnerIds },
          session: {
            status: { in: [SessionStatus.LIVE, SessionStatus.ENDED] },
            scheduledStart: { gte: new Date(Date.now() - ATTENDANCE_WINDOW_MS) },
          },
        },
        select: { userId: true, joinedAt: true, sessionId: true },
      }),
      // Last engagement signal per learner — used so the UI can show "active 12m ago".
      db.engagementSignal.groupBy({
        by: ['userId'],
        where: {
          userId: { in: learnerIds },
          kind: {
            in: [
              EngagementSignalKind.PRE_READING_VIEWED,
              EngagementSignalKind.PRE_VIDEO_WATCHED,
              EngagementSignalKind.PRE_CASE_STARTED,
              EngagementSignalKind.PRE_CASE_COMPLETED,
            ],
          },
          sessionId,
        },
        _max: { createdAt: true },
      }),
    ]);

  // For prior attendance: build "scheduled count" = sessions the learner was
  // a participant in (so the denominator is meaningful for residents who
  // simply weren't expected to attend many sessions in the window).
  const attendanceByUser = new Map<string, { joined: number; scheduled: number }>();
  for (const id of learnerIds) attendanceByUser.set(id, { joined: 0, scheduled: 0 });
  for (const r of attendanceRows) {
    const slot = attendanceByUser.get(r.userId);
    if (!slot) continue;
    slot.scheduled += 1;
    if (r.joinedAt) slot.joined += 1;
  }

  const preQuestionByUser = new Map<string, number>();
  for (const r of preQuestions) preQuestionByUser.set(r.userId, r._count._all);
  const lastSignalByUser = new Map<string, Date>();
  for (const r of lastSignals) {
    if (r._max.createdAt) lastSignalByUser.set(r.userId, r._max.createdAt);
  }

  const perLearner: ReadinessLearner[] = learners.map((l) => {
    const sp = studyPackByUser.get(l.id) ?? { readings: 0, videos: 0, preCaseStarts: 0 };
    const pc = preCaseByUser.get(l.id) ?? { assigned: totalPreCases, completed: 0 };
    const att = attendanceByUser.get(l.id) ?? { joined: 0, scheduled: 0 };
    const pq = preQuestionByUser.get(l.id) ?? 0;
    const last = lastSignalByUser.get(l.id) ?? null;

    const readingsRatio = totalReadings === 0 ? 1 : Math.min(1, sp.readings / totalReadings);
    const videosRatio = totalVideos === 0 ? 1 : Math.min(1, sp.videos / totalVideos);
    const preCaseRatio = totalPreCases === 0 ? 1 : Math.min(1, pc.completed / totalPreCases);
    const preQuestionRatio = Math.min(1, pq / PRE_QUESTION_CAP);
    // Attendance: full credit when there's no prior data to rely on (new resident).
    const attendanceRatio =
      att.scheduled === 0 ? 1 : Math.min(1, att.joined / att.scheduled);

    const score = Math.round(
      readingsRatio * WEIGHTS.READINGS +
        videosRatio * WEIGHTS.VIDEOS +
        preCaseRatio * WEIGHTS.PRE_CASES +
        preQuestionRatio * WEIGHTS.PRE_QUESTIONS +
        attendanceRatio * WEIGHTS.ATTENDANCE
    );
    const clamped = Math.max(0, Math.min(100, score));

    return {
      userId: l.id,
      name: l.name,
      email: l.email,
      avatarUrl: l.avatarUrl,
      preReadings: { count: sp.readings, total: totalReadings },
      preVideos: { count: sp.videos, total: totalVideos },
      preCases: { count: pc.completed, total: totalPreCases },
      preQuestionsSubmitted: pq,
      priorAttendance30d: att,
      readinessScore: clamped,
      tier: tierFor(clamped),
      lastSignalAt: last ? last.toISOString() : null,
    };
  });

  // Sort by tier ascending (UNDERPREPARED first) so the panel highlights at-risk.
  const tierOrder: Record<ReadinessTier, number> = { UNDERPREPARED: 0, AT_RISK: 1, READY: 2 };
  perLearner.sort((a, b) => {
    const t = tierOrder[a.tier] - tierOrder[b.tier];
    if (t !== 0) return t;
    if (a.readinessScore !== b.readinessScore) return a.readinessScore - b.readinessScore;
    return a.name.localeCompare(b.name);
  });

  const ready = perLearner.filter((p) => p.tier === 'READY').length;
  const atRisk = perLearner.filter((p) => p.tier === 'AT_RISK').length;
  const underprepared = perLearner.filter((p) => p.tier === 'UNDERPREPARED').length;
  const averageScore =
    perLearner.length === 0
      ? 0
      : Math.round(
          perLearner.reduce((s, p) => s + p.readinessScore, 0) / perLearner.length
        );

  return {
    sessionId,
    computedAt: computedAt.toISOString(),
    versionTag: VERSION_TAG,
    weights: WEIGHTS,
    cohortStats: {
      totalLearners: perLearner.length,
      ready,
      atRisk,
      underprepared,
      averageScore,
    },
    perLearner,
  };
}
