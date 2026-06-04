import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { CohortStatus } from '@prisma/client'
import { NewSessionWizard } from './new-session-wizard'

export const dynamic = 'force-dynamic'

export default async function NewSessionPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?next=/sessions/new')

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
