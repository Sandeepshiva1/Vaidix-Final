import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { SessionStatus, SessionType, Role, DocumentRoute, DeckForgeStatus } from '@prisma/client'
import { DashboardClient, type DashSession, type DashStage } from './dashboard-client'
import { buildSessionVisibilityWhere, buildApprovalGate } from '@/server/services/sessions/visibility'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: 'Clinical Teaching',
  GRAND_ROUNDS: 'Grand Rounds',
  CASE_CONFERENCE: 'Case Conference',
  JOURNAL_CLUB: 'Journal Club',
  SKILLS_WORKSHOP: 'Simulation Session',
  ASSESSMENT: 'Assessment',
}

// A session can get stuck in LIVE status if it was started but never properly
// ended (host closed the tab, auto-end didn't fire). Once it's well past its
// scheduled end we treat it as finished rather than showing it "live" forever.
const STALE_LIVE_GRACE_MS = 2 * 60 * 60 * 1000 // 2h past scheduled end

function deriveStage(status: SessionStatus, scheduledEnd: Date, now: Date): DashStage {
  if (status === SessionStatus.ENDED || status === SessionStatus.CANCELLED) return 'POST'
  if (status === SessionStatus.LIVE) {
    if (scheduledEnd.getTime() + STALE_LIVE_GRACE_MS < now.getTime()) return 'POST'
    return 'LIVE'
  }
  return 'PRE'
}

export default async function HomePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  // Read activeProgramId live from the DB so a program switch reflects without
  // re-auth (matches the /classroom feed). The dashboard is the post-login
  // landing for EVERY role, so it must show the sessions a learner can see —
  // not just the ones they host.
  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { activeProgramId: true },
  })
  const activeProgramId = userRow?.activeProgramId ?? session.user.activeProgramId ?? null

  const now = new Date()
  const horizonStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const horizonEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  // Same audience model the classroom feed uses: a session is visible to its
  // host/proposer, its cohort members, and its explicit invitees. Without this
  // the landing page only ever showed sessions you HOST — so cohort members and
  // invited learners saw an empty dashboard even though they were on the
  // invite/cohort. ADMIN / PROGRAM_DIRECTOR get the full tenant (empty fragment).
  // Always call buildSessionVisibilityWhere — even when activeProgramId is null.
  // The previous fallback `{ hostId: session.user.id }` silently hid all invited
  // sessions from learners who hadn't set an active program yet (e.g. new users
  // whose profile was created but activeProgramId was not yet persisted).
  const visibility = await buildSessionVisibilityWhere({
    userId: session.user.id,
    role: session.user.role,
    activeProgramId: activeProgramId ?? undefined,
  })
  const approvalGate = buildApprovalGate({
    userId: session.user.id,
    role: session.user.role,
    activeProgramId: activeProgramId ?? undefined,
  })

  const rows = await db.teachingSession.findMany({
    where: {
      ...(activeProgramId ? { programId: activeProgramId } : {}),
      deletedAt: null,
      AND: [
        visibility,
        approvalGate,
        {
          OR: [
            { status: SessionStatus.LIVE },
            { status: SessionStatus.SCHEDULED, scheduledStart: { lte: horizonEnd } },
            { status: SessionStatus.ENDED, actualEnd: { gte: horizonStart } },
          ],
        },
      ],
    },
    orderBy: [{ status: 'asc' }, { scheduledStart: 'asc' }],
    take: 30,
    select: {
      id: true,
      title: true,
      description: true,
      sessionType: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      tags: true,
      hostId: true,
      host: { select: { name: true } },
      metadata: true,
      _count: { select: { invites: true, preQuestions: true, participants: true } },
    },
  })

  // Promo-asset presence per session (one of the 6 pre-conference activities).
  // Batched groupBy so the dashboard stays a fixed number of queries regardless
  // of how many sessions are listed. Mirrors loadSessionView's `promo` step.
  const sessionIds = rows.map((r) => r.id)
  const promoGroups = sessionIds.length
    ? await db.documentSessionLink.groupBy({
        by: ['sessionId'],
        where: {
          sessionId: { in: sessionIds },
          document: { route: { in: [DocumentRoute.PROMO_ASSET, DocumentRoute.PROMO_TEASER_VIDEO] } },
        },
        _count: { _all: true },
      })
    : []
  const promoBySession = new Map(promoGroups.map((g) => [g.sessionId, g._count._all]))

  // "My Presentation" (studio) is DONE only when a finalized (APPROVED) deck is
  // linked — identical to loadSessionView's `studio = !!approvedDeck`. A raw
  // document/promo link is NOT a finished presentation, so we must NOT key the
  // studio step off documentLinks. Batched into one query (distinct sessionId)
  // so the dashboard stays a fixed number of queries regardless of session count.
  const approvedDeckLinks = sessionIds.length
    ? await db.documentSessionLink.findMany({
        where: {
          sessionId: { in: sessionIds },
          document: { deckForgeJobs: { some: { status: DeckForgeStatus.APPROVED } } },
        },
        select: { sessionId: true },
        distinct: ['sessionId'],
      })
    : []
  const studioBySession = new Set(approvedDeckLinks.map((l) => l.sessionId))

  const sessions: DashSession[] = rows.map((r) => {
    const start = r.scheduledStart
    const durationMin = Math.max(
      0,
      Math.round((r.scheduledEnd.getTime() - start.getTime()) / 60000),
    )
    // The 6 pre-conference activities, kept identical to loadSessionView /
    // PREP_STEPS so the dashboard card and the /session/[id]/pre page never
    // disagree on "X of 6 complete":
    //   studio · learners · promo · analytics · questions · ready
    // Mirror loadSessionView exactly: studio is done only when an APPROVED deck
    // is linked, NOT when any document is attached (documentLinks also counts
    // raw sources and promo assets, which falsely marked this step complete).
    const studioDone = studioBySession.has(r.id)
    // Single metadata parse shared by both the learner-prep check and the
    // board-room kind check below — avoids a duplicate `const meta` in the block.
    const meta = r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)
      ? (r.metadata as Record<string, unknown>)
      : null
    // "Prepare Learners" is done when learners are invited OR when faculty has
    // configured quiz content (MCQs / open-ended questions) in learner prep.
    const lp = meta?.learnerPrep && typeof meta.learnerPrep === 'object'
      ? (meta.learnerPrep as Record<string, unknown>)
      : null
    const hasLearnerPrepContent =
      (Array.isArray(lp?.mcqs) && (lp!.mcqs as unknown[]).length > 0) ||
      (Array.isArray(lp?.openEnded) && (lp!.openEnded as unknown[]).length > 0)
    const learnersDone = r._count.invites > 0 || hasLearnerPrepContent
    const promoDone = (promoBySession.get(r.id) ?? 0) > 0
    const analyticsDone = false // surfaced once the analytics step is configured
    const questionsDone = r._count.preQuestions > 0
    const readyDone = studioDone && learnersDone
    const prepSteps = [studioDone, learnersDone, promoDone, analyticsDone, questionsDone, readyDone]
    const progDone = prepSteps.filter(Boolean).length
    // Board rooms are tagged in metadata at creation (createTeachingSessionAction).
    // sessionType alone can't distinguish a board room from a real case conference.
    const isBoardRoom = meta?.kind === 'BOARD_ROOM'
    return {
      id: r.id,
      title: r.title,
      specialty: r.tags[0] ?? TYPE_LABEL[r.sessionType],
      type: TYPE_LABEL[r.sessionType],
      stage: deriveStage(r.status, r.scheduledEnd, now),
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      time: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      // Raw start (ISO) so the client can hide past sessions and apply the
      // Day/Week/Month/Year window. `date`/`time` above are display-only.
      startsAt: start.toISOString(),
      isBoardRoom,
      duration: durationMin,
      learners: r._count.participants,
      progDone,
      progTotal: prepSteps.length,
      // Per-step completion for the 6 pre-conference activities, so the card can
      // colour each segment (done / active / pending) like the pre page.
      prepSteps,
      // Whether the viewer hosts this session. Drives which surface the card
      // links to: hosts go to the /session/* prep+live workflow; learners go
      // to the /classroom/[id] hub (study pack, Q&A, recording, join).
      isHost: r.hostId === session.user.id,
      presenterName: r.host.name ?? 'Unknown',
    }
  })

  const stats = {
    // "Upcoming" = scheduled and not yet finished. Excludes back-dated /
    // never-started sessions whose end is already in the past, matching the
    // grid (which hides them too).
    upcoming: rows.filter(
      (r) => r.status === SessionStatus.SCHEDULED && r.scheduledEnd.getTime() >= now.getTime(),
    ).length,
    live: sessions.filter((s) => s.stage === 'LIVE').length,
  }

  // "Dr." is an honorific for clinicians only. Admins (and external guests) are
  // not doctors, so prefixing their name with "Dr." is wrong — derive the
  // greeting from the real role instead of hard-coding it in the client.
  const isClinician =
    session.user.role === Role.RESIDENT ||
    session.user.role === Role.FACULTY ||
    session.user.role === Role.PROGRAM_DIRECTOR
  const firstName =
    session.user.name?.split(' ').filter((p) => !p.startsWith('Dr.'))[0] ??
    (isClinician ? 'Doctor' : 'there')
  const greetingName = isClinician ? `Dr. ${firstName}` : firstName

  return <DashboardClient sessions={sessions} stats={stats} greetingName={greetingName} />
}
