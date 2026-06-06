import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role } from '@prisma/client'
import { db } from '@/lib/db'
import { loadSessionView, resolveSessionRole } from '@/lib/medlearn/session-view'
import { loadPostData } from './post-data'
import { PostClient } from './post-client'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PostConferencePage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/post`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  const row = await db.teachingSession.findFirst({
    where: { id, deletedAt: null },
    select: { metadata: true },
  })

  const userRole = resolveSessionRole(row?.metadata, view.hostId, session.user.id)

  // Attendees / panelists are redirected to their post page.
  if (userRole === 'attendee' || userRole === 'panelist') {
    if (!FACULTY_LIKE.includes(session.user.role)) {
      redirect(`/classroom/${id}/post`)
    }
  }

  // Plain faculty (no explicit role assignment) still get full access for backwards compat.
  if (userRole === 'attendee' && FACULTY_LIKE.includes(session.user.role)) {
    const data = await loadPostData(id, { userId: session.user.id, role: session.user.role })
    return <PostClient session={view} data={data} canViewAnalytics={true} />
  }

  const data = await loadPostData(id, { userId: session.user.id, role: session.user.role })

  // Per-learner analytics (sensitive) only for host, presenter, and moderator.
  const canViewAnalytics = userRole === 'host' || userRole === 'presenter' || userRole === 'moderator'

  return <PostClient session={view} data={data} canViewAnalytics={canViewAnalytics} />
}
