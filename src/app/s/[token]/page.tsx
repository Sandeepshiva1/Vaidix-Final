// ════════════════════════════════════════════════════════════════════════════
// Public Session Share Page  ·  /s/[token]
// ════════════════════════════════════════════════════════════════════════════
// Unauthenticated, read-only landing for a session. Anyone with the link sees
// the title, host, when, objectives and tags, plus a "Sign in to attend" CTA.
// No Vaidix account required to VIEW (joining the live room still needs sign-in).

import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays, Clock, User, Target, Tag } from 'lucide-react'
import {
  getPublicSessionByToken,
  SessionShareError,
  type PublicSessionView,
} from '@/server/services/sessions/session-share-service'

type Params = Promise<{ token: string }>
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token } = await params
  try {
    const v = await getPublicSessionByToken(token, { countAccess: false })
    return {
      title: `${v.title} · Vaidix`,
      description: v.description ?? `Clinical teaching session with ${v.hostName}.`,
      openGraph: { title: v.title, description: v.description ?? undefined, type: 'website' },
    }
  } catch {
    return { title: 'Session link · Vaidix' }
  }
}

function fmtWhen(startISO: string, endISO: string): { date: string; time: string } {
  const start = new Date(startISO)
  const end = new Date(endISO)
  return {
    date: start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    time: `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`,
  }
}

export default async function SessionSharePage({ params }: { params: Params }) {
  const { token } = await params
  let view: PublicSessionView
  try {
    view = await getPublicSessionByToken(token)
  } catch (err) {
    if (err instanceof SessionShareError) {
      if (err.code === 'NOT_FOUND') return notFound()
      return <StateFrame heading={err.code === 'EXPIRED' ? 'This link has expired' : 'This link was revoked'} message={err.message} />
    }
    throw err
  }

  const when = fmtWhen(view.scheduledStart, view.scheduledEnd)
  const attendHref = `/login?next=${encodeURIComponent(`/classroom/${view.sessionId}`)}`

  return (
    <main className="min-h-screen bg-linear-to-b from-slate-50 to-teal-50/40 px-5 py-10 dark:from-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2 text-[13px] font-bold uppercase tracking-widest text-teal-700 dark:text-teal-300">
          <span className="grid size-7 place-items-center rounded-lg bg-teal-600 text-white">V</span>
          Vaidix
        </div>

        <div className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[0_10px_40px_-20px_rgba(0,0,0,0.3)]">
          <div className="bg-linear-to-r from-teal-500/10 via-emerald-500/5 to-transparent px-7 pt-7 pb-5">
            {view.tags.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {view.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-teal-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-teal-700 dark:text-teal-300">
                    <Tag className="size-3" />{t}
                  </span>
                ))}
              </div>
            )}
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-foreground">{view.title}</h1>
            {view.description && <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{view.description}</p>}
          </div>

          <div className="space-y-4 px-7 py-6">
            <Detail icon={<CalendarDays className="size-4" />} label="Date" value={when.date} />
            <Detail icon={<Clock className="size-4" />} label="Time" value={when.time} />
            <Detail icon={<User className="size-4" />} label="Host" value={view.hostName} sub={view.hostRole ?? view.programLabel ?? undefined} />

            {view.objectives.length > 0 && (
              <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                  <Target className="size-3.5" /> Learning objectives
                </div>
                <ul className="space-y-1.5">
                  {view.objectives.map((o, i) => (
                    <li key={i} className="flex gap-2 text-[13.5px] text-foreground/90">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-500" />{o.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-t border-border/60 bg-muted/30 px-7 py-5">
            <Link
              href={attendHref}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-teal-600 px-6 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-teal-500"
            >
              Sign in to attend
            </Link>
            <p className="mt-2.5 text-center text-[11.5px] text-muted-foreground">
              You'll need a Vaidix account to join the live session.
            </p>
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-muted-foreground/70">
          Shared via Vaidix · Clinical Teaching OS
        </p>
      </div>
    </main>
  )
}

function Detail({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-teal-500/10 text-teal-700 dark:text-teal-300">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-[14.5px] font-semibold text-foreground">{value}</div>
        {sub && <div className="text-[12.5px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  )
}

function StateFrame({ heading, message }: { heading: string; message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-6">
      <div className="max-w-md text-center">
        <div className="mb-4 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/70">Vaidix</div>
        <h1 className="mb-2 text-2xl font-bold text-white">{heading}</h1>
        <p className="mb-6 text-sm text-white/60">{message}</p>
        <p className="text-xs text-white/40">Ask the session host for an updated link.</p>
      </div>
    </main>
  )
}
