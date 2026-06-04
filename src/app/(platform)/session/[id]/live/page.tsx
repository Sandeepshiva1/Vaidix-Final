import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role } from '@prisma/client'
import { loadSessionView } from '@/lib/medlearn/session-view'
import { LiveConference } from './live-conference'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

// The new-design live conference screen. It ports the demo /live experience and
// (in phase 2) embeds the real LiveKit room in the center stage. Running the
// live conference is host / faculty-only; learners join the room at /classroom.
export default async function LiveConferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/live`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  const isHost = view.hostId === session.user.id
  if (!isHost && !FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard')

  return <LiveConference session={view} />
}
