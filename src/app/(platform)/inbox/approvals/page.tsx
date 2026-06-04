import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { listSessionsPendingApproval } from '@/server/services/session-service'
import { Role } from '@prisma/client'
import { ApprovalsInbox } from './approvals-inbox'

export default async function ApprovalsInboxPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (
    session.user.role !== Role.FACULTY &&
    session.user.role !== Role.PROGRAM_DIRECTOR &&
    session.user.role !== Role.ADMIN
  ) {
    redirect('/dashboard')
  }

  const pending = await listSessionsPendingApproval(session.user.id)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Approval Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Sessions an HOD has proposed you host. Review and accept or decline.
        </p>
      </div>
      <ApprovalsInbox
        sessions={pending.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          sessionType: s.sessionType,
          scheduledStart: s.scheduledStart.toISOString(),
          scheduledEnd: s.scheduledEnd.toISOString(),
          recurrenceRule: s.recurrenceRule,
          openToAll: s.openToAll,
          cohort: s.cohort,
          inviteCount: s._count.invites,
          proposer: s.proposer,
        }))}
      />
    </div>
  )
}
