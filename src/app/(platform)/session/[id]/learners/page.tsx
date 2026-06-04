import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role } from '@prisma/client'
import { loadSessionView } from '@/lib/medlearn/session-view'
import { db } from '@/lib/db'
import { readLearnerPrep, type LearnerPrepConfig } from '@/app/api/classroom/sessions/[id]/learners/route'
import { LearnersClient, type PrereadDoc } from './learners-client'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function LearnersPage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/learners`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  // Preparing learners is host / faculty-only.
  const isHost = view.hostId === session.user.id
  if (!isHost && !FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard')

  // Saved faculty-authored config (lock/analytics/MCQs/open-ended) lives on
  // TeachingSession.metadata.learnerPrep — read it with the same helper the API
  // route uses so the shape stays identical.
  const sessionRow = await db.teachingSession.findUnique({
    where: { id },
    select: { metadata: true },
  })
  const config: LearnerPrepConfig = readLearnerPrep(sessionRow?.metadata)

  // Real linked prereads for this session.
  const links = await db.documentSessionLink.findMany({
    where: { sessionId: id, document: { deletedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      document: {
        select: { id: true, title: true, kind: true, sizeBytes: true, mimeType: true },
      },
    },
  })

  const prereads: PrereadDoc[] = links.map((l) => ({
    id: l.document.id,
    title: l.document.title,
    kind: l.document.kind,
    sizeBytes: Number(l.document.sizeBytes),
  }))

  return <LearnersClient session={view} config={config} prereads={prereads} />
}
