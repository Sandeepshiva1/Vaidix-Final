'use client'

// ════════════════════════════════════════════════════════════════════════════
// ObjectivesChecklist — resident post-session self-mark UI
// ════════════════════════════════════════════════════════════════════════════
// Renders one row per objective with three buttons (Yes / Partly / No). Each
// click POSTs to /api/classroom/sessions/[id]/objectives/check; the row
// optimistically reflects the new status and reverts on failure.

import { useState, useTransition } from 'react'
import { motion } from 'framer-motion'
import { Check, CircleDashed, X, Target, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Status = 'YES' | 'PARTLY' | 'NO'

export interface ChecklistObjective {
  id: string
  text: string
  blooms: number
  myStatus: Status | null
}

interface Props {
  sessionId: string
  initial: ChecklistObjective[]
}

const BLOOMS_LABELS: Record<number, string> = {
  1: 'Remember',
  2: 'Understand',
  3: 'Apply',
  4: 'Analyse',
  5: 'Evaluate',
  6: 'Create',
}

async function getCsrf(): Promise<string> {
  const m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function postMark(sessionId: string, objectiveId: string, status: Status) {
  const res = await fetch(`/api/classroom/sessions/${sessionId}/objectives/check`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': await getCsrf(),
    },
    body: JSON.stringify({ objectiveId, status }),
  })
  const json = (await res.json()) as { ok: boolean; error?: { message?: string } }
  if (!res.ok || !json.ok) {
    throw new Error(json.error?.message ?? `HTTP ${res.status}`)
  }
}

export function ObjectivesChecklist({ sessionId, initial }: Props) {
  const [rows, setRows] = useState(initial)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (rows.length === 0) return null

  const completed = rows.filter((r) => r.myStatus !== null).length

  function setStatus(objectiveId: string, status: Status) {
    const prevRow = rows.find((r) => r.id === objectiveId)
    if (!prevRow) return
    const prevStatus = prevRow.myStatus
    setRows((rs) => rs.map((r) => (r.id === objectiveId ? { ...r, myStatus: status } : r)))
    setBusyId(objectiveId)
    startTransition(async () => {
      try {
        await postMark(sessionId, objectiveId, status)
      } catch (e) {
        setRows((rs) =>
          rs.map((r) => (r.id === objectiveId ? { ...r, myStatus: prevStatus } : r))
        )
        toast.error(`Could not save: ${(e as Error).message}`)
      } finally {
        setBusyId(null)
      }
    })
  }

  return (
    <div
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
      data-testid="objectives-checklist"
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-primary" />
          <h3 className="text-sm font-bold tracking-tight">Did you achieve these?</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {completed} of {rows.length} marked
        </p>
      </header>

      <ul className="space-y-2">
        {rows.map((o, idx) => (
          <motion.li
            key={o.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(idx * 0.04, 0.25), duration: 0.22 }}
            className="grid gap-2 rounded-xl border border-border/70 bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="space-y-0.5">
              <p className="text-sm leading-snug text-foreground">{o.text}</p>
              <p className="text-[11px] text-muted-foreground">
                Bloom&rsquo;s {o.blooms} · {BLOOMS_LABELS[o.blooms] ?? `Level ${o.blooms}`}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <StatusButton
                label="Yes"
                tone="emerald"
                icon={<Check className="size-3.5" />}
                active={o.myStatus === 'YES'}
                disabled={busyId === o.id}
                onClick={() => setStatus(o.id, 'YES')}
              />
              <StatusButton
                label="Partly"
                tone="amber"
                icon={<CircleDashed className="size-3.5" />}
                active={o.myStatus === 'PARTLY'}
                disabled={busyId === o.id}
                onClick={() => setStatus(o.id, 'PARTLY')}
              />
              <StatusButton
                label="No"
                tone="rose"
                icon={<X className="size-3.5" />}
                active={o.myStatus === 'NO'}
                disabled={busyId === o.id}
                onClick={() => setStatus(o.id, 'NO')}
              />
              {busyId === o.id && (
                <Loader2 className="ml-1 size-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

function StatusButton({
  label,
  icon,
  tone,
  active,
  disabled,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  tone: 'emerald' | 'amber' | 'rose'
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const activeClass = {
    emerald: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-400',
    amber:   'bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400',
    rose:    'bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:text-rose-400',
  }[tone]

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-60',
        active
          ? `${activeClass} ring-1`
          : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </motion.button>
  )
}
