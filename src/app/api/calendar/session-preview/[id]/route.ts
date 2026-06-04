import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers'
import { db } from '@/lib/db'
import { Role } from '@prisma/client'

type StudentActivityRow = {
  userId: string
  name: string
  email: string
  preWorkDone: boolean
  preQuestionAsked: boolean
  rsvpStatus: string | null
  attended: boolean
  isActive: boolean
  attendanceDurationMin: number | null
  evalSubmitted: boolean
  objectivesMarked: boolean
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth()
    if (!gate.ok) return gate.response

    const { id } = await ctx.params
    const viewerRole = gate.user.role

    const session = await db.teachingSession.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        sessionType: true,
        status: true,
        approvalStatus: true,
        scheduledStart: true,
        scheduledEnd: true,
        recurrenceRule: true,
        openToAll: true,
        hostId: true,
        cohortId: true,
        _count: { select: { participants: true } },
      },
    })

    if (!session) return jsonError('NOT_FOUND', 'Session not found', 404)

    const host = await db.user.findUnique({
      where: { id: session.hostId },
      select: { id: true, name: true, email: true, role: true },
    })

    let cohort: {
      id: string
      name: string
      memberCount: number
      members: { id: string; name: string; email: string }[]
    } | null = null

    if (session.cohortId) {
      const raw = await db.cohort.findFirst({
        where: { id: session.cohortId, deletedAt: null },
        select: {
          id: true,
          name: true,
          members: {
            select: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { addedAt: 'asc' },
          },
          _count: { select: { members: true } },
        },
      })
      if (raw) {
        cohort = {
          id: raw.id,
          name: raw.name,
          memberCount: raw._count.members,
          members: raw.members.map((m) => m.user),
        }
      }
    }

    const canViewActivity =
      viewerRole === Role.ADMIN ||
      viewerRole === Role.PROGRAM_DIRECTOR ||
      viewerRole === Role.FACULTY

    let studentActivity: StudentActivityRow[] | null = null

    if (canViewActivity && cohort && cohort.members.length > 0) {
      const memberIds = cohort.members.map((m) => m.id)

      const [studyViews, preQs, invites, participants, evals, objectives] = await Promise.all([
        db.studyPackView.findMany({
          where: { sessionId: id, userId: { in: memberIds } },
          select: { userId: true },
          distinct: ['userId'],
        }),
        db.preSessionQuestion.findMany({
          where: { sessionId: id, userId: { in: memberIds } },
          select: { userId: true },
          distinct: ['userId'],
        }),
        db.sessionInvite.findMany({
          where: { sessionId: id, userId: { in: memberIds } },
          select: { userId: true, status: true },
        }),
        db.sessionParticipant.findMany({
          where: { sessionId: id, userId: { in: memberIds } },
          select: { userId: true, joinedAt: true, leftAt: true },
        }),
        db.kirkpatrickEvaluation.findMany({
          where: { sessionId: id, userId: { in: memberIds }, level: 'L1_REACTION' },
          select: { userId: true },
          distinct: ['userId'],
        }),
        db.sessionObjectiveAchievement.findMany({
          where: { sessionId: id, userId: { in: memberIds } },
          select: { userId: true },
          distinct: ['userId'],
        }),
      ])

      const studyViewSet = new Set(studyViews.map((v) => v.userId))
      const preQSet = new Set(preQs.map((q) => q.userId))
      const inviteMap = new Map(invites.map((i) => [i.userId, i.status]))
      const participantMap = new Map(participants.map((p) => [p.userId, p]))
      const evalSet = new Set(evals.map((e) => e.userId))
      const objectiveSet = new Set(objectives.map((o) => o.userId))

      studentActivity = cohort.members.map((m) => {
        const participant = participantMap.get(m.id)
        const attended = !!participant
        const isActive = attended && participant!.leftAt === null && session.status === 'LIVE'
        const attendanceDurationMin =
          participant?.leftAt && participant.joinedAt
            ? Math.round(
                (participant.leftAt.getTime() - participant.joinedAt.getTime()) / 60000
              )
            : null

        return {
          userId: m.id,
          name: m.name,
          email: m.email,
          preWorkDone: studyViewSet.has(m.id),
          preQuestionAsked: preQSet.has(m.id),
          rsvpStatus: inviteMap.get(m.id) ?? null,
          attended,
          isActive,
          attendanceDurationMin,
          evalSubmitted: evalSet.has(m.id),
          objectivesMarked: objectiveSet.has(m.id),
        }
      })
    }

    return jsonOk({
      session: {
        id: session.id,
        title: session.title,
        sessionType: session.sessionType,
        status: session.status,
        approvalStatus: session.approvalStatus,
        scheduledStart: session.scheduledStart.toISOString(),
        scheduledEnd: session.scheduledEnd.toISOString(),
        isRecurring: !!session.recurrenceRule,
        openToAll: session.openToAll,
        host,
        cohort,
        participantCount: session._count.participants,
        studentActivity,
      },
    })
  } catch (err) {
    return handleUnexpected(err)
  }
}
