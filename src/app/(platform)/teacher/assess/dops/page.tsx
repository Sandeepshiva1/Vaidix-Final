// ════════════════════════════════════════════════════════════════════════════
// /teacher/assess/dops — "Rate Residents" (Direct Observation of Procedural
// Skills). Server-gated to assessors; loads REAL residents from the DB and
// renders the assessment form. Submission persists to `dops_assessments` via
// POST /api/teacher/dops.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { DopsClient } from './dops-client'

export const dynamic = 'force-dynamic'

const ASSESSOR_ROLES: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

export default async function DOPSAssessmentPage() {
  const session = await auth()
  if (!session?.user) redirect('/login?next=/teacher/assess/dops')
  if (!ASSESSOR_ROLES.includes(session.user.role)) redirect('/dashboard')

  const residents = await db.user.findMany({
    where: { role: Role.RESIDENT, deletedAt: null },
    select: {
      id: true,
      name: true,
      profile: { select: { yearOfResidency: true } },
    },
    orderBy: { name: 'asc' },
    take: 200,
  })

  const learners = residents.map((r) => ({
    id: r.id,
    name: r.name,
    year: r.profile?.yearOfResidency ?? null,
  }))

  return <DopsClient residents={learners} />
}
