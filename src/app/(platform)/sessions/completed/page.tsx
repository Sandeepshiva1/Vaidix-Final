import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { SessionStatus, SessionType, Role } from '@prisma/client'
import { buildSessionVisibilityWhere, buildApprovalGate } from '@/server/services/sessions/visibility'
import { CompletedSessionsClient, type CompletedSession } from './completed-client'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: 'Clinical Teaching',
  GRAND_ROUNDS: 'Grand Rounds',
  CASE_CONFERENCE: 'Case Conference',
  JOURNAL_CLUB: 'Journal Club',
  SKILLS_WORKSHOP: 'Simulation Session',
  ASSESSMENT: 'Assessment',
}

export default async function CompletedSessionsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { activeProgramId: true },
  })
  const activeProgramId = userRow?.activeProgramId ?? session.user.activeProgramId ?? null

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
      status: { in: [SessionStatus.ENDED, SessionStatus.CANCELLED] },
      AND: [visibility, approvalGate],
    },
    orderBy: { scheduledStart: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      sessionType: true,
      tags: true,
      scheduledStart: true,
      _count: { select: { participants: true } },
    },
  })

  const isClinician =
    session.user.role === Role.RESIDENT ||
    session.user.role === Role.FACULTY ||
    session.user.role === Role.PROGRAM_DIRECTOR
  const firstName =
    session.user.name?.split(' ').filter((p) => !p.startsWith('Dr.'))[0] ??
    (isClinician ? 'Doctor' : 'there')

  const completed: CompletedSession[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    specialty: r.tags[0] ?? TYPE_LABEL[r.sessionType],
    type: TYPE_LABEL[r.sessionType],
    date: `${r.scheduledStart.getFullYear()}-${String(r.scheduledStart.getMonth() + 1).padStart(2, '0')}-${String(r.scheduledStart.getDate()).padStart(2, '0')}`,
    learners: r._count.participants,
  }))

  return <CompletedSessionsClient sessions={completed} greetingName={isClinician ? `Dr. ${firstName}` : firstName} />
}
