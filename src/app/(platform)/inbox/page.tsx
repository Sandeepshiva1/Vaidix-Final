import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { InboxClient } from '@/components/layout/inbox-client'

export default async function InboxPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Session updates, learning milestones, recordings, and more.
        </p>
      </div>
      <InboxClient role={session.user.role} />
    </div>
  )
}
