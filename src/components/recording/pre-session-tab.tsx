'use client'

// Pre-session context tab — shown in recording review page
// Displays session objectives (read-only) + pre-session questions (sorted by votes)
// Always rendered even when empty, so learners can see what was planned.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowUp, MessageCircleReply, Target, Loader2,
  ClipboardList, CircleSlash,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChecklistObjective } from '@/components/classroom/objectives-checklist'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PreReply {
  id: string
  authorName: string
  content: string
  createdAt: string
}

interface PreQView {
  id: string
  authorName: string
  content: string
  urgency: 'LOW' | 'NORMAL' | 'HIGH'
  voteCount: number
  votedByMe: boolean
  themeLabel: string | null
  isPresenter: boolean
  createdAt: string
  replies: PreReply[]
}

interface Props {
  sessionId: string
  objectives: ChecklistObjective[]
}

const BLOOMS: Record<number, string> = {
  1: 'Remember', 2: 'Understand', 3: 'Apply',
  4: 'Analyse', 5: 'Evaluate', 6: 'Create',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PreSessionTab({ sessionId, objectives }: Props) {
  const [questions, setQuestions] = useState<PreQView[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(
          `/api/classroom/sessions/${sessionId}/pre-questions`,
          { credentials: 'include' },
        )
        const json = await res.json()
        if (json.ok) setQuestions(json.data.items)
      } finally {
        setLoading(false)
      }
    })()
  }, [sessionId])

  const sorted = [...questions].sort((a, b) => b.voteCount - a.voteCount)

  return (
    <div className="space-y-6">

      {/* ── Objectives (context, read-only) ── */}
      <section>
        <SectionHeader
          icon={<Target className="size-3.5 text-primary" />}
          label="Session Objectives"
          count={objectives.length}
        />
        {objectives.length === 0 ? (
          <EmptyBlock message="No learning objectives were set for this session." />
        ) : (
          <ul className="mt-3 space-y-2">
            {objectives.map((o, idx) => (
              <motion.li
                key={o.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.04, 0.2), duration: 0.2 }}
                className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3"
              >
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {idx + 1}
                </div>
                <div className="min-w-0">
                  <p className="text-sm leading-snug text-foreground">{o.text}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Bloom&apos;s {o.blooms} · {BLOOMS[o.blooms] ?? `Level ${o.blooms}`}
                  </p>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Pre-session questions ── */}
      <section>
        <SectionHeader
          icon={<ClipboardList className="size-3.5 text-amber-600 dark:text-amber-400" />}
          label="Pre-session Questions"
          count={questions.length}
          countColor="amber"
        />
        {loading ? (
          <div className="mt-4 flex items-center justify-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary/50" />
            <span className="text-xs">Loading questions…</span>
          </div>
        ) : sorted.length === 0 ? (
          <EmptyBlock message="No questions were submitted before this session." />
        ) : (
          <ul className="mt-3 space-y-2">
            {sorted.map((q, idx) => (
              <motion.li
                key={q.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.05, 0.3), duration: 0.2 }}
                className="rounded-xl border border-amber-500/25 border-l-2 border-l-amber-500/60 bg-card p-3.5 shadow-sm"
              >
                {/* Metadata row */}
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400">
                    PRE
                  </span>
                  {q.urgency === 'HIGH' && (
                    <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold text-rose-600 ring-1 ring-rose-500/20 dark:text-rose-400">
                      URGENT
                    </span>
                  )}
                  {q.themeLabel && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {q.themeLabel}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-0.5 text-xs font-semibold text-amber-600/80 dark:text-amber-400/70">
                    <ArrowUp className="size-3" />
                    {q.voteCount}
                  </span>
                </div>

                {/* Question */}
                <p className="text-sm leading-relaxed text-foreground">{q.content}</p>

                {/* Footer */}
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="font-medium">{q.authorName}</span>
                  {q.replies.length > 0 && (
                    <span className="flex items-center gap-1">
                      <MessageCircleReply className="size-3" />
                      {q.replies.length} {q.replies.length === 1 ? 'reply' : 'replies'}
                    </span>
                  )}
                </div>

                {/* Replies */}
                {q.replies.length > 0 && (
                  <ul className="mt-2 space-y-1 border-l-2 border-amber-500/20 pl-3">
                    {q.replies.map((r) => (
                      <li key={r.id} className="text-xs">
                        <span className="font-semibold text-foreground">{r.authorName}: </span>
                        <span className="text-muted-foreground">{r.content}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionHeader({
  icon, label, count, countColor = 'primary',
}: {
  icon: React.ReactNode
  label: string
  count: number
  countColor?: 'primary' | 'amber'
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-sm font-bold tracking-tight">{label}</h3>
      {count > 0 && (
        <span className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
          countColor === 'amber'
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            : 'bg-primary/10 text-primary',
        )}>
          {count}
        </span>
      )}
    </div>
  )
}

function EmptyBlock({ message }: { message: string }) {
  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-7 text-center">
      <CircleSlash className="size-5 text-muted-foreground/40" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}
