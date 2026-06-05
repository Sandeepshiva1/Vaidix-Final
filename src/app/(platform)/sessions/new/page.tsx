import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { CohortStatus, Role } from '@prisma/client'
import { NewSessionWizard } from './new-session-wizard'

export const dynamic = 'force-dynamic'

// Roles permitted to create a session. Kept identical to the /calendar/new guard
// and the createTeachingSessionAction allow-list so every create surface agrees.
const SESSION_CREATOR_ROLES: Role[] = [
  Role.PROGRAM_DIRECTOR,
  Role.ADMIN,
  Role.FACULTY,
  Role.RESIDENT,
]

export default async function NewSessionPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?next=/sessions/new')

  // Authorization parity with /calendar/new. Previously this page only checked
  // that the user was signed in, so an EXTERNAL_LEARNER could reach the create
  // wizard simply by typing the URL (tampering) — the server action would reject
  // them, but the form should never render. Guard it here at the route level.
  if (!SESSION_CREATOR_ROLES.includes(session.user.role)) {
    redirect('/dashboard')
  }

  // Real cohorts for the proposer's active program, so the Classroom form's
  // cohort picker persists a real cohortId (the action validates program match).
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { activeProgramId: true },
  })
  const cohorts = user?.activeProgramId
    ? await db.cohort.findMany({
        where: { programId: user.activeProgramId, status: CohortStatus.ACTIVE, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { createdAt: 'desc' },
      })
    : []

  return <NewSessionWizard cohorts={cohorts} />
}
