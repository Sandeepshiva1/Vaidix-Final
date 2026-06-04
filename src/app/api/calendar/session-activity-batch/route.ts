import { jsonOk, jsonError, requireAuth, handleUnexpected } from '@/server/services/api-helpers'
import { db } from '@/lib/db'
import { Role } from '@prisma/client'

export interface SessionActivitySummary {
  cohortSize: number       // 0 = no cohort (raw counts), >0 = cohort-scoped
  preReadyCount: number
  liveActiveCount: number
  liveAttendedCount: number
  postDoneCount: number
}

export async function GET(req: Request) {
  try {
    const gate = await requireAuth()
    if (!gate.ok) return gate.response

    const canView =
      gate.user.role === Role.ADMIN ||
      gate.user.role === Role.PROGRAM_DIRECTOR ||
      gate.user.role === Role.FACULTY
    if (!canView) return jsonError('FORBIDDEN', 'Insufficient role', 403)

    const url = new URL(req.url)
    const raw = url.searchParams.get('ids') ?? ''
    const sessionIds = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 60)

    if (sessionIds.length === 0) return jsonOk({ activity: {} })

    const sessions = await db.teachingSession.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, status: true, cohortId: true },
    })

    const activity: Record<string, SessionActivitySummary> = {}

    // ── Part 1: sessions with a cohort (scoped to cohort members) ─────────────
    const cohortedSessions = sessions.filter((s) => s.cohortId)
    if (cohortedSessions.length > 0) {
      const cohortedIds = cohortedSessions.map((s) => s.id)
      const cohortIds = [...new Set(cohortedSessions.map((s) => s.cohortId as string))]

      const cohortMembersRaw = await db.cohortMember.findMany({
        where: { cohortId: { in: cohortIds } },
        select: { cohortId: true, userId: true },
      })
      const cohortMemberMap = new Map<string, Set<string>>()
      for (const m of cohortMembersRaw) {
        if (!cohortMemberMap.has(m.cohortId)) cohortMemberMap.set(m.cohortId, new Set())
        cohortMemberMap.get(m.cohortId)!.add(m.userId)
      }
      const allMemberIds = cohortMembersRaw.map((m) => m.userId)

      const [studyViews, preQs, participants, evals] = await Promise.all([
        db.studyPackView.findMany({
          where: { sessionId: { in: cohortedIds }, userId: { in: allMemberIds } },
          select: { sessionId: true, userId: true },
          distinct: ['sessionId', 'userId'],
        }),
        db.preSessionQuestion.findMany({
          where: { sessionId: { in: cohortedIds }, userId: { in: allMemberIds } },
          select: { sessionId: true, userId: true },
          distinct: ['sessionId', 'userId'],
        }),
        db.sessionParticipant.findMany({
          where: { sessionId: { in: cohortedIds }, userId: { in: allMemberIds } },
          select: { sessionId: true, userId: true, leftAt: true },
        }),
        db.kirkpatrickEvaluation.findMany({
          where: { sessionId: { in: cohortedIds }, userId: { in: allMemberIds }, level: 'L1_REACTION' },
          select: { sessionId: true, userId: true },
          distinct: ['sessionId', 'userId'],
        }),
      ])

      const preBySession = new Map<string, Set<string>>()
      for (const v of [...studyViews, ...preQs]) {
        if (!preBySession.has(v.sessionId)) preBySession.set(v.sessionId, new Set())
        preBySession.get(v.sessionId)!.add(v.userId)
      }
      const participantBySession = new Map<string, { userId: string; leftAt: Date | null }[]>()
      for (const p of participants) {
        if (!participantBySession.has(p.sessionId)) participantBySession.set(p.sessionId, [])
        participantBySession.get(p.sessionId)!.push(p)
      }
      const evalBySession = new Map<string, Set<string>>()
      for (const e of evals) {
        if (!e.sessionId) continue
        if (!evalBySession.has(e.sessionId)) evalBySession.set(e.sessionId, new Set())
        evalBySession.get(e.sessionId)!.add(e.userId)
      }

      for (const s of cohortedSessions) {
        const members = cohortMemberMap.get(s.cohortId!)
        const cohortSize = members?.size ?? 0
        const sessionParticipants = participantBySession.get(s.id) ?? []
        const attended = members ? sessionParticipants.filter((p) => members.has(p.userId)) : []
        const active = attended.filter((p) => p.leftAt === null && s.status === 'LIVE')
        activity[s.id] = {
          cohortSize,
          preReadyCount: [...(preBySession.get(s.id) ?? [])].filter((uid) => members?.has(uid) ?? false).length,
          liveActiveCount: active.length,
          liveAttendedCount: attended.length,
          postDoneCount: [...(evalBySession.get(s.id) ?? [])].filter((uid) => members?.has(uid) ?? false).length,
        }
      }
    }

    // ── Part 2: sessions without a cohort (raw participant counts) ────────────
    const uncohortedSessions = sessions.filter((s) => !s.cohortId)
    if (uncohortedSessions.length > 0) {
      const uncohortedIds = uncohortedSessions.map((s) => s.id)

      const [studyViews, preQs, participants, evals] = await Promise.all([
        db.studyPackView.findMany({
          where: { sessionId: { in: uncohortedIds } },
          select: { sessionId: true, userId: true },
          distinct: ['sessionId', 'userId'],
        }),
        db.preSessionQuestion.findMany({
          where: { sessionId: { in: uncohortedIds } },
          select: { sessionId: true, userId: true },
          distinct: ['sessionId', 'userId'],
        }),
        db.sessionParticipant.findMany({
          where: { sessionId: { in: uncohortedIds } },
          select: { sessionId: true, userId: true, leftAt: true },
        }),
        db.kirkpatrickEvaluation.findMany({
          where: { sessionId: { in: uncohortedIds }, level: 'L1_REACTION' },
          select: { sessionId: true, userId: true },
          distinct: ['sessionId', 'userId'],
        }),
      ])

      const preBySession = new Map<string, Set<string>>()
      for (const v of [...studyViews, ...preQs]) {
        if (!preBySession.has(v.sessionId)) preBySession.set(v.sessionId, new Set())
        preBySession.get(v.sessionId)!.add(v.userId)
      }
      const participantBySession = new Map<string, { userId: string; leftAt: Date | null }[]>()
      for (const p of participants) {
        if (!participantBySession.has(p.sessionId)) participantBySession.set(p.sessionId, [])
        participantBySession.get(p.sessionId)!.push(p)
      }
      const evalBySession = new Map<string, Set<string>>()
      for (const e of evals) {
        if (!e.sessionId) continue
        if (!evalBySession.has(e.sessionId)) evalBySession.set(e.sessionId, new Set())
        evalBySession.get(e.sessionId)!.add(e.userId)
      }

      for (const s of uncohortedSessions) {
        const sessionParticipants = participantBySession.get(s.id) ?? []
        const active = sessionParticipants.filter((p) => p.leftAt === null && s.status === 'LIVE')
        activity[s.id] = {
          cohortSize: 0,
          preReadyCount: (preBySession.get(s.id) ?? new Set()).size,
          liveActiveCount: active.length,
          liveAttendedCount: sessionParticipants.length,
          postDoneCount: (evalBySession.get(s.id) ?? new Set()).size,
        }
      }
    }

    return jsonOk({ activity })
  } catch (err) {
    return handleUnexpected(err)
  }
}
