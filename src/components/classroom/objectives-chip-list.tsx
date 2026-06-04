'use client'

// ════════════════════════════════════════════════════════════════════════════
// ObjectivesChipList — read-only display of session learning objectives
// ════════════════════════════════════════════════════════════════════════════
// Shown on session detail surfaces (resident pre-session prep block, curator
// prep block read-only fallback, recording page header). Each row carries the
// objective text + a Bloom's level badge. If the resident has self-marked the
// objective post-session, a small status dot indicates YES/PARTLY/NO.

import { motion } from 'framer-motion'
import { Target, Check, CircleDashed, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ObjectiveStatus = 'YES' | 'PARTLY' | 'NO' | null

export interface ObjectiveRow {
  id: string
  text: string
  blooms: number
  myStatus?: ObjectiveStatus
}

const BLOOMS_LABELS: Record<number, string> = {
  1: 'Remember',
  2: 'Understand',
  3: 'Apply',
  4: 'Analyse',
  5: 'Evaluate',
  6: 'Create',
}

const BLOOMS_BADGE_CLASS: Record<number, string> = {
  1: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
  2: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  3: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
  4: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  5: 'bg-purple-500/10 text-purple-700 dark:text-purple-300',
  6: 'bg-pink-500/10 text-pink-700 dark:text-pink-300',
}

interface Props {
  objectives: ObjectiveRow[]
  variant?: 'default' | 'compact'
  className?: string
}

export function ObjectivesChipList({ objectives, variant = 'default', className }: Props) {
  if (objectives.length === 0) return null

  return (
    <div className={cn('space-y-2', className)} data-testid="objectives-chip-list">
      {variant === 'default' && (
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Target className="size-3.5 text-primary" />
          Learning objectives
        </div>
      )}
      <ul className="space-y-1.5">
        {objectives.map((o, idx) => (
          <motion.li
            key={o.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(idx * 0.03, 0.2), duration: 0.25 }}
            className="flex items-start gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
          >
            <StatusDot status={o.myStatus ?? null} />
            <p className="flex-1 text-sm leading-snug text-foreground">{o.text}</p>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                BLOOMS_BADGE_CLASS[o.blooms] ?? BLOOMS_BADGE_CLASS[2]
              )}
              title={`Bloom's level ${o.blooms}`}
            >
              {BLOOMS_LABELS[o.blooms] ?? `L${o.blooms}`}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

function StatusDot({ status }: { status: ObjectiveStatus }) {
  if (status === 'YES') {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
        title="You marked this as achieved"
      >
        <Check className="size-2.5" />
      </span>
    )
  }
  if (status === 'PARTLY') {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400"
        title="You marked this as partly achieved"
      >
        <CircleDashed className="size-2.5" />
      </span>
    )
  }
  if (status === 'NO') {
    return (
      <span
        className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-400"
        title="You marked this as not achieved"
      >
        <X className="size-2.5" />
      </span>
    )
  }
  return (
    <span
      className="mt-1.5 inline-flex size-1.5 shrink-0 rounded-full bg-muted-foreground/30"
      aria-hidden
    />
  )
}
