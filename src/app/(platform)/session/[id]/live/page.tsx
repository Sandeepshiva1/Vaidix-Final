import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Radio, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { auth } from '@/auth'
import { Role } from '@prisma/client'
import { loadSessionView } from '@/lib/medlearn/session-view'
import { LiveConference } from './live-conference'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

// The new-design live conference screen. It ports the demo /live experience and
// (in phase 2) embeds the real LiveKit room in the center stage. Running the
// live conference is host / faculty-only; learners join the room at /classroom.
export default async function LiveConferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/live`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  const isHost = view.hostId === session.user.id
  if (!isHost && !FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard')

  // Don't drop anyone into an empty conference room. If the session isn't
  // actually LIVE, say so plainly — and point the host at the prep screen where
  // "Start Session" actually takes it live.
  if (view.stage !== 'LIVE') {
    const ended = view.stage === 'POST'
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <div className={`grid size-16 place-items-center rounded-2xl ${ended ? 'bg-slate-500/10 text-slate-500' : 'bg-rose-500/10 text-rose-500'}`}>
          {ended ? <CheckCircle2 className="size-8" /> : <Radio className="size-8" />}
        </div>
        <h1 className="mt-5 text-[22px] font-semibold tracking-tight">
          {ended ? `“${view.title}” has ended` : `“${view.title}” isn’t live yet`}
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          {ended
            ? 'This session is over. You can review the recording, Q&A and analytics in the post-conference.'
            : `Scheduled for ${view.date} at ${view.time}. ${isHost ? 'Open prep to run final checks, then “Start Session” takes it live.' : 'The host hasn’t started it yet — check back at the scheduled time.'}`}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Link href="/dashboard" className="inline-flex h-10 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-foreground/5">
            <ArrowLeft className="size-4" /> Back to dashboard
          </Link>
          {ended ? (
            <Link href={`/session/${id}/post`} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-700 px-5 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02]">
              <CheckCircle2 className="size-4" /> Post-conference
            </Link>
          ) : isHost ? (
            <Link href={`/session/${id}/pre`} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-700 px-5 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02]">
              Open prep &amp; go live
            </Link>
          ) : null}
        </div>
      </div>
    )
  }

  return <LiveConference session={view} isHost={isHost} />
}
