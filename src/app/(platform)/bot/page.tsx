// ════════════════════════════════════════════════════════════════════════════
// /bot — Teaching & Reflection Bot (real platform route)
// ════════════════════════════════════════════════════════════════════════════
// Renders the shared <TeachingBot /> inside the platform shell. The topbar bot
// button links here. Auth is already enforced by proxy.ts (non-public path);
// the explicit check below mirrors the other platform pages and keeps the route
// safe even if the matcher ever changes.

import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { TeachingBot } from '@/components/bot/teaching-bot'

export default async function BotPage() {
  const session = await auth()
  if (!session?.user) redirect('/login?next=/bot')

  return <TeachingBot />
}
