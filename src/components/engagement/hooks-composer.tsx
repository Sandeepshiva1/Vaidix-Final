'use client'

import { useCallback, useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

type HookKind = 'TRUE_FALSE' | 'POLL' | 'ONE_WORD' | 'REPEAT_CONCEPT' | 'DILEMMA'

interface HookRow {
  id: string
  kind: HookKind
  prompt: string
  options: string[] | null
  scheduledAt: string | null
  firedAt: string | null
  closedAt: string | null
}

const KINDS: { value: HookKind; label: string }[] = [
  { value: 'TRUE_FALSE',      label: 'T / F'    },
  { value: 'POLL',            label: 'Poll'      },
  { value: 'ONE_WORD',        label: 'One word'  },
  { value: 'REPEAT_CONCEPT',  label: 'Repeat'    },
  { value: 'DILEMMA',         label: 'Dilemma'   },
]

export function HooksComposer({ sessionId }: { sessionId: string }) {
  const [hooks, setHooks]           = useState<HookRow[]>([])
  const [kind, setKind]             = useState<HookKind>('TRUE_FALSE')
  const [prompt, setPrompt]         = useState('')
  const [optionsRaw, setOptionsRaw] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      // excludeAuto: AI auto-generated hooks fire to learners silently and
      // must not clutter the presenter's history list.
      const res  = await fetch(`/api/classroom/sessions/${sessionId}/hooks?excludeAuto=true`, { cache: 'no-store' })
      const json = (await res.json()) as { ok: boolean; data?: { hooks: HookRow[] } }
      if (json.ok && json.data) setHooks(json.data.hooks)
    } catch { /* ignore */ }
  }, [sessionId])

  useEffect(() => {
    void refresh()
    const iv = setInterval(refresh, 5000)
    return () => clearInterval(iv)
  }, [refresh])

  async function createAndFire() {
    setError(null)
    if (!prompt.trim()) { setError('Prompt is required'); return }
    setSubmitting(true)
    try {
      const options =
        kind === 'POLL' && optionsRaw.trim()
          ? optionsRaw.split(/\n|,/).map((s) => s.trim()).filter(Boolean).slice(0, 8)
          : undefined

      const createRes  = await fetch(`/api/classroom/sessions/${sessionId}/hooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, prompt: prompt.trim(), options }),
      })
      const createJson = (await createRes.json()) as {
        ok: boolean; data?: { hook: { id: string } }; error?: { message: string }
      }
      if (!createJson.ok || !createJson.data)
        throw new Error(createJson.error?.message ?? 'Failed to create hook')

      const fireRes  = await fetch(
        `/api/classroom/sessions/${sessionId}/hooks/${createJson.data.hook.id}/fire`,
        { method: 'POST' }
      )
      const fireJson = (await fireRes.json()) as { ok: boolean; error?: { message: string } }
      if (!fireJson.ok) throw new Error(fireJson.error?.message ?? 'Failed to fire hook')

      setPrompt('')
      setOptionsRaw('')
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col text-white">

      {/* Header */}
      <div className="px-4 py-3 border-b border-white/7 shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-teal-400" />
          <p className="text-sm font-semibold">Live hooks</p>
        </div>
        <p className="mt-0.5 text-xs text-white/40">Drop a quick T/F or poll into the room.</p>
      </div>

      {/* Composer */}
      <div className="space-y-3 border-b border-white/7 p-3 shrink-0">

        {/* Kind selector — pill buttons, no native dropdown */}
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150',
                kind === k.value
                  ? 'bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/40'
                  : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* Prompt textarea */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Prompt (e.g. anti-VEGF safe in tractional PDR? T/F)"
          maxLength={1000}
          rows={3}
          className="w-full rounded-xl bg-white/5 border border-white/8 text-sm text-white/90 placeholder:text-white/25 px-3 py-2 resize-none outline-none focus:border-teal-500/50 focus:bg-white/8 transition-all"
        />

        {/* Poll options (only when Poll kind selected) */}
        {kind === 'POLL' && (
          <textarea
            value={optionsRaw}
            onChange={(e) => setOptionsRaw(e.target.value)}
            placeholder="Options — comma or newline separated"
            rows={2}
            className="w-full rounded-xl bg-white/5 border border-white/8 text-sm text-white/90 placeholder:text-white/25 px-3 py-2 resize-none outline-none focus:border-teal-500/50 focus:bg-white/8 transition-all"
          />
        )}

        {/* Fire button */}
        <button
          type="button"
          disabled={submitting}
          onClick={createAndFire}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-500 hover:bg-teal-400 active:scale-[0.98] disabled:opacity-50 text-white text-sm font-semibold py-2.5 transition-all shadow-lg shadow-teal-500/20"
        >
          <Zap className="w-4 h-4" />
          {submitting ? 'Firing…' : 'Create + fire'}
        </button>

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* History list */}
      <div className="flex-1 overflow-y-auto">
        {hooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-28 gap-2 text-white/20">
            <Zap className="w-5 h-5" />
            <span className="text-xs">No hooks fired yet</span>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {hooks.map((h) => (
              <li key={h.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-teal-400/80 uppercase tracking-wider">
                    {h.kind.replace(/_/g, ' ')}
                  </span>
                  {h.firedAt && (
                    <span className="text-[10px] text-white/30">
                      {new Date(h.firedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {h.closedAt && (
                    <span className="ml-auto text-[10px] text-white/25">closed</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-white/60 truncate">{h.prompt}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  )
}
