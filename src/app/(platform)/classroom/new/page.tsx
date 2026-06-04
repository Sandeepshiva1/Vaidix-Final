import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role } from '@prisma/client'

// Session creation moved to /calendar/new in W3 (PD→Faculty approval flow).
// This route remains as a semantic alias for the Week 2 deliverables list.
export default async function NewSessionRedirect() {
  const session = await auth()
  if (!session?.user) redirect('/login?next=/calendar/new')
  if (session.user.role !== Role.PROGRAM_DIRECTOR && session.user.role !== Role.ADMIN) {
    redirect('/calendar')
  }
  redirect('/calendar/new')
}
