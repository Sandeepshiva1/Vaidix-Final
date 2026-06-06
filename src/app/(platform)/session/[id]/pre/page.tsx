import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Role } from '@prisma/client'
import { loadSessionView, resolveSessionRole } from '@/lib/medlearn/session-view'
import { PrepareClient } from './prepare-client'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PreConferencePage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/pre`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  // Fetch metadata to resolve the user's semantic role.
  const row = await db.teachingSession.findFirst({
    where: { id, deletedAt: null },
    select: { metadata: true },
  })

  const userRole = resolveSessionRole(row?.metadata, view.hostId, session.user.id)

  // Attendees have no pre-conference workflow — redirect to their hub.
  if (userRole === 'attendee') {
    // Also allow FACULTY_LIKE who happen to not have an explicit role
    const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]
    if (!FACULTY_LIKE.includes(session.user.role)) {
      redirect(`/classroom/${id}/prepare`)
    }
    // Faculty without a role assignment get presenter-level access (backwards compat)
    return <PrepareClient session={view} userRole="presenter" />
  }

  return <PrepareClient session={view} userRole={userRole} />
}
