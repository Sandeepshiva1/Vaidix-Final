import { redirect } from 'next/navigation'
import { db } from '@/lib/db'

// ════════════════════════════════════════════════════════════════════════════
// Board-room guard for the entire /session/[id]/* host workflow.
// ════════════════════════════════════════════════════════════════════════════
// Classroom sessions own the full pre-conference → ready → live → post workflow
// under /session/[id]/* (studio, learners, promo, analytics, questions, ready,
// live, post). Board rooms are quick meetings with NONE of that: they schedule
// and join directly. This layout is the single choke-point that keeps a board
// room out of every one of those routes — even by direct URL — by redirecting
// to the shared call room. One guard instead of nine per-page checks.

export const dynamic = 'force-dynamic'

export default async function SessionWorkflowLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Metadata-only lookup (cheap, indexed by PK). `kind` is set at creation in
  // createTeachingSessionAction. A missing row falls through to the child page,
  // which renders its own notFound().
  const row = await db.teachingSession.findFirst({
    where: { id, deletedAt: null },
    select: { metadata: true },
  })
  const meta =
    row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null
  if (meta?.kind === 'BOARD_ROOM') redirect(`/classroom/${id}`)

  return <>{children}</>
}
