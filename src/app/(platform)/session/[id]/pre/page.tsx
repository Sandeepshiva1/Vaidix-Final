import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role } from '@prisma/client'
import { loadSessionView } from '@/lib/medlearn/session-view'
import { PrepareClient } from './prepare-client'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PreConferencePage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/pre`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  // Pre-conference prep is host / faculty-only.
  const isHost = view.hostId === session.user.id
  if (!isHost && !FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard')

  return <PrepareClient session={view} />
}
