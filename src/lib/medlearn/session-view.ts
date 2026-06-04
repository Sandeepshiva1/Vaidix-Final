// ════════════════════════════════════════════════════════════════════════════
// Server-side loader + adapter that turns a real TeachingSession into the shape
// the demo session-workflow screens expect (stage, steps, date/time, etc.).
// Shared by every /session/[id]/* page so the data + step-derivation stay
// consistent. React `cache` dedupes within one render pass.
// ════════════════════════════════════════════════════════════════════════════

import { cache } from 'react'
import { db } from '@/lib/db'
import { SessionStatus, SessionType, DocumentRoute } from '@prisma/client'

export type SVStage = 'PRE' | 'LIVE' | 'POST'
export type SVStepKey = 'studio' | 'learners' | 'promo' | 'analytics' | 'questions' | 'ready'

export interface SessionView {
  id: string
  title: string
  description: string
  specialty: string
  type: string
  stage: SVStage
  date: string // YYYY-MM-DD
  time: string // h:mm am/pm
  duration: number // minutes
  hostId: string
  steps: Record<SVStepKey, boolean>
  counts: { sources: number; learners: number; questions: number; participants: number; promo: number }
}

const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: 'Clinical Teaching',
  GRAND_ROUNDS: 'Grand Rounds',
  CASE_CONFERENCE: 'Case Conference',
  JOURNAL_CLUB: 'Journal Club',
  SKILLS_WORKSHOP: 'Simulation Session',
  ASSESSMENT: 'Assessment',
}

function mapStage(status: SessionStatus): SVStage {
  if (status === SessionStatus.LIVE) return 'LIVE'
  if (status === SessionStatus.ENDED || status === SessionStatus.CANCELLED) return 'POST'
  return 'PRE'
}

export const loadSessionView = cache(async (id: string): Promise<SessionView | null> => {
  const row = await db.teachingSession.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      sessionType: true,
      status: true,
      hostId: true,
      scheduledStart: true,
      scheduledEnd: true,
      tags: true,
      _count: { select: { documentLinks: true, invites: true, preQuestions: true, participants: true } },
    },
  })
  if (!row) return null

  // Promo assets are Documents (route PROMO_ASSET / PROMO_TEASER_VIDEO) linked
  // to the session. Filtered relation counts aren't available in _count, so a
  // small separate count.
  const promo = await db.documentSessionLink.count({
    where: {
      sessionId: id,
      document: { route: { in: [DocumentRoute.PROMO_ASSET, DocumentRoute.PROMO_TEASER_VIDEO] } },
    },
  })

  const start = row.scheduledStart
  const duration = Math.max(0, Math.round((row.scheduledEnd.getTime() - start.getTime()) / 60000))

  const counts = {
    sources: row._count.documentLinks,
    learners: row._count.invites,
    questions: row._count.preQuestions,
    participants: row._count.participants,
    promo,
  }

  const studio = counts.sources > 0
  const learners = counts.learners > 0
  const questions = counts.questions > 0
  const promoDone = counts.promo > 0
  const analytics = false // derived once the analytics surface is configured
  const ready = studio && learners

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    specialty: row.tags[0] ?? TYPE_LABEL[row.sessionType],
    type: TYPE_LABEL[row.sessionType],
    stage: mapStage(row.status),
    date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
    time: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    duration,
    hostId: row.hostId,
    steps: { studio, learners, promo: promoDone, analytics, questions, ready },
    counts,
  }
})

export const PREP_STEPS: { key: SVStepKey; label: string; sub: string }[] = [
  { key: 'studio', label: 'My Presentation', sub: 'Upload or create slides with AI' },
  { key: 'learners', label: 'Prepare Learners', sub: 'Prereads, mind maps & quiz' },
  { key: 'promo', label: 'Invitations & Teasers', sub: 'Flyers, WhatsApp & Instagram posts' },
  { key: 'analytics', label: 'Responses & Analytics', sub: 'Quiz results, engagement & leaderboard' },
  { key: 'questions', label: 'Incoming Questions', sub: 'Review what learners are asking' },
  { key: 'ready', label: 'Session Ready', sub: 'Final checks & go-live' },
]

export function stepProgress(steps: Record<SVStepKey, boolean>): { done: number; total: number; pct: number } {
  const total = PREP_STEPS.length
  const done = PREP_STEPS.filter((s) => steps[s.key]).length
  return { done, total, pct: Math.round((done / total) * 100) }
}
