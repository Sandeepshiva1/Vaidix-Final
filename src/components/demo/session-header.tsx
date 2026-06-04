'use client'

import Link from 'next/link'
import { ArrowLeft, CalendarDays, Clock3 } from 'lucide-react'
import type { DemoSession } from './demo-state'
import { formatDemoDate } from './date'

export function SessionHeader({
  session,
  backHref = '/demo',
  eyebrow,
}: {
  session: DemoSession
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
            {formatDemoDate(session.date, { weekday: 'long', month: 'short', day: 'numeric' })}
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
