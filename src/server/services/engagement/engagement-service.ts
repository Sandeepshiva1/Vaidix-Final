// ════════════════════════════════════════════════════════════════════════════
// Engagement Service — W4 Stream D foundation
// ════════════════════════════════════════════════════════════════════════════
// Producers (Stream A live hooks, Stream D leaderboards, W2 chat/hand-raise):
//   recordEngagementSignal({ sessionId, userId, kind, value?, metadata? })
//
// Consumers:
//   - Presenter alerts (this file): periodic evaluator computes alert thresholds
//   - Readiness predictor (W11): aggregates per-learner signals
//
// Anyone can write a signal; reads (aggregates) are presenter-only.

import { db } from '@/lib/db';
import {
  EngagementSignalKind,
  PresenterAlertKind,
  PresenterAlertSeverity,
  Role,
} from '@prisma/client';

export interface RecordSignalInput {
  sessionId: string;
  userId: string;
  kind: EngagementSignalKind;
  value?: number;
  metadata?: Record<string, unknown>;
}

export async function recordEngagementSignal(input: RecordSignalInput): Promise<void> {
  await db.engagementSignal.create({
    data: {
      sessionId: input.sessionId,
      userId: input.userId,
      kind: input.kind,
      value: input.value ?? null,
      metadata: input.metadata as object | undefined,
    },
  });
}

export interface SessionEngagementAggregate {
  sessionId: string;
  windowStart: string;
  windowEnd: string;
  participants: number;
  recentChat: number;
  recentHooks: number;
  recentHookResponses: number;
  recentHandRaises: number;
  attentionDropEvents: number;
  /** Crude engagement score 0–100 — UI shows traffic-light from this */
  engagementScore: number;
}

export async function aggregateSessionEngagement(
  sessionId: string,
  windowMinutes = 5
): Promise<SessionEngagementAggregate> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000);
  const windowEnd = new Date();

  const [participants, recent] = await Promise.all([
    db.sessionParticipant.count({ where: { sessionId, leftAt: null } }),
    db.engagementSignal.groupBy({
      by: ['kind'],
      where: { sessionId, createdAt: { gte: windowStart } },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<EngagementSignalKind, number>();
  for (const r of recent) counts.set(r.kind, r._count._all);

  const recentChat = counts.get(EngagementSignalKind.CHAT_MESSAGE) ?? 0;
  const recentHooks = counts.get(EngagementSignalKind.HOOK_RESPONSE) ?? 0;
  const recentHookResponses = recentHooks; // alias for clarity
  const recentHandRaises = counts.get(EngagementSignalKind.HAND_RAISE) ?? 0;
  const attentionDropEvents = counts.get(EngagementSignalKind.ATTENTION_DROP) ?? 0;

  const interactions = recentChat + recentHooks + recentHandRaises;
  // Per-participant interaction rate over the window — capped at 100.
  const interactionRate = participants === 0 ? 0 : (interactions / participants) * 25;
  const penalty = Math.min(40, attentionDropEvents * 5);
  const engagementScore = Math.max(0, Math.min(100, Math.round(interactionRate - penalty + 50)));

  return {
    sessionId,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    participants,
    recentChat,
    recentHooks,
    recentHookResponses,
    recentHandRaises,
    attentionDropEvents,
    engagementScore,
  };
}

export async function evaluatePresenterAlerts(sessionId: string): Promise<{
  alertsCreated: number;
}> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, status: true, actualStart: true },
  });
  if (!session || session.status !== 'LIVE') return { alertsCreated: 0 };

  const agg = await aggregateSessionEngagement(sessionId, 5);
  const alerts: { kind: PresenterAlertKind; severity: PresenterAlertSeverity; message: string }[] = [];
  const sessionAgeMs = session.actualStart ? Date.now() - session.actualStart.getTime() : 0;

  if (agg.engagementScore < 30) {
    alerts.push({
      kind: PresenterAlertKind.ENGAGEMENT_LOW,
      severity: PresenterAlertSeverity.WARN,
      message: `Engagement low: score ${agg.engagementScore}/100 in last 5 min. Consider a hook or break.`,
    });
  }
  if (agg.attentionDropEvents >= 3) {
    alerts.push({
      kind: PresenterAlertKind.ATTENTION_DROPPING,
      severity: PresenterAlertSeverity.WARN,
      message: `${agg.attentionDropEvents} attention-drop signals in last 5 min — try a poll or T/F prompt.`,
    });
  }
  // ASK_QUESTION: fires only when a real discussion dropped off.
  // Requires >1 participant (host alone doesn't count), current 5-min silence,
  // AND at least one interaction recorded in the 5–30 min window before the
  // silence started (so post-session lingerers and never-started lectures don't trigger it).
  if (agg.participants > 1 && agg.recentChat === 0 && agg.recentHooks === 0 && agg.recentHandRaises === 0) {
    const priorWindowStart = new Date(Date.now() - 30 * 60_000);
    const priorWindowEnd   = new Date(Date.now() -  5 * 60_000);
    const hadPriorDiscussion = await db.engagementSignal.count({
      where: {
        sessionId,
        kind: { in: [EngagementSignalKind.HOOK_RESPONSE, EngagementSignalKind.HAND_RAISE, EngagementSignalKind.CHAT_MESSAGE] },
        createdAt: { gte: priorWindowStart, lt: priorWindowEnd },
      },
    });
    if (hadPriorDiscussion > 0) {
      alerts.push({
        kind: PresenterAlertKind.ASK_QUESTION,
        severity: PresenterAlertSeverity.INFO,
        message: 'Discussion has gone quiet in the last 5 min. Ask a question to re-engage.',
      });
    }
  }

  // TOO_MUCH_LECTURE — W8.2: no interactive signals in 15 min, session > 20 min old.
  if (agg.participants > 0 && sessionAgeMs > 20 * 60_000) {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60_000);
    const recentInteractive = await db.engagementSignal.count({
      where: {
        sessionId,
        kind: {
          in: [
            EngagementSignalKind.HOOK_RESPONSE,
            EngagementSignalKind.HAND_RAISE,
            EngagementSignalKind.CHAT_MESSAGE,
          ],
        },
        createdAt: { gte: fifteenMinsAgo },
      },
    });
    if (recentInteractive === 0) {
      alerts.push({
        kind: PresenterAlertKind.TOO_MUCH_LECTURE,
        severity: PresenterAlertSeverity.WARN,
        message: 'No participant interaction in 15 min — consider a break or a quick question.',
      });
    }
  }

  // SILENT_PARTICIPANTS — W8.2: hook response rate < 25% over last 30 min (≥2 hooks, ≥5 participants).
  if (agg.participants >= 5) {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60_000);
    const [firedCount, responseCount] = await Promise.all([
      db.liveHook.count({ where: { sessionId, firedAt: { gte: thirtyMinsAgo } } }),
      db.liveHookResponse.count({
        where: { hook: { sessionId }, createdAt: { gte: thirtyMinsAgo } },
      }),
    ]);
    if (firedCount >= 2) {
      const responseRate = responseCount / (firedCount * agg.participants);
      if (responseRate < 0.25) {
        const silentEstimate = Math.round(agg.participants * (1 - responseRate));
        alerts.push({
          kind: PresenterAlertKind.SILENT_PARTICIPANTS,
          severity: PresenterAlertSeverity.WARN,
          message: `~${silentEstimate} of ${agg.participants} participants haven't responded to recent hooks. Prompt them individually.`,
        });
      }
    }
  }

  // Suppress duplicates: if same kind exists unacknowledged and was created in last 4 min, skip.
  const since = new Date(Date.now() - 4 * 60_000);
  const recentAlerts = await db.presenterAlert.findMany({
    where: { sessionId, acknowledgedAt: null, createdAt: { gte: since } },
    select: { kind: true },
  });
  const existingKinds = new Set(recentAlerts.map((a) => a.kind));

  let created = 0;
  for (const a of alerts) {
    if (existingKinds.has(a.kind)) continue;
    await db.presenterAlert.create({
      data: {
        sessionId,
        presenterId: session.hostId,
        kind: a.kind,
        severity: a.severity,
        message: a.message,
        metadata: { engagementScore: agg.engagementScore } as object,
      },
    });
    created++;
  }
  return { alertsCreated: created };
}

export async function listUnreadPresenterAlerts(
  sessionId: string,
  presenterId: string,
  actorRole: Role
): Promise<Array<{
  id: string;
  kind: PresenterAlertKind;
  severity: PresenterAlertSeverity;
  message: string;
  createdAt: string;
}>> {
  // Only the host (or admin/PD) sees presenter alerts.
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true },
  });
  if (!session) return [];
  if (session.hostId !== presenterId && actorRole !== Role.ADMIN && actorRole !== Role.PROGRAM_DIRECTOR) {
    return [];
  }
  const rows = await db.presenterAlert.findMany({
    where: { sessionId, acknowledgedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function acknowledgePresenterAlert(alertId: string, presenterId: string): Promise<void> {
  await db.presenterAlert.updateMany({
    where: { id: alertId, presenterId, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
}
