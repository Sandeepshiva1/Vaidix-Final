// ════════════════════════════════════════════════════════════════════════════
// Server-side data loader for the Post-Conference page.
//
// Pulls REAL data from existing backends and shapes it for the (otherwise
// demo-styled) PostClient. Everything here is read-only; mutations happen via
// the existing classroom API routes from the client. Honest empty arrays are
// returned where a source has no data — the client renders honest empty states.
// ════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db'
import { Role, DocumentRoute } from '@prisma/client'
import { listQa, type QaItemView } from '@/server/services/qa/qa-service'
import { computeSessionReadiness, type ReadinessSnapshot } from '@/server/services/readiness/readiness-service'
import { aggregateSessionEngagement, type SessionEngagementAggregate } from '@/server/services/engagement/engagement-service'

export interface PostDoubt {
  id: string
  author: string
  text: string
  time: string // ISO
  timestampSec: number
  pinned: boolean
  answered: boolean
  endorsed: number
  likedByMe: boolean
  answer: string | null
  answeredByName: string | null
  replies: { id: string; author: string; text: string }[]
}

export interface PostMaterial {
  id: string // documentSessionLink id
  documentId: string
  name: string
  sizeBytes: string // BigInt serialized to string
  kind: string
  route: string
  isPreSession: boolean
}

export interface PostRecording {
  id: string
  status: string
  durationSec: number | null
  hlsUrl: string | null
  thumbnailUrl: string | null
  createdAt: string
}

export interface PostPearl {
  id: string
  title: string
  body: string
  approved: boolean
  extractedByAi: boolean
  createdAt: string
}

export interface PostCase {
  id: string
  title: string
  condition: string
  difficulty: string
  bloomsLevel: number
  estimatedMinutes: number
  description: string
  completions: number
}

export interface PostEvaluation {
  userId: string
  name: string
  initials: string
  level: string // KirkpatrickLevel
  score: number
  createdAt: string
}

export interface PostAnalyticsRow {
  userId: string
  name: string
  initials: string
  cohort: string
  readinessScore: number // 0-100 (pre-conference signal)
  attended: boolean
  doubts: number
}

export interface PostShare {
  id: string
  url: string | null
  expiresAt: string
  revokedAt: string | null
  hasPassword: boolean
}

export interface PostData {
  // KPI cards
  attendedCount: number
  invitedCount: number
  avgEngagement: number | null
  doubtsCount: number
  hasRecording: boolean

  doubts: PostDoubt[]
  materials: PostMaterial[]
  recordings: PostRecording[]
  pearls: PostPearl[]
  cases: PostCase[]
  evaluations: PostEvaluation[]
  analytics: PostAnalyticsRow[]
  shares: PostShare[]
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function mapDoubt(q: QaItemView): PostDoubt {
  return {
    id: q.id,
    author: q.userName,
    text: q.question,
    time: q.createdAt,
    timestampSec: q.timestampSec,
    pinned: q.pinned,
    answered: !!q.answer,
    endorsed: q.likeCount,
    likedByMe: q.likedByMe,
    answer: q.answer,
    answeredByName: q.answeredByName,
    replies: q.replies.map((r) => ({ id: r.id, author: r.userName, text: r.question })),
  }
}

export async function loadPostData(
  sessionId: string,
  actor: { userId: string; role: Role }
): Promise<PostData> {
  const sessionRow = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      programId: true,
      topicId: true,
      status: true,
      cohort: { select: { name: true } },
      _count: { select: { invites: true } },
      recording: { select: { id: true } },
    },
  })

  const programId = sessionRow?.programId ?? null
  const topicId = sessionRow?.topicId ?? null
  const recordingId = sessionRow?.recording?.id ?? null
  const cohortName = sessionRow?.cohort?.name ?? ''

  // ── Participants (attendance + names) ──────────────────────────────────────
  const participants = await db.sessionParticipant.findMany({
    where: { sessionId },
    select: {
      userId: true,
      joinedAt: true,
      user: { select: { name: true } },
    },
  })
  const attendedCount = participants.filter((p) => p.joinedAt !== null).length

  // ── Doubts (real Q&A on the recording) ─────────────────────────────────────
  let doubts: PostDoubt[] = []
  try {
    const qa = await listQa(actor, sessionId)
    doubts = qa.map(mapDoubt)
  } catch {
    doubts = []
  }

  // Per-user doubt counts (top-level questions authored by each participant).
  const doubtCountByUser = new Map<string, number>()
  try {
    if (recordingId) {
      const grouped = await db.qaItem.groupBy({
        by: ['userId'],
        where: { recordingId, parentId: null },
        _count: { _all: true },
      })
      for (const g of grouped) doubtCountByUser.set(g.userId, g._count._all)
    }
  } catch {
    /* ignore */
  }

  // ── Readiness (pre-conference signal feeding analytics) ────────────────────
  let readiness: ReadinessSnapshot | null = null
  try {
    readiness = await computeSessionReadiness(actor, sessionId)
  } catch {
    readiness = null
  }

  // ── Engagement aggregate (avg engagement KPI) ──────────────────────────────
  let engagement: SessionEngagementAggregate | null = null
  try {
    // Wide window so the score reflects the whole (ended) session, not a 5-min slice.
    engagement = await aggregateSessionEngagement(sessionId, 24 * 60)
  } catch {
    engagement = null
  }
  const hasEngagementSignal =
    !!engagement &&
    engagement.recentChat + engagement.recentHooks + engagement.recentHandRaises > 0

  // ── Analytics rows: one per participant, joined with readiness + doubts ─────
  const readinessByUser = new Map<string, number>()
  if (readiness) for (const l of readiness.perLearner) readinessByUser.set(l.userId, l.readinessScore)

  const analytics: PostAnalyticsRow[] = participants
    .map((p) => ({
      userId: p.userId,
      name: p.user.name,
      initials: initialsOf(p.user.name),
      cohort: cohortName,
      readinessScore: readinessByUser.get(p.userId) ?? 0,
      attended: p.joinedAt !== null,
      doubts: doubtCountByUser.get(p.userId) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── Materials (session documents) ──────────────────────────────────────────
  const materialLinks = await db.documentSessionLink.findMany({
    where: {
      sessionId,
      document: { deletedAt: null, expungedAt: null },
    },
    orderBy: [{ isPreSession: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      documentId: true,
      isPreSession: true,
      document: {
        select: { title: true, sizeBytes: true, kind: true, route: true },
      },
    },
  })
  const materials: PostMaterial[] = materialLinks
    // Promo assets aren't session "materials" — exclude.
    .filter(
      (l) =>
        l.document.route !== DocumentRoute.PROMO_ASSET &&
        l.document.route !== DocumentRoute.PROMO_TEASER_VIDEO
    )
    .map((l) => ({
      id: l.id,
      documentId: l.documentId,
      name: l.document.title,
      sizeBytes: l.document.sizeBytes.toString(),
      kind: l.document.kind,
      route: l.document.route,
      isPreSession: l.isPreSession,
    }))

  // ── Recordings ─────────────────────────────────────────────────────────────
  // Use the raw recording row(s) — playback URL signing isn't needed for the
  // post-conference list (download/view links handled by recordings route).
  const recordingRows = recordingId
    ? await db.recording.findMany({
        where: { sessionId, expungedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          durationSec: true,
          hlsPath: true,
          thumbnailUrl: true,
          createdAt: true,
        },
      })
    : []
  const recordings: PostRecording[] = recordingRows.map((r) => ({
    id: r.id,
    status: r.status,
    durationSec: r.durationSec,
    hlsUrl: r.hlsPath,
    thumbnailUrl: r.thumbnailUrl,
    createdAt: r.createdAt.toISOString(),
  }))

  // ── Pearls (program-scoped, sourced from this session's recording) ─────────
  let pearls: PostPearl[] = []
  if (programId) {
    const pearlRows = await db.pearl.findMany({
      where: {
        programId,
        OR: [
          ...(recordingId ? [{ sourceRecordingId: recordingId }] : []),
          ...(topicId ? [{ topicId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true,
        title: true,
        body: true,
        approved: true,
        extractedByAi: true,
        createdAt: true,
      },
    })
    pearls = pearlRows.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      approved: p.approved,
      extractedByAi: p.extractedByAi,
      createdAt: p.createdAt.toISOString(),
    }))
  }

  // ── Simulation cases (program + topic scoped CaseTemplates) ────────────────
  let cases: PostCase[] = []
  if (programId) {
    const caseRows = await db.caseTemplate.findMany({
      where: {
        programId,
        status: 'PUBLISHED',
        ...(topicId ? { topicId } : {}),
      },
      orderBy: [{ bloomsLevel: 'asc' }, { title: 'asc' }],
      take: 24,
      select: {
        id: true,
        title: true,
        condition: true,
        difficulty: true,
        bloomsLevel: true,
        estimatedMinutes: true,
        description: true,
        _count: { select: { cases: { where: { status: 'COMPLETED' } } } },
      },
    })
    cases = caseRows.map((c) => ({
      id: c.id,
      title: c.title,
      condition: c.condition,
      difficulty: c.difficulty,
      bloomsLevel: c.bloomsLevel,
      estimatedMinutes: c.estimatedMinutes,
      description: c.description,
      completions: c._count.cases,
    }))
  }

  // ── Kirkpatrick evaluations for this session ───────────────────────────────
  const evalRows = await db.kirkpatrickEvaluation.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    select: {
      userId: true,
      level: true,
      score: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  })
  const evaluations: PostEvaluation[] = evalRows.map((e) => ({
    userId: e.userId,
    name: e.user.name,
    initials: initialsOf(e.user.name),
    level: e.level,
    score: Number(e.score),
    createdAt: e.createdAt.toISOString(),
  }))

  // ── Recording shares (Share tab) ───────────────────────────────────────────
  let shares: PostShare[] = []
  if (recordingId) {
    const shareRows = await db.recordingShare.findMany({
      where: { recordingId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        passwordHash: true,
      },
    })
    shares = shareRows.map((s) => ({
      id: s.id,
      // The raw token is only returned once at creation time (never stored), so
      // we can't reconstruct a clickable URL for pre-existing shares. The client
      // mints a fresh link via POST /recording-share when the user clicks "Copy".
      url: null,
      expiresAt: s.expiresAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
      hasPassword: !!s.passwordHash,
    }))
  }

  return {
    attendedCount,
    invitedCount: sessionRow?._count.invites ?? 0,
    avgEngagement: hasEngagementSignal ? engagement!.engagementScore : null,
    doubtsCount: doubts.length,
    hasRecording: !!recordingId,
    doubts,
    materials,
    recordings,
    pearls,
    cases,
    evaluations,
    analytics,
    shares,
  }
}
