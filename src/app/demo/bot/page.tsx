// Demo route for the Teaching & Reflection Bot. The implementation lives in the
// shared <TeachingBot /> component so the real platform route (/bot) and this
// demo render exactly the same UI.
import { TeachingBot } from '@/components/bot/teaching-bot'

export default function DemoBotPage() {
  // Demo shell has a 56px topbar + 64px bottom nav; size the chat to fit between.
  return <TeachingBot heightClass="h-[calc(100vh-56px-64px)]" />
}
