import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role } from '@prisma/client'
import { db } from '@/lib/db'
import { loadSessionView } from '@/lib/medlearn/session-view'
import {
  computeSessionReadiness,
  type ReadinessSnapshot,
} from '@/server/services/readiness/readiness-service'
import {
  aggregateSessionEngagement,
  type SessionEngagementAggregate,
} from '@/server/services/engagement/engagement-service'
import {
  getDashboard,
  type DashboardResult,
} from '@/server/services/pre-questions/pre-questions-service'
import { readLearnerPrep, type LearnerPrepConfig } from '@/app/api/classroom/sessions/[id]/learners/route'
import { AnalyticsClient, type AnalyticsData } from './analytics-client'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

interface PageProps {
  params: Promise<{ id: string }>
}

/** Run a loader; if it throws (empty/forbidden/offline source) fall back to `empty`. */
async function safe<T>(fn: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return empty
  }
}

const EMPTY_READINESS = (sessionId: string): ReadinessSnapshot => ({
  sessionId,
  computedAt: new Date().toISOString(),
  versionTag: '',
  weights: { READINGS: 25, VIDEOS: 25, PRE_CASES: 30, PRE_QUESTIONS: 10, ATTENDANCE: 10 },
  cohortStats: { totalLearners: 0, ready: 0, atRisk: 0, underprepared: 0, averageScore: 0 },
  perLearner: [],
})

const EMPTY_ENGAGEMENT = (sessionId: string): SessionEngagementAggregate => ({
  sessionId,
  windowStart: new Date().toISOString(),
  windowEnd: new Date().toISOString(),
  participants: 0,
  recentChat: 0,
  recentHooks: 0,
  recentHookResponses: 0,
  recentHandRaises: 0,
  attentionDropEvents: 0,
  engagementScore: 0,
})

const EMPTY_DASHBOARD: DashboardResult = {
  totalQuestions: 0,
  themesGeneratedAt: null,
  topThemes: [],
  unthemedCount: 0,
}

const EMPTY_PREP: LearnerPrepConfig = {
  lockUntilPreread: true,
  collectAnalytics: true,
  mcqs: [],
  openEnded: [],
}

export default async function AnalyticsPage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/analytics`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  // Responses & analytics is host / faculty-only.
  const isHost = view.hostId === session.user.id
  if (!isHost && !FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard')

  const actor = { userId: session.user.id, role: session.user.role }

  // Every real source is guarded so an empty / throwing backend yields an empty
  // result — the UI renders the same charts in an honest "no data yet" state.
  const [readiness, engagement, questions, prep] = await Promise.all([
    safe(() => computeSessionReadiness(actor, id), EMPTY_READINESS(id)),
    safe(() => aggregateSessionEngagement(id), EMPTY_ENGAGEMENT(id)),
    safe(() => getDashboard(actor, id), EMPTY_DASHBOARD),
    safe(async () => {
      const row = await db.teachingSession.findUnique({
        where: { id },
        select: { metadata: true },
      })
      return readLearnerPrep(row?.metadata)
    }, EMPTY_PREP),
  ])

  // Per-preread open counts: real signals grouped by document link. The
  // readiness snapshot gives the cohort total + per-learner reading counts but
  // not a per-document breakdown, so we compute that here directly.
  const cohortSize = readiness.cohortStats.totalLearners
  const prereads = await safe(async () => {
    const links = await db.documentSessionLink.findMany({
      where: { sessionId: id, isPreSession: true, document: { deletedAt: null, kind: { not: 'VIDEO' } } },
      orderBy: [{ preSessionRank: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, document: { select: { title: true } } },
    })
    if (links.length === 0) return [] as AnalyticsData['prereads']
    // Distinct (user, link) views per link = unique opens.
    const views = await db.studyPackView.findMany({
      where: { sessionId: id, documentLinkId: { in: links.map((l) => l.id) } },
      select: { userId: true, documentLinkId: true },
    })
    const opensByLink = new Map<string, Set<string>>()
    for (const v of views) {
      if (!v.documentLinkId) continue
      const set = opensByLink.get(v.documentLinkId) ?? new Set<string>()
      set.add(v.userId)
      opensByLink.set(v.documentLinkId, set)
    }
    return links.map((l) => {
      const opens = opensByLink.get(l.id)?.size ?? 0
      return {
        file: l.document.title,
        opens,
        total: cohortSize,
        pct: cohortSize === 0 ? 0 : Math.round((opens / cohortSize) * 100),
      }
    })
  }, [] as AnalyticsData['prereads'])

  // ── Quiz response aggregates per question ─────────────────────────────────
  const quizResponseStats = await safe(async () => {
    if (prep.mcqs.length === 0 && prep.openEnded.length === 0) return [] as AnalyticsData['quizStats']
    const allQuestionIds = [
      ...prep.mcqs.map((m) => m.id),
      ...prep.openEnded.map((o) => o.id),
    ]
    const responses = await db.sessionQuizResponse.findMany({
      where: { sessionId: id, questionId: { in: allQuestionIds } },
      select: { questionId: true, answer: true, isCorrect: true },
    })
    return prep.mcqs.map((m): AnalyticsData['quizStats'][number] => {
      const qResps = responses.filter((r) => r.questionId === m.id)
      const totalResponses = qResps.length
      // Tally per-option counts
      const optionTally = m.options.map((_, oi) => qResps.filter((r) => r.answer === oi).length)
      const correctCount = qResps.filter((r) => r.isCorrect === true).length
      return {
        questionId: m.id,
        q: m.q,
        totalResponses,
        optionTally,
        correctOption: m.correct,
        correctCount,
        accuracyPct: totalResponses === 0 ? null : Math.round((correctCount / totalResponses) * 100),
      }
    })
  }, [] as AnalyticsData['quizStats'])

  const data: AnalyticsData = {
    cohortTotal: cohortSize,
    readiness: {
      ready: readiness.cohortStats.ready,
      atRisk: readiness.cohortStats.atRisk,
      underprepared: readiness.cohortStats.underprepared,
      averageScore: readiness.cohortStats.averageScore,
    },
    prereads,
    leaderboard: readiness.perLearner.map((l) => ({
      userId: l.userId,
      name: l.name,
      score: l.readinessScore,
      tier: l.tier,
      preReadings: l.preReadings,
      preVideos: l.preVideos,
    })),
    questionThemes: questions.topThemes.map((t) => ({
      label: t.label,
      summary: t.summary,
      questionCount: t.questionCount,
    })),
    totalQuestions: questions.totalQuestions,
    mcqs: prep.mcqs.map((m) => ({ id: m.id, q: m.q, optionCount: m.options.length })),
    quizStats: quizResponseStats,
    engagement: {
      participants: engagement.participants,
      chat: engagement.recentChat,
      hooks: engagement.recentHookResponses,
      handRaises: engagement.recentHandRaises,
      attentionDrops: engagement.attentionDropEvents,
      score: engagement.engagementScore,
    },
  }

  return <AnalyticsClient session={view} data={data} />
}
