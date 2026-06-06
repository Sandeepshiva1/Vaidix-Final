// ════════════════════════════════════════════════════════════════════════════
// Attendee Pre-Conference Dashboard — /classroom/[id]/prepare
//
// Unified pre-session hub for learners showing:
//   1. Session info + countdown
//   2. Finalized presenter deck (viewable PDF)
//   3. Pre-session study materials (readings + videos)
//   4. Pre-quiz MCQs and open-ended questions (answerable inline)
//   5. Pre-questions board (ask / upvote questions for the presenter)
//   6. Readiness checklist showing personal completion state
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { DeckForgeStatus } from '@prisma/client'
import { AttendeePrepareDashboard } from './attendee-prepare-client'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AttendeePrepPage({ params }: PageProps) {
  const { id: sessionId } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/classroom/${sessionId}/prepare`)

  const s = await db.teachingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      scheduledStart: true,
      scheduledEnd: true,
      hostId: true,
      status: true,
      metadata: true,
      host: { select: { name: true, id: true } },
      _count: { select: { preQuestions: true, invites: true } },
    },
  })
  if (!s) notFound()

  const userId = session.user.id

  // ── Resolve presenter name from metadata roles ─────────────────────────────
  const meta = s.metadata && typeof s.metadata === 'object' && !Array.isArray(s.metadata)
    ? (s.metadata as Record<string, unknown>)
    : {}
  const metaRoles = Array.isArray(meta.roles)
    ? (meta.roles as { role: string; userId: string; name?: string }[])
    : []
  const presenterEntry = metaRoles.find((r) => r.role === 'Presenter')
  const presenterName = presenterEntry?.name ?? s.host.name

  // ── Finalized deck (approved DeckForgeJob → document) ─────────────────────
  // Use proxy route URL instead of presigned URL to avoid leaking S3 credentials
  // and to keep navigation within the app (inline viewer works without new tab).
  const approvedJob = await db.deckForgeJob.findFirst({
    where: {
      status: DeckForgeStatus.APPROVED,
      document: { sessionLinks: { some: { sessionId } } },
    },
    select: {
      id: true,
      document: { select: { id: true, title: true, kind: true, mimeType: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const deck = approvedJob?.document
    ? {
        documentId: approvedJob.document.id,
        // Proxied through our API — browser gets a 302 to the presigned URL
        viewUrl: `/api/documents/${approvedJob.document.id}/view`,
        title: approvedJob.document.title ?? 'Presentation',
        mimeType: approvedJob.document.mimeType ?? 'application/pdf',
      }
    : null

  // ── Pre-session study materials ────────────────────────────────────────────
  const studyLinks = await db.documentSessionLink.findMany({
    where: { sessionId, isPreSession: true },
    select: {
      id: true,
      document: { select: { id: true, title: true, kind: true, mimeType: true } },
    },
    orderBy: { preSessionRank: 'asc' },
  })

  const studyMaterials = studyLinks.map((l) => ({
    linkId: l.id,
    documentId: l.document.id,
    title: l.document.title,
    kind: l.document.kind as string,
    mimeType: l.document.mimeType ?? '',
    // Proxied view route — no raw S3 URL exposed to browser
    viewUrl: `/api/classroom/sessions/${sessionId}/study-pack/documents/${l.id}/view`,
  }))

  // ── Learner prep questions (MCQ + open-ended) ──────────────────────────────
  const lp = meta.learnerPrep && typeof meta.learnerPrep === 'object'
    ? (meta.learnerPrep as Record<string, unknown>)
    : {}
  const mcqs = Array.isArray(lp.mcqs)
    ? (lp.mcqs as Array<{ id: string; q: string; options: string[]; correct: number }>)
    : []
  const openEnded = Array.isArray(lp.openEnded)
    ? (lp.openEnded as Array<{ id: string; q: string }>)
    : []

  // ── Learner's existing quiz responses ─────────────────────────────────────
  const myResponses = await db.sessionQuizResponse.findMany({
    where: { sessionId, userId },
    select: { questionId: true, answer: true, answerText: true, isCorrect: true },
  })
  const responseMap = Object.fromEntries(myResponses.map((r) => [r.questionId, r]))

  // ── Study pack view tracking (to show "viewed" state) ─────────────────────
  const viewedLinkIds = (
    await db.studyPackView.findMany({
      where: { sessionId, userId },
      select: { documentLinkId: true },
    })
  ).map((v) => v.documentLinkId).filter((id): id is string => id !== null)

  const viewedSet = new Set(viewedLinkIds)

  // ── Did the learner ask a question? ───────────────────────────────────────
  const askedQuestion = await db.preSessionQuestion.findFirst({
    where: { sessionId, userId },
    select: { id: true },
  })

  // ── AI-generated learning artifacts (flashcards, microlearning, infographics) ──
  const artifacts = lp.artifacts && typeof lp.artifacts === 'object' && !Array.isArray(lp.artifacts)
    ? (lp.artifacts as Record<string, unknown>)
    : {}
  const flashcards = Array.isArray(artifacts.flashcards)
    ? (artifacts.flashcards as Array<{ q: string; a: string }>)
    : []
  const microlearning = Array.isArray(artifacts.microlearning)
    ? (artifacts.microlearning as Array<{ kind: string; title: string; dur: string }>)
    : []
  const infographics = Array.isArray(artifacts.infographics)
    ? (artifacts.infographics as Array<{ title: string; sub: string }>)
    : []

  // ── Pre-cases (simulation cases linked to this session) ───────────────────
  const preCases = await db.sessionPreCase.findMany({
    where: { sessionId },
    orderBy: { rank: 'asc' },
    select: {
      id: true,
      rank: true,
      required: true,
      caseTemplate: {
        select: {
          id: true,
          title: true,
          condition: true,
          difficulty: true,
          bloomsLevel: true,
          estimatedMinutes: true,
          description: true,
        },
      },
    },
  })

  // ── Learner's progress on pre-cases ───────────────────────────────────────
  const myCaseProgress = preCases.length > 0
    ? await db.case.findMany({
        where: {
          residentId: userId,
          templateId: { in: preCases.map((p) => p.caseTemplate.id) },
          deletedAt: null,
        },
        select: { templateId: true, status: true },
        orderBy: { createdAt: 'desc' },
      })
    : []
  // Keep only the most recent case per template
  const caseStatusMap: Record<string, string> = {}
  for (const c of myCaseProgress) {
    if (c.templateId && !(c.templateId in caseStatusMap)) caseStatusMap[c.templateId] = c.status
  }

  return (
    <AttendeePrepareDashboard
      sessionId={sessionId}
      sessionTitle={s.title}
      description={s.description ?? ''}
      scheduledStart={s.scheduledStart.toISOString()}
      scheduledEnd={s.scheduledEnd.toISOString()}
      presenterName={presenterName}
      status={s.status}
      deck={deck}
      studyMaterials={studyMaterials}
      mcqs={mcqs.map((m) => ({ id: m.id, q: m.q, options: m.options, optionCount: m.options.length }))}
      openEnded={openEnded}
      responseMap={responseMap}
      viewedLinkIds={[...viewedSet]}
      hasAskedQuestion={!!askedQuestion}
      questionCount={s._count.preQuestions}
      currentUserId={userId}
      flashcards={flashcards}
      microlearning={microlearning}
      infographics={infographics}
      preCases={preCases.map((p) => ({
        id: p.id,
        caseTemplateId: p.caseTemplate.id,
        title: p.caseTemplate.title,
        condition: p.caseTemplate.condition,
        difficulty: p.caseTemplate.difficulty as string,
        bloomsLevel: p.caseTemplate.bloomsLevel,
        estimatedMinutes: p.caseTemplate.estimatedMinutes,
        required: p.required,
        rank: p.rank,
        myStatus: caseStatusMap[p.caseTemplate.id] ?? null,
      }))}
    />
  )
}
