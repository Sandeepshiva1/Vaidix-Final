'use client'

// Demo-exact session header (ported pixel-for-pixel from the prototype's
// components/demo/session-header.tsx) but fed by REAL session data. Used by the
// pre-conference workflow step pages so they match the demo precisely.

import Link from 'next/link'
import { ArrowLeft, CalendarDays, Clock3 } from 'lucide-react'

export function SessionHeader({
  session,
  backHref = '/dashboard',
  eyebrow,
}: {
  session: { title: string; date: string; time: string; duration: string | number; specialty: string; type: string }
  backHref?: string
  eyebrow?: string
}) {
  return (
    <div className="mb-6 flex items-start gap-3">
      <Link
        href={backHref}
        className="mt-1 grid size-9 shrink-0 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
      </Link>
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] font-semibold tracking-widest text-teal-700/80 uppercase dark:text-teal-300/80">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-0.5 text-[24px] font-semibold leading-tight tracking-tight">{session.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5" />
            {fmtDate(session.date)}
          </span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" />
            {session.time} · {session.duration} min
          </span>
          <span className="text-border">·</span>
          <span>{session.specialty}</span>
          <span className="text-border">·</span>
          <span>{session.type}</span>
        </div>
      </div>
    </div>
  )
}

function fmtDate(iso: string): string {
  try {
    // Fixed locale so server and client render identically (avoids hydration
    // mismatch — the prototype was client-only so it could use the system locale).
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}
