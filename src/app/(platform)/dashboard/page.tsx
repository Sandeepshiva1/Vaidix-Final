import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { SessionStatus, SessionType, Role } from '@prisma/client'
import { DashboardClient, type DashSession, type DashStage } from './dashboard-client'

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

  const now = new Date()
  const horizonStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const horizonEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)

  const rows = await db.teachingSession.findMany({
    where: {
      hostId: session.user.id,
      deletedAt: null,
      OR: [
        { status: SessionStatus.LIVE },
        { status: SessionStatus.SCHEDULED, scheduledStart: { lte: horizonEnd } },
        { status: SessionStatus.ENDED, actualEnd: { gte: horizonStart } },
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
    }
  })

  const stats = {
    upcoming: sessions.filter((s) => s.stage === 'PRE').length,
    live: sessions.filter((s) => s.stage === 'LIVE').length,
    learners: await db.user.count({ where: { role: Role.RESIDENT, deletedAt: null } }),
  }

  const firstName = session.user.name?.split(' ').filter((p) => !p.startsWith('Dr.'))[0] ?? 'Doctor'

  return <DashboardClient sessions={sessions} stats={stats} firstName={firstName} />
}
