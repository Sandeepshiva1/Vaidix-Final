// ════════════════════════════════════════════════════════════════════════════
// Stale-LIVE session sweeper — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// A session's `status` is set to LIVE on `room_started` (LiveKit webhook) or
// when a host joins, and is meant to flip to ENDED on `room_finished`. In dev
// (LiveKit not reachable) and in production edge cases (webhook URL down,
// LiveKit crash, host closing browser without an explicit "End"), the
// `room_finished` event never arrives and the session stays LIVE forever —
// where it shows up loud-and-red on the classroom feed indefinitely.
//
// This module is the structural fix:
//
//   • `isStaleLive(s, now)` — read-side predicate. Used to filter listings so
//     a stuck session never *displays* as live, even on the very first request
//     after the bug was triggered (before the sweeper has had a chance to run).
//
//   • `sweepStaleLiveSessions()` — write-side correction. Idempotent. Flips
//     status → ENDED, sets actualEnd to scheduledEnd (best estimate; we have
//     no better signal), and stamps any lingering open SessionParticipant
//     rows. Throttled to at most once per minute per process.
//
// We deliberately use *both* — read-side filter for correctness on the next
// page render, write-side sweep so analytics, recordings, calendar, and any
// other reader sees the corrected DB state eventually.

import { db } from '@/lib/db';
import { SessionStatus } from '@prisma/client';
import { audit } from '../audit';
import { sessionAudit, SESSION_AUDIT } from '../session-audit';
import { cancelSessionReminders } from '../reminder-scheduler';
import { notifySessionEnded } from '../session-notifications';

// A LIVE session whose scheduled end was more than this long ago is a sweep
// candidate. Generous enough that genuinely-overrunning sessions aren't cut
// off; tight enough that stuck sessions don't linger across a working day.
const STALE_LIVE_GRACE_MS = 30 * 60 * 1000;

// A SCHEDULED session whose scheduled end has passed by this much without
// ever transitioning to LIVE is treated as never-happened. Larger grace than
// LIVE because a session might be "scheduled to start any minute now" right
// up until the host actually clicks Start; we only want to act once it's
// clearly past the window.
const STALE_SCHEDULED_GRACE_MS = 60 * 60 * 1000;

// If anyone joined this recently, treat the session as still live regardless
// of clock — handles the "session ran 90 min over but is genuinely active"
// edge case.
const RECENT_ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

// Throttle the sweep so a burst of classroom page loads doesn't fan out into
// a burst of UPDATEs. One process, one run per minute, is plenty: the sweep
// is best-effort recovery for an edge-case bug, not a tight loop.
const SWEEP_MIN_INTERVAL_MS = 60 * 1000;

let lastSweepAt = 0;
let inflight: Promise<number> | null = null;

export interface StaleLiveCandidate {
  status: SessionStatus;
  scheduledEnd: Date;
  actualStart: Date | null;
}

/**
 * Pure predicate — "should this row be treated as ENDED for display
 * purposes, even though the DB still says LIVE?". Caller is expected to have
 * already filtered to `status === LIVE`; this answers whether that LIVE is
 * trustworthy.
 *
 * Note: this does NOT inspect participant activity (the caller in the
 * classroom listing doesn't fetch participants for cost reasons). The
 * write-side `sweepStaleLiveSessions` is the gate that *does* check
 * participants before mutating the DB. So a stale-but-still-active session
 * will hide briefly from the listing yet keep its DB status until the
 * sweeper confirms via participant data — at which point the read filter
 * becomes irrelevant.
 */
export function isStaleLive(s: StaleLiveCandidate, now: Date): boolean {
  if (s.status !== SessionStatus.LIVE) return false;
  return now.getTime() - s.scheduledEnd.getTime() > STALE_LIVE_GRACE_MS;
}

/**
 * Read-side predicate for SCHEDULED-but-never-started sessions. Mirror of
 * `isStaleLive` but for the "host never clicked Start" failure mode. A
 * SCHEDULED session whose scheduledEnd is well past should be projected as
 * ENDED so it falls into the past bucket instead of vanishing (it's not
 * upcoming because start < now, not past because status != ENDED).
 */
export function isStaleScheduled(s: StaleLiveCandidate, now: Date): boolean {
  if (s.status !== SessionStatus.SCHEDULED) return false;
  return now.getTime() - s.scheduledEnd.getTime() > STALE_SCHEDULED_GRACE_MS;
}

/**
 * Find LIVE sessions whose `scheduledEnd` is well past, confirm none of them
 * have recent participant activity, and flip them to ENDED.
 *
 * Returns the number of sessions actually swept. Safe to call concurrently:
 *   - module-local throttle deduplicates calls within 60s
 *   - in-flight promise is shared so concurrent callers await the same run
 *   - each session's mutation is idempotent (status=LIVE in the WHERE), so
 *     even if two processes race past the throttle, the second is a no-op.
 *
 * Never throws — failures are logged and audited so the sweep can be
 * triggered from request paths without a try/catch at every call site.
 */
export async function sweepStaleLiveSessions(): Promise<number> {
  const now = Date.now();
  if (inflight) return inflight;
  if (now - lastSweepAt < SWEEP_MIN_INTERVAL_MS) return 0;
  lastSweepAt = now;

  inflight = doSweep().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doSweep(): Promise<number> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_LIVE_GRACE_MS);
  const recentCutoff = new Date(now.getTime() - RECENT_ACTIVITY_WINDOW_MS);

  try {
    const candidates = await db.teachingSession.findMany({
      where: {
        status: SessionStatus.LIVE,
        deletedAt: null,
        scheduledEnd: { lt: staleCutoff },
      },
      select: {
        id: true,
        title: true,
        scheduledEnd: true,
        // A single recent join means someone is still active (or just joined).
        // We pull `take: 1` to keep this cheap on busy sessions.
        participants: {
          where: { joinedAt: { gt: recentCutoff } },
          select: { id: true },
          take: 1,
        },
      },
    });

    const toEnd = candidates.filter((c) => c.participants.length === 0);
    if (toEnd.length === 0) return 0;

    let ended = 0;
    for (const s of toEnd) {
      // Per-session transaction so one failure doesn't rollback the others.
      // The status=LIVE guard makes this idempotent against concurrent runs.
      try {
        const result = await db.$transaction(async (tx) => {
          const update = await tx.teachingSession.updateMany({
            where: { id: s.id, status: SessionStatus.LIVE },
            data: {
              status: SessionStatus.ENDED,
              // We don't know when the room actually died; scheduledEnd is the
              // most defensible guess and avoids inflating duration metrics
              // with the gap between room death and our sweep.
              actualEnd: s.scheduledEnd,
            },
          });
          if (update.count === 0) return false;

          await tx.sessionParticipant.updateMany({
            where: { sessionId: s.id, leftAt: null },
            data: { leftAt: s.scheduledEnd },
          });
          return true;
        });

        if (!result) continue;
        ended += 1;

        // Side effects outside the tx — best-effort, must not fail the sweep.
        // The stale-LIVE branch DOES notify (session genuinely ran, recording
        // is likely on the way); the stale-SCHEDULED branch below doesn't,
        // since the session never actually started.
        await Promise.allSettled([
          audit({
            actorId: null,
            eventType: 'SESSION_AUTO_ENDED',
            entityType: 'teaching_session',
            entityId: s.id,
            summary: `Auto-ended stale LIVE session "${s.title}"`,
            details: { reason: 'stale_live', scheduledEnd: s.scheduledEnd.toISOString() },
          }),
          sessionAudit({
            sessionId: s.id,
            eventType: SESSION_AUDIT.SESSION_ENDED,
            actorId: null,
            details: { reason: 'stale_live_sweep' },
          }),
          cancelSessionReminders(s.id),
          notifySessionEnded(s.id),
        ]);
      } catch (err) {
        console.error('[stale-live-sweep] failed to end session', s.id, err);
      }
    }

    if (ended > 0) {
      console.warn(`[stale-live-sweep] auto-ended ${ended} stale LIVE session(s)`);
    }
    return ended;
  } catch (err) {
    console.error('[stale-live-sweep] sweep failed:', err);
    return 0;
  }
}

let lastScheduledSweepAt = 0;
let inflightScheduled: Promise<number> | null = null;

/**
 * Find SCHEDULED sessions whose `scheduledEnd` is well past and flip them to
 * ENDED. Mirror of `sweepStaleLiveSessions` for the "host never started"
 * failure mode — without this, a forgotten/missed session sits in SCHEDULED
 * forever, invisible in both Upcoming (start < now) and Past (status != ENDED).
 *
 * actualStart is left null and actualEnd stamped as scheduledEnd, so anyone
 * computing "sessions that actually happened" can filter on `actualStart != null`.
 */
export async function sweepStaleScheduledSessions(): Promise<number> {
  const now = Date.now();
  if (inflightScheduled) return inflightScheduled;
  if (now - lastScheduledSweepAt < SWEEP_MIN_INTERVAL_MS) return 0;
  lastScheduledSweepAt = now;

  inflightScheduled = doScheduledSweep().finally(() => {
    inflightScheduled = null;
  });
  return inflightScheduled;
}

async function doScheduledSweep(): Promise<number> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - STALE_SCHEDULED_GRACE_MS);

  try {
    const candidates = await db.teachingSession.findMany({
      where: {
        status: SessionStatus.SCHEDULED,
        deletedAt: null,
        scheduledEnd: { lt: staleCutoff },
      },
      select: { id: true, title: true, scheduledEnd: true },
    });
    if (candidates.length === 0) return 0;

    let ended = 0;
    for (const s of candidates) {
      try {
        const update = await db.teachingSession.updateMany({
          where: { id: s.id, status: SessionStatus.SCHEDULED },
          data: {
            status: SessionStatus.ENDED,
            // actualStart stays null — clear signal the session never started.
            actualEnd: s.scheduledEnd,
          },
        });
        if (update.count === 0) continue;
        ended += 1;

        await Promise.allSettled([
          audit({
            actorId: null,
            eventType: 'SESSION_AUTO_ENDED',
            entityType: 'teaching_session',
            entityId: s.id,
            summary: `Auto-ended stale SCHEDULED session "${s.title}" (never started)`,
            details: { reason: 'stale_scheduled', scheduledEnd: s.scheduledEnd.toISOString() },
          }),
          sessionAudit({
            sessionId: s.id,
            eventType: SESSION_AUDIT.SESSION_ENDED,
            actorId: null,
            details: { reason: 'stale_scheduled_sweep' },
          }),
          cancelSessionReminders(s.id),
        ]);
      } catch (err) {
        console.error('[stale-scheduled-sweep] failed to end session', s.id, err);
      }
    }

    if (ended > 0) {
      console.warn(`[stale-scheduled-sweep] auto-ended ${ended} stuck SCHEDULED session(s)`);
    }
    return ended;
  } catch (err) {
    console.error('[stale-scheduled-sweep] sweep failed:', err);
    return 0;
  }
}
