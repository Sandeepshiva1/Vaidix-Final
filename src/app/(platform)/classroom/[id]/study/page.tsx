// ════════════════════════════════════════════════════════════════════════════
// Study Pack — resident-facing pre-session prep page
// Route: /classroom/[id]/study
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { StudyPackList } from '@/components/classroom/study-pack-list'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function StudyPackPage({ params }: PageProps) {
  const [{ id }, session] = await Promise.all([params, auth()])
  if (!session?.user) redirect(`/login?next=/classroom/${id}/study`)

  const s = await db.teachingSession.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      scheduledStart: true,
      scheduledEnd: true,
      sessionType: true,
      hostId: true,
      objectives: true,
      metadata: true,
      _count: { select: { preQuestions: true } },
    },
  })
  if (!s) notFound()

  const host = await db.user.findUnique({
    where: { id: s.hostId },
    select: { name: true },
  })

  const isHost = session.user.id === s.hostId
  const objectives = (Array.isArray(s.objectives) ? s.objectives : []) as Array<{ id: string; text: string; blooms: number; epaTag?: string | null }>
  const meta = (s.metadata ?? {}) as Record<string, unknown>
  const prereqs = (Array.isArray(meta.prereqItems) ? meta.prereqItems : []) as Array<{ id: string; text: string; required: boolean }>

  // Surface the public promo flyer URL (if the presenter has minted one) so
  // attendees can preview the session's flyer/social cards from the Objectives
  // tab. The /p/[token] page is public by design — no role gate needed here.
  const promoShare = await db.promoShare.findFirst({
    where: { sessionId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { token: true },
  })
  const promoShareUrl =
    promoShare && !promoShare.token.startsWith('legacy_')
      ? `/p/${promoShare.token}`
      : null

  return (
    <StudyPackList
      sessionId={id}
      sessionTitle={s.title}
      hostName={host?.name ?? ''}
      scheduledStart={s.scheduledStart.toISOString()}
      sessionType={s.sessionType}
      isHost={isHost}
      currentUserId={session.user.id}
      questionCount={s._count.preQuestions}
      objectiveCount={objectives.length}
      objectives={objectives}
      prereqs={prereqs}
      promoShareUrl={promoShareUrl}
    />
  )
}
