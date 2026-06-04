// ════════════════════════════════════════════════════════════════════════════
// /admin/* segment guard — server-side role gate for the entire admin console.
// Non-admins are redirected to /dashboard BEFORE any admin page (or its data
// fetches) render. This closes the gap where client-only admin pages
// (invitations, cohorts, bulk import) rendered their shell to non-admins and
// only failed at the API with a 403.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'
import { auth } from '@/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login?next=/admin')
  if (session.user.role !== Role.ADMIN) redirect('/dashboard')
  return <>{children}</>
}
