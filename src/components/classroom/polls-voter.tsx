'use client'

// ════════════════════════════════════════════════════════════════════════════
// Resident Polls Voter
// ════════════════════════════════════════════════════════════════════════════
// Renders inside the new "Poll" tab on the resident Study Hub. Lists the
// pre-published polls for the session, lets the resident cast one vote per
// poll, and reveals the aggregate bar chart only AFTER they vote
// (Mentimeter-style — prevents anchoring on majority opinion).

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Loader2, Check, BarChart3, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PollHook {
  id: string
  prompt: string
  options: string[] | null
  correctOption: string | null
  explanation: string | null
  prePublishedAt: string | null
  closedAt: string | null
  responseCount: number
}

interface PollResults {
  total: number
  counts: Record<string, number>
  myAnswer: string | null
  closedAt: string | null
}

interface ApiOk<T> { ok: true; data: T }
interface ApiErr { ok: false; error: { code: string; message: string } }

async function getCsrf(): Promise<string> {
  const m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export function PollsVoter({ sessionId }: { sessionId: string }) {
  const [polls, setPolls] = useState<PollHook[]>([])
  const [loading, setLoading] = useState(true)
  const [results, setResults] = useState<Record<string, PollResults>>({})
  const [voting, setVoting] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({}) // hookId → selected option (pre-submit)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/hooks?prePublished=true`, {
        credentials: 'include',
      })
      const j = (await res.json()) as ApiOk<{ hooks: PollHook[] }> | ApiErr
      if (j.ok) {
        // Show only structured (POLL/TRUE_FALSE) for the resident voter UI.
        // Other kinds may exist for live-session use only.
        const list = (j.data.hooks as Array<PollHook & { kind?: string }>).filter(
          (h) => !h.kind || h.kind === 'POLL' || h.kind === 'TRUE_FALSE'
        )
        setPolls(list)
        // Eagerly fetch results for any poll the resident has already
        // answered. The route 403s if the user hasn't voted; we ignore that
        // here and only populate the ones the server returns.
        for (const p of list) {
          try {
            const rRes = await fetch(`/api/classroom/sessions/${sessionId}/hooks/${p.id}/results`, {
              credentials: 'include',
            })
            if (!rRes.ok) continue
            const rJson = (await rRes.json()) as ApiOk<PollResults> | ApiErr
            if (rJson.ok && rJson.data.myAnswer !== null) {
              setResults(prev => ({ ...prev, [p.id]: rJson.data }))
            }
          } catch { /* per-poll failure is non-critical */ }
        }
      }
    } catch (e) {
      toast.error(`Couldn't load polls: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])

  async function vote(hookId: string, option: string) {
    if (voting) return
    setVoting(hookId)
    try {
      const csrf = await getCsrf()
      const res = await fetch(`/api/classroom/sessions/${sessionId}/hooks/${hookId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        credentials: 'include',
        body: JSON.stringify({ response: option }),
      })
      const j = (await res.json()) as ApiOk<{ isCorrect: boolean | null }> | ApiErr
      if (!res.ok || !j.ok) {
        toast.error(!j.ok ? j.error.message : `HTTP ${res.status}`)
        return
      }
      // Fetch results now that the resident has voted.
      const rRes = await fetch(`/api/classroom/sessions/${sessionId}/hooks/${hookId}/results`, {
        credentials: 'include',
      })
      if (rRes.ok) {
        const rJson = (await rRes.json()) as ApiOk<PollResults>
        if (rJson.ok) setResults(prev => ({ ...prev, [hookId]: rJson.data }))
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setVoting(null)
    }
  }

  if (loading) {
    return <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" /> Loading polls…</p>
  }
  if (polls.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 py-10 text-center">
        <BarChart3 className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="text-sm font-medium text-muted-foreground">No polls yet</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">The presenter hasn’t published any pre-session polls. Check back closer to the session.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="polls-voter">
      {polls.map((p, idx) => {
        const r = results[p.id]
        const myAnswer = r?.myAnswer ?? null
        const hasVoted = myAnswer !== null
        const isClosed = !!p.closedAt
        const selected = pending[p.id]

        return (
          <motion.div key={p.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-3 flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[11px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{idx + 1}</span>
              <p className="flex-1 text-[14px] font-semibold leading-snug text-foreground">{p.prompt}</p>
              {isClosed && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground"><Lock className="size-2.5" /> Closed</span>}
            </div>

            {hasVoted || isClosed ? (
              <ResultsView poll={p} results={r} />
            ) : (
              <div className="space-y-1.5">
                {(p.options ?? []).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setPending(prev => ({ ...prev, [p.id]: opt }))}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[13px] transition',
                      selected === opt
                        ? 'border-violet-400 bg-violet-50 text-violet-900 dark:border-violet-600 dark:bg-violet-900/30 dark:text-violet-100'
                        : 'border-border/60 bg-background hover:border-violet-300 hover:bg-violet-50/50 dark:bg-card dark:hover:bg-violet-900/10'
                    )}
                  >
                    <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                      selected === opt
                        ? 'border-violet-400 bg-violet-500 text-white'
                        : 'border-border text-muted-foreground'
                    )}>
                      {selected === opt ? <Check className="size-3" /> : null}
                    </span>
                    <span className="flex-1">{opt}</span>
                  </button>
                ))}
                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-[10px] text-muted-foreground">One vote per student. You can’t change it after submitting.</p>
                  <button
                    data-testid={`polls-submit-${p.id}`}
                    onClick={() => selected && void vote(p.id, selected)}
                    disabled={!selected || voting === p.id}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-1.5 text-[12px] font-bold text-white transition hover:bg-violet-700 disabled:opacity-50"
                  >
                    {voting === p.id ? <Loader2 className="size-3 animate-spin" /> : 'Submit vote'}
                  </button>
                </div>
              </div>
            )}
            <AnimatePresence>
              {hasVoted && p.explanation && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="mt-3 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200">
                  <span className="mr-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">Why:</span>
                  {p.explanation}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}
    </div>
  )
}

function ResultsView({ poll, results }: { poll: PollHook; results?: PollResults }) {
  if (!results) return <p className="text-[11px] text-muted-foreground">Loading aggregate…</p>
  const total = results.total
  return (
    <div className="space-y-1.5">
      {(poll.options ?? []).map((opt) => {
        const c = results.counts[opt] ?? 0
        const pct = total === 0 ? 0 : Math.round((c / total) * 100)
        const isMine = results.myAnswer === opt
        const isCorrect = poll.correctOption === opt
        return (
          <div key={opt} className={cn('rounded-xl border px-3 py-2 transition',
            isMine ? 'border-violet-400 bg-violet-50/60 dark:border-violet-600 dark:bg-violet-900/20' : 'border-border/60 bg-background dark:bg-card'
          )}>
            <div className="flex items-center gap-2">
              <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                isCorrect ? 'bg-emerald-500 text-white' : isMine ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground'
              )}>
                {isCorrect ? <Check className="size-3" /> : isMine ? '·' : ''}
              </span>
              <span className={cn('flex-1 text-[13px]', isMine && 'font-semibold')}>{opt}</span>
              <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{c} · {pct}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full transition-all',
                isCorrect ? 'bg-emerald-500' : isMine ? 'bg-violet-500' : 'bg-muted-foreground/30'
              )} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
      <p className="text-[10px] text-muted-foreground">{total} {total === 1 ? 'student has' : 'students have'} answered.</p>
    </div>
  )
}
