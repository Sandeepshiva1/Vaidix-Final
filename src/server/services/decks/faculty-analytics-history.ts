// ════════════════════════════════════════════════════════════════════════════
// Faculty Analytics History — Phase 1D
// ════════════════════════════════════════════════════════════════════════════
// Aggregates a faculty's *own* engagement signals from sessions they've
// hosted in the recent past, and emits a compact text block the wizard
// forge service appends to the Opus draft-prompt as system-level context.
//
// The point: AI suggestions on the new deck cite the faculty's own data
//   instead of generic advice. e.g. "Slide 4 is dense. Your last 3 lectures
//   showed slides >180 words had a 38% attention drop — recommend split."
//
// Scope per memory (project_vaidix_deck_redesign.md):
//   - Faculty's own EngagementSignal data only
//   - NOT Kirkpatrick, NOT cohort-level, NOT readiness (too noisy for v1)
//   - Faculty with no recent sessions → returns null (skip the prompt block)

import { db } from '@/lib/db';
import { EngagementSignalKind } from '@prisma/client';

const LOOKBACK_DAYS = 90;
const MIN_SESSIONS_FOR_SIGNAL = 1;

// Engagement signal kinds that indicate *negative* moments — attention loss,
// silence on interactions. Used to flag "your past data shows X hurts your room".
const NEGATIVE_KINDS: EngagementSignalKind[] = [
  EngagementSignalKind.ATTENTION_DROP,
  EngagementSignalKind.INTERACTION_SILENCE,
];

// Positive engagement — votes, hands, chat. Indicates rooms that engaged well.
const POSITIVE_KINDS: EngagementSignalKind[] = [
  EngagementSignalKind.POLL_VOTE,
  EngagementSignalKind.HOOK_RESPONSE,
  EngagementSignalKind.HAND_RAISE,
  EngagementSignalKind.CHAT_MESSAGE,
  EngagementSignalKind.PARTICIPATION,
];

// Pre-session engagement — was reading completed? case started? Used to
// give the AI context on whether faculty's residents tend to come prepared.
const PREWORK_KINDS: EngagementSignalKind[] = [
  EngagementSignalKind.PRE_READING_VIEWED,
  EngagementSignalKind.PRE_VIDEO_WATCHED,
  EngagementSignalKind.PRE_CASE_STARTED,
  EngagementSignalKind.PRE_CASE_COMPLETED,
];

export interface FacultyHistorySummary {
  sessionsHosted: number;
  totalLearnerSignals: number;
  negativeSignals: number;
  positiveSignals: number;
  preworkSignals: number;
  /** 0..1 — fraction of negative vs (positive + negative). null if no signals. */
  negativeRatio: number | null;
  /** Plain-text block to append to the AI prompt. Empty when no history. */
  promptContext: string;
}

/**
 * Build a compact analytics summary for the given faculty.
 *
 * Returns null when faculty has hosted fewer than MIN_SESSIONS_FOR_SIGNAL
 * sessions in the LOOKBACK_DAYS window — no point emitting a prompt block
 * full of zeros for a new instructor.
 *
 * The returned `promptContext` is meant to be appended verbatim to the
 * Opus draft system prompt, before "Author the deck JSON now."
 */
export async function getFacultyHistoryContext(
  facultyId: string,
): Promise<FacultyHistorySummary | null> {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  // Sessions this faculty has hosted in the lookback window. We use hostId
  // (not proposedBy / approvedBy) — the AI is interested in *teaching*
  // patterns, which means actual lectures delivered.
  const sessions = await db.teachingSession.findMany({
    where: {
      hostId: facultyId,
      scheduledStart: { gte: since },
      deletedAt: null,
    },
    select: { id: true, title: true, scheduledStart: true },
  });

  if (sessions.length < MIN_SESSIONS_FOR_SIGNAL) return null;

  const sessionIds = sessions.map((s) => s.id);

  // Bulk count signal kinds across those sessions, grouped by kind. One query
  // instead of N — cheap even for faculty with 100+ sessions.
  const grouped = await db.engagementSignal.groupBy({
    by: ['kind'],
    where: { sessionId: { in: sessionIds } },
    _count: { _all: true },
  });

  const byKind: Partial<Record<EngagementSignalKind, number>> = {};
  for (const row of grouped) byKind[row.kind] = row._count._all;

  const negativeSignals = NEGATIVE_KINDS.reduce((sum, k) => sum + (byKind[k] ?? 0), 0);
  const positiveSignals = POSITIVE_KINDS.reduce((sum, k) => sum + (byKind[k] ?? 0), 0);
  const preworkSignals = PREWORK_KINDS.reduce((sum, k) => sum + (byKind[k] ?? 0), 0);
  const totalLearnerSignals = grouped.reduce((sum, r) => sum + r._count._all, 0);

  const denom = negativeSignals + positiveSignals;
  const negativeRatio = denom > 0 ? negativeSignals / denom : null;

  // Build the prompt block. Keep it tight — Opus tokens cost real money.
  const lines: string[] = [];
  lines.push(
    `FACULTY HISTORY (this faculty's own data, last ${LOOKBACK_DAYS} days, ${sessions.length} session${sessions.length === 1 ? '' : 's'} hosted):`,
  );

  if (negativeRatio !== null) {
    const pct = Math.round(negativeRatio * 100);
    if (negativeRatio > 0.4) {
      lines.push(
        `  - ATTENTION-RISK FACULTY: ${pct}% of engagement events were negative (attention drops, silence on interactions). Recommend interactions earlier, shorter dense blocks, more visual variety.`,
      );
    } else if (negativeRatio > 0.2) {
      lines.push(
        `  - Moderate attention risk: ${pct}% of events negative. Watch density on dense-content slides; suggest an early poll/case prompt.`,
      );
    } else {
      lines.push(
        `  - Engagement healthy: only ${pct}% of events negative. Faculty can push depth without losing the room.`,
      );
    }
  }

  if (preworkSignals === 0 && totalLearnerSignals > 0) {
    lines.push(
      `  - Pre-session prep is WEAK: no pre-reading / pre-case completion events recorded. Open the deck with anchor concepts, don't assume residents have read ahead.`,
    );
  } else if (preworkSignals > 0) {
    lines.push(
      `  - Pre-session prep observed (${preworkSignals} prep events). Faculty can reference prework rather than re-teaching basics.`,
    );
  }

  lines.push(
    `Use this in your initialSuggestions: when flagging density / pedagogy issues, where possible CITE the faculty's own pattern (e.g. "Your last sessions showed attention drops on dense slides — split this one").`,
  );

  const promptContext = lines.join('\n');

  return {
    sessionsHosted: sessions.length,
    totalLearnerSignals,
    negativeSignals,
    positiveSignals,
    preworkSignals,
    negativeRatio,
    promptContext,
  };
}
