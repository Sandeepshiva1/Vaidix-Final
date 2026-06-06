// ════════════════════════════════════════════════════════════════════════════
// Attendee Post-Conference Page — /classroom/[id]/post
//
// A learner-facing summary after a session ends showing:
//   1. Recording (link to /classroom/[id]/recording if available)
//   2. Key Pearls / learnings extracted by AI
//   3. Their own doubts & Q&A from the recording
//   4. Session materials (pre-reads + presentation)
//   5. Their personal readiness & performance score
//   6. Their quiz answers vs correct answers
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { SessionStatus, DocumentRoute } from '@prisma/client'
import { presignDownload } from '@/lib/storage'
import { AttendeePostClient } from './attendee-post-client'
import { computeSessionReadiness } from '@/server/services/readiness/readiness-service'
import { listQa } from '@/server/services/qa/qa-service'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AttendeePostPage({ params }: PageProps) {
  const { id: sessionId } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/classroom/${sessionId}/post`)

  const userId = session.user.id

  const s = await db.teachingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: {
      id: true,
      title: true,
      status: true,
      hostId: true,
      metadata: true,
      scheduledStart: true,
      host: { select: { name: true } },
      recording: { select: { id: true, status: true, hlsPath: true } },
    },
  })
  if (!s) notFound()

  // Only show post-conference page when session has ended.
  const POST_STATUSES: SessionStatus[] = [SessionStatus.ENDED, SessionStatus.CANCELLED]
  if (!POST_STATUSES.includes(s.status)) {
    redirect(`/classroom/${sessionId}/prepare`)
  }

  const meta = s.metadata && typeof s.metadata === 'object' && !Array.isArray(s.metadata)
    ? (s.metadata as Record<string, unknown>)
    : {}

  // ── Presenter name ─────────────────────────────────────────────────────────
  const metaRoles = Array.isArray(meta.roles)
    ? (meta.roles as { role: string; userId: string; name?: string }[])
    : []
  const presenterEntry = metaRoles.find((r) => r.role === 'Presenter')
  const presenterName = presenterEntry?.name ?? s.host.name

  // ── Recording availability ─────────────────────────────────────────────────
  const hasRecording = !!s.recording && s.recording.hlsPath !== null

  // ── Pearls (AI key learnings) ──────────────────────────────────────────────
  const transcriptIds = (
    await db.sessionTranscript.findMany({ where: { sessionId }, select: { id: true } })
  ).map((t) => t.id)

  const pearls = transcriptIds.length > 0
    ? await db.pearl.findMany({
        where: { sourceSessionTranscriptId: { in: transcriptIds }, approved: true },
        select: { id: true, title: true, body: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : []

  // ── My own Q&A doubts from the recording ──────────────────────────────────
  const actor = { userId, role: session.user.role }
  let myDoubts: { id: string; text: string; answer: string | null; answeredByName: string | null; endorsed: number; time: string }[] = []
  try {
    const allQa = await listQa(actor, sessionId)
    myDoubts = allQa
      .filter((q) => q.userId === userId)
      .map((q) => ({
        id: q.id,
        text: q.question,
        answer: q.answer,
        answeredByName: q.answeredByName,
        endorsed: q.likeCount,
        time: q.createdAt,
      }))
  } catch { /* recording Q&A may not exist yet */ }

  // ── Session materials ──────────────────────────────────────────────────────
  const links = await db.documentSessionLink.findMany({
    where: { sessionId },
    select: {
      id: true,
      isPreSession: true,
      document: { select: { id: true, title: true, s3Key: true, kind: true, route: true } },
    },
    orderBy: { preSessionRank: 'asc' },
  })

  const materials = await Promise.all(
    links.map(async (l) => {
      let url: string | null = null
      try {
        if (l.document.s3Key) url = await presignDownload(l.document.s3Key, 3600)
      } catch { /* skip */ }
      return {
        linkId: l.id,
        title: l.document.title,
        kind: l.document.kind as string,
        isPresentation: l.document.route === DocumentRoute.DECK_FORGE,
        url,
      }
    })
  )

  // ── My readiness score ─────────────────────────────────────────────────────
  let myReadinessScore: number | null = null
  try {
    const snapshot = await computeSessionReadiness(actor, sessionId)
    const mine = snapshot.perLearner.find((l) => l.userId === userId)
    myReadinessScore = mine?.readinessScore ?? null
  } catch { /* ignore */ }

  // ── My quiz responses vs correct answers ───────────────────────────────────
  const lp = meta.learnerPrep && typeof meta.learnerPrep === 'object'
    ? (meta.learnerPrep as Record<string, unknown>)
    : {}
  const mcqs = Array.isArray(lp.mcqs)
    ? (lp.mcqs as Array<{ id: string; q: string; options: string[]; correct: number }>)
    : []
  const openEnded = Array.isArray(lp.openEnded)
    ? (lp.openEnded as Array<{ id: string; q: string }>)
    : []

  const myResponses = await db.sessionQuizResponse.findMany({
    where: { sessionId, userId },
    select: { questionId: true, answer: true, answerText: true, isCorrect: true },
  })
  const responseMap = Object.fromEntries(myResponses.map((r) => [r.questionId, r]))

  return (
    <AttendeePostClient
      sessionId={sessionId}
      sessionTitle={s.title}
      presenterName={presenterName}
      sessionDate={s.scheduledStart.toISOString()}
      hasRecording={hasRecording}
      pearls={pearls.map((p) => ({ id: p.id, title: p.title, body: p.body }))}
      myDoubts={myDoubts}
      materials={materials}
      myReadinessScore={myReadinessScore}
      mcqs={mcqs}
      openEnded={openEnded}
      responseMap={responseMap}
    />
  )
}
