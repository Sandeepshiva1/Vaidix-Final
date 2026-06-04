'use client'

// ════════════════════════════════════════════════════════════════════════════
// Faculty Polls Manager — W9.4
// ════════════════════════════════════════════════════════════════════════════
// Lives inside the new "Polls" tab of FacultyPrepPanel. Lets the host:
//   1. AI-suggest 1–3 drafts grounded in objectives + materials
//   2. Add a poll manually (question + 4 options)
//   3. Edit / delete drafts
//   4. Publish to residents → pre-published state; revoke to hide
//   5. See response counts + a bar chart of aggregate answers
//
// Data model: each "poll" is a `LiveHook` row of kind=POLL. The presenter
// can later fire the SAME row live in-session; responses aggregate across
// pre-session and live phases via the existing /respond endpoint.

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Sparkles, Wand2, Loader2, Plus, Trash2, Check, Pencil, AlertCircle, BarChart3, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HookRow {
  id: string
  kind: 'POLL' | 'TRUE_FALSE' | 'ONE_WORD' | 'REPEAT_CONCEPT' | 'DILEMMA'
  prompt: string
  options: string[] | null
  correctOption: string | null
  explanation: string | null
  prePublishedAt: string | null
  firedAt: string | null
  closedAt: string | null
  responseCount: number
  createdAt: string
}

interface SuggestedDraft {
  q: string
  options: string[]
  correct: string | null
}

interface ApiOk<T> { ok: true; data: T }
interface ApiErr { ok: false; error: { code: string; message: string; details?: unknown } }

async function getCsrf(): Promise<string> {
  const m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function jsonReq<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
    if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
    headers.set('x-csrf-token', await getCsrf())
  }
  const res = await fetch(path, { ...init, headers, credentials: 'include' })
  const j = (await res.json()) as ApiOk<T> | ApiErr
  if (!res.ok || !j.ok) {
    const msg = !j.ok ? j.error.message : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return j.data
}

export function PollsManager({ sessionId }: { sessionId: string }) {
  const [hooks, setHooks] = useState<HookRow[]>([])
  const [loading, setLoading] = useState(true)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [suggestRetryAt, setSuggestRetryAt] = useState(0) // seconds remaining
  const [suggestError, setSuggestError] = useState<string | null>(null)

  // Local "compose a new poll" form
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeQ, setComposeQ] = useState('')
  const [composeOptions, setComposeOptions] = useState<string[]>(['', '', '', ''])
  const [composeBusy, setComposeBusy] = useState(false)

  // Edit-in-place state for an existing draft
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editQ, setEditQ] = useState('')
  const [editOptions, setEditOptions] = useState<string[]>([])

  // Show/hide the results bar chart for a published poll
  const [openResultsFor, setOpenResultsFor] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { total: number; counts: Record<string, number> }>>({})

  const refresh = useCallback(async () => {
    try {
      const d = await jsonReq<{ hooks: HookRow[] }>(`/api/classroom/sessions/${sessionId}/hooks`)
      // Show POLL/TRUE_FALSE rows only — ONE_WORD/REPEAT_CONCEPT/DILEMMA are
      // free-form and live-session-only; this manager is for structured
      // pre-session polls so we keep the surface scoped.
      setHooks(d.hooks.filter(h => h.kind === 'POLL' || h.kind === 'TRUE_FALSE'))
    } catch (e) {
      toast.error(`Couldn't load polls: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])

  // Tick the retry countdown each second.
  useEffect(() => {
    if (suggestRetryAt <= 0) return
    const t = setTimeout(() => setSuggestRetryAt(s => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(t)
  }, [suggestRetryAt])

  // ── AI suggest ──
  async function aiSuggest() {
    if (suggestBusy || suggestRetryAt > 0) return
    setSuggestBusy(true)
    setSuggestError(null)
    try {
      const csrf = await getCsrf()
      const res = await fetch(`/api/classroom/sessions/${sessionId}/hooks/suggest`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        credentials: 'include',
      })
      const j = (await res.json()) as ApiOk<{ polls: SuggestedDraft[] }> | (ApiErr & { error: { details?: { retryAfterSeconds?: number } } })
      if (!res.ok || !j.ok) {
        const msg = !j.ok ? j.error.message : `HTTP ${res.status}`
        setSuggestError(msg)
        const retryAfter = (!j.ok && j.error.details?.retryAfterSeconds) || 0
        if (retryAfter > 0) setSuggestRetryAt(retryAfter)
        return
      }
      if (j.data.polls.length === 0) {
        toast.message('AI couldn’t draft polls from this material yet.')
        return
      }
      // Persist each suggestion as a draft hook. Sequential POSTs keep order.
      let created = 0
      for (const draft of j.data.polls) {
        try {
          await jsonReq(`/api/classroom/sessions/${sessionId}/hooks`, {
            method: 'POST',
            body: JSON.stringify({
              kind: 'POLL',
              prompt: draft.q,
              options: draft.options,
              correctOption: draft.correct ?? undefined,
            }),
          })
          created++
        } catch { /* skip individual failures */ }
      }
      if (created > 0) toast.success(`Added ${created} draft${created === 1 ? '' : 's'}`)
      await refresh()
    } catch (e) {
      setSuggestError((e as Error).message)
    } finally {
      setSuggestBusy(false)
    }
  }

  // ── Manual compose ──
  function setComposeOption(i: number, v: string) {
    setComposeOptions(prev => prev.map((o, idx) => idx === i ? v : o))
  }
  async function submitCompose() {
    const q = composeQ.trim()
    const opts = composeOptions.map(o => o.trim()).filter(o => o.length > 0)
    if (q.length < 8) { toast.error('Question is too short'); return }
    if (opts.length < 2) { toast.error('Need at least 2 options'); return }
    setComposeBusy(true)
    try {
      await jsonReq(`/api/classroom/sessions/${sessionId}/hooks`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'POLL', prompt: q, options: opts }),
      })
      setComposeOpen(false)
      setComposeQ('')
      setComposeOptions(['', '', '', ''])
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setComposeBusy(false)
    }
  }

  // ── Edit / Delete ──
  function startEdit(h: HookRow) {
    setEditingId(h.id)
    setEditQ(h.prompt)
    setEditOptions((h.options ?? ['', '', '', '']).slice(0, 8))
  }
  async function saveEdit() {
    if (!editingId) return
    const q = editQ.trim()
    const opts = editOptions.map(o => o.trim()).filter(o => o.length > 0)
    if (q.length < 8 || opts.length < 2) { toast.error('Need a question and at least 2 options'); return }
    try {
      await jsonReq(`/api/classroom/sessions/${sessionId}/hooks/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ prompt: q, options: opts }),
      })
      setEditingId(null)
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  async function deleteHook(id: string) {
    try {
      await jsonReq(`/api/classroom/sessions/${sessionId}/hooks/${id}`, { method: 'DELETE' })
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ── Publish / Revoke ──
  async function publish(id: string) {
    try {
      await jsonReq(`/api/classroom/sessions/${sessionId}/hooks/${id}/pre-publish`, { method: 'POST' })
      toast.success('Published — residents can vote now')
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  async function unpublish(id: string) {
    try {
      await jsonReq(`/api/classroom/sessions/${sessionId}/hooks/${id}/pre-publish`, { method: 'DELETE' })
      toast.success('Hidden from residents (responses kept)')
      await refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ── Results panel ──
  async function toggleResults(id: string) {
    if (openResultsFor === id) {
      setOpenResultsFor(null)
      return
    }
    setOpenResultsFor(id)
    try {
      const r = await jsonReq<{ total: number; counts: Record<string, number> }>(
        `/api/classroom/sessions/${sessionId}/hooks/${id}/results`
      )
      setResults(prev => ({ ...prev, [id]: { total: r.total, counts: r.counts } }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const drafts = hooks.filter(h => !h.prePublishedAt)
  const published = hooks.filter(h => !!h.prePublishedAt)

  return (
    <div className="space-y-5" data-testid="polls-manager">
      {/* Header + CTAs */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Pre-session polls</p>
          <p className="text-[12px] text-muted-foreground/80">Vote-counted multi-choice questions students answer before the session. The same row can be re-fired live in-session.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            data-testid="polls-suggest"
            onClick={() => void aiSuggest()}
            disabled={suggestBusy || suggestRetryAt > 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-700 transition hover:bg-violet-100 disabled:opacity-50 dark:border-violet-800/40 dark:bg-violet-900/20 dark:text-violet-300"
          >
            {suggestBusy
              ? <><Loader2 className="size-3 animate-spin" /> Thinking…</>
              : suggestRetryAt > 0
              ? <>Retry in {suggestRetryAt}s</>
              : <><Wand2 className="size-3" /> Suggest with AI</>}
          </button>
          <button
            data-testid="polls-add"
            onClick={() => setComposeOpen(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-teal-700"
          >
            <Plus className="size-3" /> Add poll
          </button>
        </div>
      </div>

      {suggestError && (
        <div className="flex items-start gap-2 rounded-xl border border-dashed border-amber-300/50 bg-amber-50/50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-700/30 dark:bg-amber-900/10 dark:text-amber-300">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          <span className="flex-1 leading-relaxed">{suggestError}</span>
        </div>
      )}

      {/* Compose form */}
      <AnimatePresence>
        {composeOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-2xl border border-teal-200/60 bg-teal-50/40 p-4 dark:border-teal-800/30 dark:bg-teal-900/10"
          >
            <div className="space-y-2">
              <input
                value={composeQ}
                onChange={e => setComposeQ(e.target.value)}
                placeholder="Question, e.g. First-line workup for granulomatous bilateral uveitis?"
                maxLength={200}
                disabled={composeBusy}
                className="w-full rounded-lg border border-teal-200/70 bg-white px-3 py-2 text-[13px] outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 disabled:opacity-50 dark:border-teal-700/30 dark:bg-card"
                data-testid="polls-compose-question"
              />
              <div className="grid gap-1.5 sm:grid-cols-2">
                {composeOptions.map((o, i) => (
                  <input
                    key={i}
                    value={o}
                    onChange={e => setComposeOption(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    maxLength={80}
                    disabled={composeBusy}
                    className="rounded-lg border border-teal-200/70 bg-white px-3 py-2 text-[12px] outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 disabled:opacity-50 dark:border-teal-700/30 dark:bg-card"
                    data-testid={`polls-compose-option-${i}`}
                  />
                ))}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setComposeOpen(false); setComposeQ(''); setComposeOptions(['', '', '', '']) }}
                  className="rounded-lg border border-border/60 bg-white px-3 py-1.5 text-[11px] font-semibold transition hover:bg-muted dark:bg-card"
                >
                  Cancel
                </button>
                <button
                  data-testid="polls-compose-submit"
                  onClick={() => void submitCompose()}
                  disabled={composeBusy}
                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-50"
                >
                  {composeBusy ? <Loader2 className="size-3 animate-spin" /> : 'Save as draft'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Draft list */}
      {loading ? (
        <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" /> Loading polls…</p>
      ) : (
        <>
          {drafts.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Drafts · {drafts.length}</p>
              <ul className="space-y-2">
                {drafts.map(h => (
                  <PollRow
                    key={h.id}
                    hook={h}
                    isEditing={editingId === h.id}
                    editQ={editQ}
                    setEditQ={setEditQ}
                    editOptions={editOptions}
                    setEditOptions={setEditOptions}
                    onEdit={() => startEdit(h)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={saveEdit}
                    onDelete={() => void deleteHook(h.id)}
                    onPublish={() => void publish(h.id)}
                  />
                ))}
              </ul>
            </div>
          )}

          {published.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Published · {published.length}</p>
              <ul className="space-y-2">
                {published.map(h => (
                  <li key={h.id} className="rounded-xl border border-emerald-300/40 bg-emerald-50/40 px-3.5 py-3 dark:border-emerald-700/30 dark:bg-emerald-900/10">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-emerald-200 text-[10px] font-bold text-emerald-800 dark:bg-emerald-800/40 dark:text-emerald-200">✓</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold leading-relaxed text-foreground">{h.prompt}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {(h.options ?? []).join(' · ')}
                        </p>
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                          {h.responseCount} {h.responseCount === 1 ? 'response' : 'responses'}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          onClick={() => void toggleResults(h.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-foreground transition hover:bg-muted dark:bg-card"
                          title="Show results"
                        >
                          <BarChart3 className="size-3" /> {openResultsFor === h.id ? 'Hide' : 'Results'}
                        </button>
                        <button
                          onClick={() => void unpublish(h.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[10px] font-bold text-amber-700 transition hover:bg-amber-50 dark:border-amber-700/40 dark:bg-card"
                          title="Hide from students (keeps responses)"
                        >
                          <EyeOff className="size-3" /> Hide
                        </button>
                      </div>
                    </div>
                    {openResultsFor === h.id && results[h.id] && (
                      <ResultsBars
                        options={h.options ?? []}
                        total={results[h.id].total}
                        counts={results[h.id].counts}
                        correctOption={h.correctOption}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {drafts.length === 0 && published.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/60 py-6 text-center">
              <Sparkles className="mx-auto mb-1.5 size-5 text-violet-500" />
              <p className="text-sm font-medium text-muted-foreground">No polls yet</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">Tap “Suggest with AI” or “Add poll” to start.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PollRow({ hook, isEditing, editQ, setEditQ, editOptions, setEditOptions, onEdit, onCancelEdit, onSaveEdit, onDelete, onPublish }: {
  hook: HookRow
  isEditing: boolean
  editQ: string
  setEditQ: (v: string) => void
  editOptions: string[]
  setEditOptions: (v: string[]) => void
  onEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
  onPublish: () => void
}) {
  return (
    <motion.li layout className="rounded-xl border border-border/60 bg-card px-3.5 py-3">
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editQ}
            onChange={e => setEditQ(e.target.value)}
            rows={2}
            maxLength={200}
            className="w-full resize-none rounded-lg border border-teal-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 dark:bg-card"
          />
          <div className="grid gap-1.5 sm:grid-cols-2">
            {editOptions.map((o, i) => (
              <input
                key={i}
                value={o}
                onChange={e => setEditOptions(editOptions.map((x, idx) => idx === i ? e.target.value : x))}
                placeholder={`Option ${i + 1}`}
                maxLength={80}
                className="rounded-lg border border-border/60 bg-white px-3 py-2 text-[12px] outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 dark:bg-card"
              />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onCancelEdit} className="rounded-lg border border-border/60 bg-white px-3 py-1.5 text-[11px] font-semibold transition hover:bg-muted dark:bg-card">Cancel</button>
            <button onClick={onSaveEdit} className="rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-teal-700">
              <Check className="mr-1 inline size-3" /> Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[10px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">📊</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-relaxed text-foreground">{hook.prompt}</p>
            <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
              {(hook.options ?? []).map((o, i) => (
                <li key={i} className={cn('rounded-md bg-muted/60 px-2 py-0.5 text-[11px]', hook.correctOption === o ? 'border border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300' : 'text-muted-foreground')}>
                  {String.fromCharCode(65 + i)}. {o}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <button onClick={onPublish} className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-amber-600" data-testid="polls-publish">
              <Eye className="size-3" /> Publish
            </button>
            <button onClick={onEdit} className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"><Pencil className="size-3.5" /></button>
            <button onClick={onDelete} className="rounded-lg p-1 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-3.5" /></button>
          </div>
        </div>
      )}
    </motion.li>
  )
}

function ResultsBars({ options, total, counts, correctOption }: { options: string[]; total: number; counts: Record<string, number>; correctOption: string | null }) {
  if (total === 0) {
    return <p className="mt-3 text-[11px] text-muted-foreground">No responses yet.</p>
  }
  return (
    <div className="mt-3 space-y-1.5" data-testid="polls-results">
      {options.map(opt => {
        const c = counts[opt] ?? 0
        const pct = Math.round((c / total) * 100)
        const correct = correctOption === opt
        return (
          <div key={opt} className="flex items-center gap-2">
            <span className={cn('w-1/2 truncate text-[11px]', correct ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-foreground')}>{opt}</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn('absolute inset-y-0 left-0 rounded-full transition-all', correct ? 'bg-emerald-500' : 'bg-violet-500')} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-10 shrink-0 text-right text-[10px] font-mono tabular-nums text-muted-foreground">{c} · {pct}%</span>
          </div>
        )
      })}
    </div>
  )
}
