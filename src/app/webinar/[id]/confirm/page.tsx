// /webinar/[id]/confirm?t=<token>
// Public landing page reached from the registration confirmation email. The
// page POSTs the token to the confirm endpoint (server action via fetch) and
// shows a success / error message. We do this client-side so the URL with
// the token stays out of any server-side fetch logs.

import { ConfirmFlow } from '@/components/webinar/webinar-confirm-flow'

export const dynamic = 'force-dynamic'

export default async function WebinarConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { id } = await params
  const { t } = await searchParams
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-md px-6 py-20">
        <ConfirmFlow sessionId={id} token={t ?? ''} />
      </div>
    </main>
  )
}
