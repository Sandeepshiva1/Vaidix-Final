import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role, DeckForgeStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { loadSessionView } from '@/lib/medlearn/session-view'
import { StudioClient, type SessionDeck } from './studio-client'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function StudioPage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/studio`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  // Presentation studio is host / faculty-only.
  const isHost = view.hostId === session.user.id
  if (!isHost && !FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard')

  // ── My PPTs: the session's REAL documents + any deck forged from them ──────
  // We list every Document linked to this session and, for each, surface the
  // most recent usable forge job (non-FAILED, non-REJECTED) so "Open editor"
  // can deep-link to /teacher/decks/[jobId]. Documents with no usable job yet
  // are still shown honestly (e.g. AI was offline at upload time).
  const links = await db.documentSessionLink.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      document: {
        select: {
          id: true,
          title: true,
          kind: true,
          createdAt: true,
          deckForgeJobs: {
            where: { status: { notIn: [DeckForgeStatus.FAILED, DeckForgeStatus.REJECTED] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, slideCount: true, status: true, inputTitle: true },
          },
        },
      },
    },
  })

  const decks: SessionDeck[] = links
    .filter((l) => l.document)
    .map((l) => {
      const job = l.document.deckForgeJobs[0] ?? null
      return {
        documentId: l.document.id,
        name: job?.inputTitle || l.document.title,
        kind: l.document.kind,
        savedAt: l.document.createdAt.toISOString().slice(0, 10),
        jobId: job?.id ?? null,
        slideCount: job?.slideCount ?? null,
        status: job?.status ?? null,
      }
    })

  return <StudioClient session={view} decks={decks} />
}
