'use client'

import Link from 'next/link'
import { ArrowLeft, CalendarDays, Clock3 } from 'lucide-react'

// Reproduction of the demo SessionHeader (components/demo/session-header.tsx)
// for the real session-workflow screens.
export function WorkflowHeader({
  title,
  date,
  time,
  duration,
  specialty,
  type,
  backHref = '/dashboard',
  eyebrow,
}: {
  title: string
  date: string // YYYY-MM-DD
  time: string
  duration: number
  specialty: string
  type: string
  backHref?: string
  eyebrow?: string
}) {
  const longDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
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
        <h1 className="mt-0.5 text-[24px] font-semibold leading-tight tracking-tight">{title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />{longDate}</span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />{time} · {duration} min</span>
          <span className="text-border">·</span>
          <span>{specialty}</span>
          <span className="text-border">·</span>
          <span>{type}</span>
        </div>
      </div>
    </div>
  )
}
