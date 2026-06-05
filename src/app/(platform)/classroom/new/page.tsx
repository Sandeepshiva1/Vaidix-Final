import { redirect } from 'next/navigation'
import { auth } from '@/auth'

// Session creation moved to /calendar/new in a later phase (PD→Faculty approval flow).
// This route remains as a semantic alias. Authorization is enforced by the
// /calendar/new page itself, so we forward every signed-in user there and let
// that single guard decide — previously this alias bounced FACULTY/RESIDENT to
// /calendar even though they're allowed to create sessions.
export default async function NewSessionRedirect() {
  const session = await auth()
  if (!session?.user) redirect('/login?next=/calendar/new')
  redirect('/calendar/new')
}
