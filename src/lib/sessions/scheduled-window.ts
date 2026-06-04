// Scheduled-window helper — single source of truth for "is this session
// allowed to mutate live-state right now?".
//
// Vaidix is an LMS, not an ad-hoc meeting tool. A residency session is a
// scheduled curriculum item: opening the LiveKit room outside the scheduled
// window is fine (hosts often want to A/V-test), but it must NOT flip the
// session to LIVE, start the recording, persist captions, or mark the row
// "completed" when the test ends. Those state mutations are gated to this
// window and this window only.
//
// Window definition:
//   [scheduledStart - earlyGraceMs, scheduledEnd + lateGraceMs]
//
// Defaults are deliberately small (5 min before / 15 min after) — generous
// enough to absorb wall-clock skew and a host running a few minutes long,
// tight enough that "I joined the May 27 session today" is clearly out.
//
// Recurring: the window applies to every occurrence independently. A weekly
// Monday 9-10 session is in-window only on Mondays during 8:55-10:15 local.

import { rrulestr } from 'rrule';

export const DEFAULT_EARLY_GRACE_MS = 5 * 60 * 1000;
export const DEFAULT_LATE_GRACE_MS = 15 * 60 * 1000;

export interface WindowableSession {
  scheduledStart: Date;
  scheduledEnd: Date;
  recurrenceRule: string | null;
  recurrenceUntil: Date | null;
}

export interface WindowOptions {
  earlyGraceMs?: number;
  lateGraceMs?: number;
}

export function isInScheduledWindow(
  s: WindowableSession,
  now: Date = new Date(),
  opts: WindowOptions = {},
): boolean {
  const earlyGraceMs = opts.earlyGraceMs ?? DEFAULT_EARLY_GRACE_MS;
  const lateGraceMs = opts.lateGraceMs ?? DEFAULT_LATE_GRACE_MS;
  const nowMs = now.getTime();
  const durationMs = s.scheduledEnd.getTime() - s.scheduledStart.getTime();

  if (!s.recurrenceRule) {
    return (
      nowMs >= s.scheduledStart.getTime() - earlyGraceMs &&
      nowMs <= s.scheduledEnd.getTime() + lateGraceMs
    );
  }

  if (s.recurrenceUntil && nowMs > s.recurrenceUntil.getTime() + lateGraceMs) {
    return false;
  }

  const dtstart = s.scheduledStart
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  let rule;
  try {
    rule = rrulestr(`DTSTART:${dtstart}\nRRULE:${s.recurrenceRule}`, { forceset: false });
  } catch {
    return false;
  }

  // Find any occurrence whose start is in [now - duration - lateGrace, now + earlyGrace].
  // If found, check if `now` falls within that occurrence's window.
  const lowerBound = new Date(nowMs - durationMs - lateGraceMs);
  const upperBound = new Date(nowMs + earlyGraceMs);
  const occurrences = rule.between(lowerBound, upperBound, true);
  for (const occStart of occurrences) {
    const startMs = occStart.getTime();
    if (nowMs >= startMs - earlyGraceMs && nowMs <= startMs + durationMs + lateGraceMs) {
      return true;
    }
  }
  return false;
}
