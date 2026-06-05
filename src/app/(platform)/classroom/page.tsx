import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Role, SessionStatus } from '@prisma/client'
import { ClassroomFeed, type ListedSession } from './session-grid'
import { buildApprovalGate, buildSessionVisibilityWhere } from '@/server/services/sessions/visibility'
import {
  isStaleLive,
  isStaleScheduled,
  sweepStaleLiveSessions,
  sweepStaleScheduledSessions,
} from '@/server/services/sessions/auto-end'
import { nextOccurrenceStart } from '@/server/services/sessions/recurrence'
import { bucketSessions, sessionBucket } from '@/lib/sessions/buckets'
import pearlsData from '@/mock-data/pearls.json'

interface MockPearl { tags: string[] }

export default async function ClassroomListPage() {
  const s = await auth()
  if (!s?.user) redirect('/login')

  // read activeProgramId live from the DB so a switcher change is
  // reflected without re-auth.
  const userRow = await db.user.findUnique({
    where: { id: s.user.id },
    select: { activeProgramId: true },
  })
  const activeProgramId = userRow?.activeProgramId ?? s.user.activeProgramId
  if (!activeProgramId) redirect('/dashboard')

  const canSchedule =
    s.user.role === Role.PROGRAM_DIRECTOR ||
    s.user.role === Role.ADMIN ||
    s.user.role === Role.FACULTY

  // Admins and program directors can edit any upcoming session in their program
  // (matches the canEdit gate on /classroom/[id]/edit), not just sessions they host.
  const canManage =
    s.user.role === Role.ADMIN || s.user.role === Role.PROGRAM_DIRECTOR

  // Best-effort recovery of stuck sessions:
  //   - LIVE whose `room_finished` webhook never fired
  //   - SCHEDULED whose host never started but the time window has passed
  // Fire-and-forget: both throttled internally, must never block the render.
  void sweepStaleLiveSessions()
  void sweepStaleScheduledSessions()

  const now = new Date()
  const nowMs = now.getTime()
  const horizon = new Date(nowMs + 30 * 24 * 3600 * 1000)
  const pastFloor = new Date(nowMs - 90 * 24 * 3600 * 1000)

  // Only sessions this user is allowed to see (matches calendar visibility).
  // Without this, every user sees every APPROVED session in the system —
  // regardless of cohort, invite list, or PRIVATE flag.
  const visibility = await buildSessionVisibilityWhere({
    userId: s.user.id,
    role: s.user.role,
    activeProgramId,
  })

  const approvalGate = buildApprovalGate({ userId: s.user.id, role: s.user.role, activeProgramId })

  const sessions = await db.teachingSession.findMany({
    where: {
      // never list sessions outside the user's active program.
      programId: activeProgramId,
      deletedAt: null,
      AND: [
        approvalGate,
        visibility,
        {
          // Non-recurring sessions: keep the bounded window so we don't drag
          // in years of single events. Recurring masters bypass the window —
          // their first occurrence may be ancient but a future one still
          // belongs in Upcoming, computed via RRULE below.
          OR: [
            {
              recurrenceRule: null,
              scheduledEnd: { gt: pastFloor },
              scheduledStart: { lt: horizon },
            },
            { recurrenceRule: { not: null } },
          ],
        },
      ],
    },
    include: {
      host: { select: { id: true, name: true } },
      // proposedBy is a scalar FK already on the row; host is the relation.
      _count: { select: { participants: true, documentLinks: { where: { isPreSession: true } }, preQuestions: true } },
      recording: { select: { thumbnailUrl: true, durationSec: true } },
    },
    orderBy: { scheduledStart: 'desc' },
    take: 200,
  })

  const allPearls = pearlsData as MockPearl[]

  const rows: ListedSession[] = sessions.map((x) => {
    const sessionTags = x.tags.map((t) => t.toLowerCase())
    const pearlCount = sessionTags.length > 0
      ? allPearls.filter((p) => p.tags.some((t) => sessionTags.includes(t.toLowerCase()))).length
      : 0

    // For recurring sessions show the next occurrence as the displayed
    // start/end. The master's stored scheduledStart is the *first* occurrence
    // and is usually historical for any active series.
    const isRecurring = !!x.recurrenceRule
    const durationMs = x.scheduledEnd.getTime() - x.scheduledStart.getTime()
    const next = isRecurring
      ? nextOccurrenceStart(x.scheduledStart, x.recurrenceRule!, x.recurrenceUntil, now)
      : null

    let displayStart = x.scheduledStart
    let displayEnd = x.scheduledEnd
    let displayStatus: SessionStatus = x.status

    if (isRecurring) {
      if (next) {
        displayStart = next
        displayEnd = new Date(next.getTime() + durationMs)
        // The master row's status reflects the most recent occurrence — it
        // can be ENDED while the series still has future occurrences. Force
        // SCHEDULED so the series lands in Upcoming. Don't override LIVE: an
        // active occurrence right now should stay in the Live bucket.
        if (displayStatus !== SessionStatus.LIVE) {
          displayStatus = SessionStatus.SCHEDULED
        }
      } else {
        // Recurrence has fully completed — fall through to past bucket.
        displayStatus = SessionStatus.ENDED
      }
    }

    return {
      id: x.id,
      title: x.title,
      sessionType: x.sessionType,
      status: displayStatus,
      scheduledStart: displayStart.toISOString(),
      scheduledEnd: displayEnd.toISOString(),
      host: x.host,
      proposedById: x.proposedBy ?? null,
      participantCount: x._count.participants,
      studyPackCount: x._count.documentLinks,
      questionCount: x._count.preQuestions,
      objectiveCount: Array.isArray(x.objectives) ? (x.objectives as unknown[]).length : 0,
      thumbnailUrl: x.recording?.thumbnailUrl ?? null,
      durationSec: x.recording?.durationSec ?? null,
      tags: x.tags,
      pearlCount,
      isRecurring,
    }
  })

  // Belt-and-suspenders: project stuck statuses to ENDED at read-time so they
  // land in the past bucket on the very first render, before the background
  // sweeps above have had a chance to correct the DB.
  //   - stuck LIVE  → never got room_finished
  //   - stuck SCHEDULED → host never started, end time has passed
  //
  // Two layers, intentionally:
  //   1. `isStaleLive`/`isStaleScheduled` use the larger grace windows because
  //      they describe "the DB write-side sweep should also touch this row".
  //   2. The bucket check is the read-side truth: if `sessionBucket` puts the
  //      row in `past`, the card component must render the past variant, even
  //      a row that JUST ended (within the 60-min grace) — otherwise the
  //      Replays tab shows an UpcomingCard with "starting now" + Join (the
  //      QA-reported bug).
  const projected: ListedSession[] = rows.map((r) => {
    const candidate = {
      status: r.status as SessionStatus,
      scheduledEnd: new Date(r.scheduledEnd),
      actualStart: null,
    }
    if (isStaleLive(candidate, now) || isStaleScheduled(candidate, now)) {
      return { ...r, status: SessionStatus.ENDED }
    }
    const bucket = sessionBucket(
      { status: r.status, scheduledStart: r.scheduledStart, scheduledEnd: r.scheduledEnd },
      nowMs,
    )
    if (
      bucket === 'past' &&
      r.status !== SessionStatus.ENDED &&
      r.status !== SessionStatus.CANCELLED
    ) {
      return { ...r, status: SessionStatus.ENDED }
    }
    return r
  })

  // Single source of truth: bucketSessions. Same helper is used by the
  // /calendar Sessions feed and the dashboard upcoming widget so a row
  // can never appear in one list and not another.
  const buckets = bucketSessions(projected, nowMs)
  const live = buckets.live
  const upcoming = buckets.upcoming
  const past = buckets.past.slice(0, 40)

  return (
    <ClassroomFeed
      live={live}
      upcoming={upcoming}
      past={past}
      nowMs={nowMs}
      canSchedule={canSchedule}
      userId={s.user.id}
      canManage={canManage}
    />
  )
}
