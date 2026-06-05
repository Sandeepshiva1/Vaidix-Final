// ════════════════════════════════════════════════════════════════════════════
// /hod/* segment guard — server-side role gate for the entire HOD console.
// The HOD area (competency map, milestones, accreditation) is for the program
// director (HOD) and admins only. Non-eligible roles are redirected to
// /dashboard BEFORE any HOD page or its data fetches render.
//
// Previously only some /hod pages carried their own role check, so a resident or
// faculty member could open /hod/accreditation or /hod/milestones just by typing
// the URL (privilege escalation by URL hopping). This layout closes that gap for
// the whole subtree, matching the /admin layout guard.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'
import { auth } from '@/auth'

export default async function HodLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login?next=/hod')
  if (session.user.role !== Role.PROGRAM_DIRECTOR && session.user.role !== Role.ADMIN) {
    redirect('/dashboard')
  }
  return <>{children}</>
}
