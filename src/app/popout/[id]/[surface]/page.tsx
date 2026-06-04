// Pop-out side panel — chrome-less window opened from the live session.
// Authenticated via the existing NextAuth cookie (the popup window inherits
// it from the parent tab) and respects the same session role checks as the
// in-page panel. We redirect to /login if the cookie isn't present so a user
// who somehow hits this URL directly without auth is bounced cleanly.

import { redirect, notFound } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { getEffectiveSessionRole } from '@/server/services/session-service'
import { SharedNotesPanel } from '@/components/classroom/shared-notes-panel'
import { ChatPanelStandalone } from '@/components/classroom/chat-panel-standalone'

// Popout surfaces. Phase 3 added Chat via ChatPanelStandalone (polling
// variant). People is still LiveKit-coupled — deferred to a future phase.
const SURFACES = new Set(['notes', 'chat'])

export const dynamic = 'force-dynamic'

export default async function PopoutPage({
  params,
}: {
  params: Promise<{ id: string; surface: string }>
}) {
  const { id: sessionId, surface } = await params
  if (!SURFACES.has(surface)) notFound()

  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, role: true },
  })
  if (!user) redirect('/login')

  // getEffectiveSessionRole takes the Prisma Role directly — no need to
  // re-map to the UI's lowercased UserRole here.
  const role = await getEffectiveSessionRole(sessionId, user.id, user.role)
  if (!role) notFound()
  const isHostish = role === 'HOST' || role === 'CO_HOST'

  return (
    <main className="h-screen w-screen bg-zinc-950 text-white flex flex-col">
      <header className="px-3 py-2 border-b border-white/8 text-[10px] font-semibold uppercase tracking-wider text-white/55">
        {surface === 'notes' ? 'Shared notes' : 'Chat'}
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">
        {surface === 'notes' ? (
          <SharedNotesPanel sessionId={sessionId} isHostish={isHostish} />
        ) : (
          <ChatPanelStandalone
            sessionId={sessionId}
            currentUser={{ id: user.id, name: user.name }}
          />
        )}
      </div>
    </main>
  )
}
