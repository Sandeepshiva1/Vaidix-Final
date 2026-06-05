import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { SessionStatus, SessionType, Role } from '@prisma/client'
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

function mapStage(status: SessionStatus): DashStage {
  if (status === SessionStatus.LIVE) return 'LIVE'
  if (status === SessionStatus.ENDED || status === SessionStatus.CANCELLED) return 'POST'
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
  const visibility = activeProgramId
    ? await buildSessionVisibilityWhere({
        userId: session.user.id,
        role: session.user.role,
        activeProgramId,
      })
    : { hostId: session.user.id }
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
      _count: { select: { documentLinks: true, invites: true, preQuestions: true, participants: true } },
    },
  })

  const sessions: DashSession[] = rows.map((r) => {
    const start = r.scheduledStart
    const durationMin = Math.max(
      0,
      Math.round((r.scheduledEnd.getTime() - start.getTime()) / 60000),
    )
    // Honest preparation progress from real counts.
    const hasSources = r._count.documentLinks > 0
    const hasLearners = r._count.invites > 0
    const hasQuestions = r._count.preQuestions > 0
    const ready = hasSources && hasLearners
    const steps = [hasSources, hasLearners, hasQuestions, ready]
    const progDone = steps.filter(Boolean).length
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? '',
      specialty: r.tags[0] ?? TYPE_LABEL[r.sessionType],
      type: TYPE_LABEL[r.sessionType],
      stage: mapStage(r.status),
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      time: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      duration: durationMin,
      learners: r._count.participants,
      progDone,
      progTotal: steps.length,
      // Whether the viewer hosts this session. Drives which surface the card
      // links to: hosts go to the /session/* prep+live workflow; learners go
      // to the /classroom/[id] hub (study pack, Q&A, recording, join).
      isHost: r.hostId === session.user.id,
    }
  })

  const stats = {
    upcoming: sessions.filter((s) => s.stage === 'PRE').length,
    live: sessions.filter((s) => s.stage === 'LIVE').length,
    learners: await db.user.count({ where: { role: Role.RESIDENT, deletedAt: null } }),
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
