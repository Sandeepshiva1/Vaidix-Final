// Public webinar registration page — no auth required.
// /webinar/[id]/register
//
// Server component fetches the public-facing session info (title, host name,
// scheduled time). The form is a client component that POSTs to
// /api/classroom/sessions/[id]/webinar-registrations and shows a confirmation
// message instructing the visitor to check their email.

import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { WebinarRegisterForm } from '@/components/webinar/webinar-register-form'

export const dynamic = 'force-dynamic'

export default async function WebinarRegisterPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await db.teachingSession.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      scheduledStart: true,
      scheduledEnd: true,
      isWebinar: true,
      approvalStatus: true,
      host: { select: { name: true, avatarUrl: true } },
    },
  })
  if (!session || !session.isWebinar || session.approvalStatus !== 'APPROVED') {
    notFound()
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-xl px-6 py-16">
        <header className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
            Webinar
          </p>
          <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight">
            {session.title}
          </h1>
          <div className="mt-2 text-sm text-muted-foreground">
            <span>Hosted by {session.host.name}</span>
            <span className="mx-2">·</span>
            <time>
              {new Date(session.scheduledStart).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short',
              })}
            </time>
          </div>
          {session.description && (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {session.description}
            </p>
          )}
        </header>
        <WebinarRegisterForm sessionId={session.id} />
      </div>
    </main>
  )
}
