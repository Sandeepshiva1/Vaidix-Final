'use client'

// ════════════════════════════════════════════════════════════════════════════
// PostSessionInsightsPanel — W8.3 frontend
// ════════════════════════════════════════════════════════════════════════════
// Renders below LiveSession on the session detail page once a transcript is
// finalized. Shows:
//   • Download transcript PDF (any session-visible role)
//   • Tabs: Pearls / Q&A / SJT / PBL
//   • Regenerate button (HOST/PD/ADMIN — POST /post-session)
//
// The actual API gate is server-side; the button is hidden client-side as a
// hint, not a security boundary.

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Gem, MessageSquare, Brain, Lightbulb, Loader2, RefreshCw, CheckCircle2, Sparkles } from 'lucide-react'
import { csrfHeaders } from '@/lib/csrf-client'
import { cn } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Pearl { id: string; title: string; body: string; approved: boolean; createdAt: string }
interface Qa { id: string; question: string; answer: string; createdAt: string }
interface Sjt {
  id: string; stem: string; options: string[] | unknown;
  correctIndex: number | null; rationale: string; createdAt: string;
}
interface Pbl {
  id: string; trigger: string; objectives: string[] | unknown;
  content: string; createdAt: string;
}

interface PostSessionData {
  transcriptId: string
  finalized: boolean
  finalizedAt: string | null
  pearls: Pearl[]
  qaPairs: Qa[]
  sjtCases: Sjt[]
  pblScenarios: Pbl[]
}

interface Props {
  sessionId: string
  canTrigger: boolean
}

const TABS = [
  { id: 'pearls', label: 'Pearls', icon: Gem },
  { id: 'qa', label: 'Q&A', icon: MessageSquare },
  { id: 'sjt', label: 'SJT', icon: Brain },
  { id: 'pbl', label: 'PBL', icon: Lightbulb },
] as const
type TabId = (typeof TABS)[number]['id']

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PostSessionInsightsPanel({ sessionId, canTrigger }: Props) {
  const [data, setData] = useState<PostSessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('pearls')
  const [triggering, setTriggering] = useState(false)
  const [triggered, setTriggered] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await fetch(`/api/classroom/sessions/${sessionId}/post-session`)
        const j = (await r.json()) as { ok: boolean; data?: PostSessionData; error?: { message: string } }
        if (cancelled) return
        if (!j.ok) {
          setError(j.error?.message ?? `Failed to load (${r.status})`)
        } else if (j.data) {
          setData(j.data)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sessionId])

  async function handleRegenerate() {
    setTriggering(true)
    setTriggered(false)
    try {
      // Bootstrap the vaidix-csrf cookie if this is the user's first mutation
      // since landing — middleware refreshes it on every request, but if the
      // user came in via SSR and hasn't made any prior fetch the cookie may
      // not be there yet. Same pattern as role-context.tsx switchProgram.
      if (!document.cookie.match(/(?:^|;\s*)vaidix-csrf=/)) {
        await fetch('/api/csrf', { credentials: 'include', cache: 'no-store' })
      }
      const r = await fetch(`/api/classroom/sessions/${sessionId}/post-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        credentials: 'include',
        body: '{}',
      })
      const j = (await r.json()) as { ok: boolean; data?: { queued: boolean } }
      if (j.ok && j.data?.queued) setTriggered(true)
      else setError(`Regenerate failed (${r.status})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setTriggering(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading session insights…
        </div>
      </div>
    )
  }

  // No transcript at all — don't render anything (session never had captions).
  if (!data || !data.finalized) return null

  const totalContent =
    data.pearls.length + data.qaPairs.length + data.sjtCases.length + data.pblScenarios.length

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      data-testid="post-session-insights"
    >
      {/* Gradient header */}
      <div className="relative border-b border-border/60 bg-linear-to-br from-primary/10 via-violet-500/5 to-fuchsia-500/10 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-primary to-fuchsia-500 text-white shadow-md">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Session insights</h2>
              <p className="text-[11px] text-muted-foreground">
                AI-extracted from the live transcript
                {data.finalizedAt ? ` · finalized ${new Date(data.finalizedAt).toLocaleString('en-IN')}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`/api/classroom/sessions/${sessionId}/captions/transcript/export-pdf`}
              data-testid="download-transcript-pdf"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/20 transition-all hover:bg-primary/20"
            >
              <FileText className="size-3.5" />
              Download transcript PDF
            </a>

            {canTrigger && (
              <motion.button
                onClick={handleRegenerate}
                disabled={triggering}
                whileTap={{ scale: 0.94 }}
                data-testid="regenerate-insights"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-50',
                  triggered
                    ? 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground ring-1 ring-border hover:bg-muted/70 hover:text-foreground'
                )}
              >
                {triggering ? <Loader2 className="size-3.5 animate-spin" /> :
                 triggered ? <CheckCircle2 className="size-3.5" /> :
                 <RefreshCw className="size-3.5" />}
                {triggering ? 'Queueing…' : triggered ? 'Queued' : 'Regenerate'}
              </motion.button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-5 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {totalContent === 0 ? (
        <EmptyState canTrigger={canTrigger} />
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center border-b border-border/60 px-3">
            {TABS.map((tab) => {
              const count =
                tab.id === 'pearls' ? data.pearls.length :
                tab.id === 'qa' ? data.qaPairs.length :
                tab.id === 'sjt' ? data.sjtCases.length :
                data.pblScenarios.length
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  data-testid={`insights-tab-${tab.id}`}
                  className={cn(
                    'relative flex items-center gap-1.5 px-3.5 pb-3 pt-2.5 text-xs font-semibold transition-colors',
                    activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80'
                  )}
                >
                  <tab.icon className="size-3.5" />
                  {tab.label}
                  {count > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      {count}
                    </span>
                  )}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="insights-underline"
                      className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-linear-to-r from-primary to-fuchsia-500"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="px-5 py-4"
            >
              {activeTab === 'pearls' && <PearlsList items={data.pearls} />}
              {activeTab === 'qa' && <QaList items={data.qaPairs} />}
              {activeTab === 'sjt' && <SjtList items={data.sjtCases} />}
              {activeTab === 'pbl' && <PblList items={data.pblScenarios} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </motion.section>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function EmptyState({ canTrigger }: { canTrigger: boolean }) {
  return (
    <div className="px-5 py-8 text-center" data-testid="insights-empty">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted">
        <Sparkles className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold">No insights generated yet</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        Pearls, Q&amp;A pairs, an SJT case, and a PBL scenario will appear here once the transcript has been processed by Claude.
        {canTrigger ? ' Click Regenerate above to queue the job.' : ' Ask the host or program director to generate them.'}
      </p>
    </div>
  )
}

function PearlsList({ items }: { items: Pearl[] }) {
  if (items.length === 0) return <EmptyTab label="No pearls" />
  return (
    <ul className="space-y-3" data-testid="insights-pearls-list">
      {items.map((p) => (
        <li key={p.id} className="rounded-xl border border-border/60 bg-background/50 p-3.5 transition hover:border-border hover:shadow-sm">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-amber-400/20 to-rose-400/20 text-amber-700 dark:text-amber-400">
              <Gem className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-snug">{p.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{p.body}</p>
              {!p.approved && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  Awaiting faculty review
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function QaList({ items }: { items: Qa[] }) {
  if (items.length === 0) return <EmptyTab label="No Q&A pairs" />
  return (
    <ul className="space-y-3" data-testid="insights-qa-list">
      {items.map((q, i) => (
        <li key={q.id} className="rounded-xl border border-border/60 bg-background/50 p-3.5">
          <p className="text-[13px] font-semibold leading-snug">
            <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-md bg-primary/10 text-[10px] font-bold text-primary">
              Q{i + 1}
            </span>
            {q.question}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{q.answer}</p>
        </li>
      ))}
    </ul>
  )
}

function SjtList({ items }: { items: Sjt[] }) {
  if (items.length === 0) return <EmptyTab label="No SJT case" />
  return (
    <ul className="space-y-4" data-testid="insights-sjt-list">
      {items.map((s) => {
        const opts = asStringArray(s.options)
        return (
          <li key={s.id} className="rounded-xl border border-border/60 bg-background/50 p-4">
            <p className="text-[13px] font-semibold leading-relaxed">{s.stem}</p>
            {opts.length > 0 && (
              <ol className="mt-3 space-y-1.5">
                {opts.map((o, i) => {
                  const correct = s.correctIndex === i
                  return (
                    <li
                      key={i}
                      className={cn(
                        'flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]',
                        correct
                          ? 'border-emerald-500/40 bg-emerald-500/5'
                          : 'border-border/50 bg-background'
                      )}
                    >
                      <span className={cn(
                        'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold',
                        correct ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
                      )}>
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className={cn(correct && 'font-semibold')}>{o}</span>
                    </li>
                  )
                })}
              </ol>
            )}
            {s.rationale && (
              <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Rationale:</span> {s.rationale}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function PblList({ items }: { items: Pbl[] }) {
  if (items.length === 0) return <EmptyTab label="No PBL scenario" />
  return (
    <ul className="space-y-4" data-testid="insights-pbl-list">
      {items.map((p) => {
        const objs = asStringArray(p.objectives)
        return (
          <li key={p.id} className="rounded-xl border border-border/60 bg-background/50 p-4">
            <div className="rounded-lg bg-linear-to-br from-fuchsia-500/5 to-violet-500/5 p-3 ring-1 ring-fuchsia-500/10">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-700 dark:text-fuchsia-400">
                Trigger
              </p>
              <p className="mt-1 text-[13px] leading-relaxed">{p.trigger}</p>
            </div>
            {objs.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Learning objectives
                </p>
                <ul className="mt-1.5 space-y-1">
                  {objs.map((o, i) => (
                    <li key={i} className="flex gap-2 text-[13px]">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                      {o}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {p.content && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Facilitator notes
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{p.content}</p>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function EmptyTab({ label }: { label: string }) {
  return (
    <p className="py-6 text-center text-xs text-muted-foreground">{label}</p>
  )
}
