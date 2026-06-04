import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { NewSessionWizard } from './new-session-wizard'

export const dynamic = 'force-dynamic'

export default async function NewSessionPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?next=/sessions/new')

  return <NewSessionWizard />
}
