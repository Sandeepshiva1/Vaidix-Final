// Shared session bucketing — single source of truth for "is this session
// live / upcoming / past?" Used by every surface that lists sessions
// (classroom feed, calendar agenda, dashboard upcoming widget, etc.) so a
// session never appears in one list and not the other due to filter drift.
//
// Rules — kept deliberately tolerant so a session whose status hasn't been
// updated yet (e.g. host forgot to click Start) still shows up in the
// right bucket from the user's perspective:
//
//   live      — status === 'LIVE'
//   past      — status is ENDED or CANCELLED, OR scheduledEnd has passed
//                (regardless of status — covers stuck SCHEDULED sessions
//                whose host never started, before the auto-end sweep runs)
//   upcoming  — everything else (scheduledStart in the future, or
//                currently within its window but not yet flipped to LIVE)
//
// `scheduledEnd` is optional in the input shape because some callers
// (calendar agenda) only carry the start time. When omitted, we degrade
// gracefully to a start-time-only check.

import { SessionStatus } from '@prisma/client'

export type SessionBucket = 'live' | 'upcoming' | 'past'

export interface BucketableSession {
  status: SessionStatus | string
  scheduledStart: string | Date
  scheduledEnd?: string | Date | null
}

function ms(value: string | Date): number {
  return typeof value === 'string' ? new Date(value).getTime() : value.getTime()
}

export function sessionBucket(
  s: BucketableSession,
  now: Date | number = Date.now(),
): SessionBucket {
  const nowMs = typeof now === 'number' ? now : now.getTime()

  if (s.status === SessionStatus.LIVE) return 'live'
  if (s.status === SessionStatus.ENDED || s.status === SessionStatus.CANCELLED) {
    return 'past'
  }
  // End time is the most informative signal we have for "this session is
  // over". If it's available and already passed, treat as past even when
  // the status field hasn't been swept yet.
  if (s.scheduledEnd) {
    if (ms(s.scheduledEnd) <= nowMs) return 'past'
    // If end is in the future, we're either currently inside the window
    // (effectively live but the host hasn't started — keep as upcoming so
    // the user can still join) or before the start.
    return 'upcoming'
  }
  // No end time available — fall back to start.
  return ms(s.scheduledStart) > nowMs ? 'upcoming' : 'past'
}

/**
 * Convenience: split a list into three arrays. Saves callers from doing
 * the same `.filter()` three times — and importantly, ensures every row
 * lands in EXACTLY one bucket (mutually exclusive by construction).
 */
export function bucketSessions<T extends BucketableSession>(
  items: T[],
  now: Date | number = Date.now(),
): { live: T[]; upcoming: T[]; past: T[] } {
  const live: T[] = []
  const upcoming: T[] = []
  const past: T[] = []
  for (const item of items) {
    const b = sessionBucket(item, now)
    if (b === 'live') live.push(item)
    else if (b === 'upcoming') upcoming.push(item)
    else past.push(item)
  }
  return { live, upcoming, past }
}
