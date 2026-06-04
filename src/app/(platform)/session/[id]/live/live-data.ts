'use client'

// Self-contained client data layer for the Live Conference screen. Every fetch
// targets an existing /api/classroom/sessions/[id] backend; nothing here edits
// shared libs, so the whole live/ folder extracts cleanly to LMS-Copy later.
// Mutations send CSRF headers via ensureCsrfHeaders (cookie is bootstrapped
// lazily). All routes use the { ok, data } / { ok:false, error } envelope.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureCsrfHeaders } from '@/lib/csrf-client'

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

async function getJson<T>(url: string): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    return (await res.json()) as Envelope<T>
  } catch (err) {
    return { ok: false, error: { code: 'NETWORK', message: (err as Error).message } }
  }
}

async function sendJson<T>(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<Envelope<T>> {
  try {
    const csrf = await ensureCsrfHeaders()
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrf },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const json = (await res.json().catch(() => ({}))) as Envelope<T>
    // Some routes (503 AI offline) still parse as the error envelope; if the
    // body wasn't valid JSON, synthesise an error carrying the status code.
    if (!('ok' in json)) return { ok: false, error: { code: String(res.status), message: res.statusText } }
    return json
  } catch (err) {
    return { ok: false, error: { code: 'NETWORK', message: (err as Error).message } }
  }
}

// ─── LiveKit token ───────────────────────────────────────────────────────────
export type LiveRole = 'HOST' | 'CO_HOST' | 'PARTICIPANT' | 'VIEWER'
export interface TokenState {
  status: 'loading' | 'joined' | 'waiting' | 'denied' | 'error'
  token?: string
  url?: string
  role?: LiveRole
  message?: string
}

export function useLiveToken(sessionId: string): TokenState {
  const [state, setState] = useState<TokenState>({ status: 'loading' })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await sendJson<{ state: string; token?: string; url?: string; role?: LiveRole; reason?: string }>(
        `/api/classroom/sessions/${sessionId}/token`,
        'POST',
      )
      if (cancelled) return
      if (!r.ok) { setState({ status: 'error', message: r.error.message }); return }
      const d = r.data
      if (d.state === 'JOINED' && d.token && d.url) setState({ status: 'joined', token: d.token, url: d.url, role: d.role })
      else if (d.state === 'WAITING') setState({ status: 'waiting' })
      else if (d.state === 'DENIED') setState({ status: 'denied', message: d.reason })
      else setState({ status: 'error', message: 'Could not join the room.' })
    })()
    return () => { cancelled = true }
  }, [sessionId])
  return state
}

// ─── Engagement aggregate (host-only GET) ─────────────────────────────────────
export interface EngagementAggregate {
  participants: number
  engagementScore: number
  recentChat: number
  recentHooks: number
  recentHandRaises: number
}

export function useEngagement(sessionId: string, enabled: boolean): EngagementAggregate | null {
  const [agg, setAgg] = useState<EngagementAggregate | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const tick = async () => {
      const r = await getJson<EngagementAggregate>(`/api/classroom/sessions/${sessionId}/engagement-signals`)
      if (!cancelled && r.ok) setAgg(r.data)
    }
    tick()
    const i = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(i) }
  }, [sessionId, enabled])
  return agg
}

// ─── Hooks (engagement prompts) ───────────────────────────────────────────────
export type ApiHookKind = 'TRUE_FALSE' | 'POLL' | 'ONE_WORD' | 'REPEAT_CONCEPT' | 'DILEMMA'
export interface ApiHook {
  id: string
  kind: ApiHookKind
  prompt: string
  options: string[] | null
  correctOption: string | null
  firedAt: string | null
  closedAt: string | null
  responseCount: number
}

export function useLiveHooks(sessionId: string) {
  const [hooks, setHooks] = useState<ApiHook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const r = await getJson<{ hooks: ApiHook[] }>(`/api/classroom/sessions/${sessionId}/hooks`)
    if (r.ok) { setHooks(r.data.hooks); setError(null) } else setError(r.error.message)
  }, [sessionId])
  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (input: { kind: ApiHookKind; prompt: string; options?: string[]; correctOption?: string }) => {
    const r = await sendJson<{ hook: { id: string } }>(`/api/classroom/sessions/${sessionId}/hooks`, 'POST', input)
    await refresh()
    return r.ok
  }, [sessionId, refresh])

  const fire = useCallback(async (hookId: string) => {
    const r = await sendJson<{ fired: boolean }>(`/api/classroom/sessions/${sessionId}/hooks/${hookId}/fire`, 'POST')
    await refresh()
    return r.ok
  }, [sessionId, refresh])

  return { hooks, error, refresh, create, fire }
}

// AI hook suggestions — 503 AI_UNAVAILABLE is the honest "AI offline" signal.
export interface SuggestedPoll { q: string; options: string[]; correct: string | null }
export async function suggestHooks(sessionId: string): Promise<{ ok: true; polls: SuggestedPoll[] } | { ok: false; offline: boolean; message: string }> {
  const r = await sendJson<{ polls: SuggestedPoll[] }>(`/api/classroom/sessions/${sessionId}/hooks/suggest`, 'POST')
  if (r.ok) return { ok: true, polls: r.data.polls }
  const offline = r.error.code === 'AI_UNAVAILABLE' || r.error.code === '503'
  return { ok: false, offline, message: r.error.message }
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
export interface LeaderEntry {
  userId: string
  name: string | null
  role: string | null
  points: number
  breakdown: { correct: number; participation: number; chats: number; raises: number }
}

export function useLeaderboard(sessionId: string, enabled: boolean) {
  const [entries, setEntries] = useState<LeaderEntry[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const tick = async () => {
      const r = await getJson<{ leaderboard: LeaderEntry[] }>(`/api/classroom/sessions/${sessionId}/leaderboard`)
      if (!cancelled && r.ok) setEntries(r.data.leaderboard)
    }
    tick()
    const i = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(i) }
  }, [sessionId, enabled])
  return entries
}

// ─── Breakouts ────────────────────────────────────────────────────────────────
export interface ApiBreakout {
  id: string
  name: string
  groupingMode: 'RANDOM' | 'SELF_SELECT' | 'AI_AUTO'
  status: 'ACTIVE' | 'ENDED'
  participants: { userId: string; name: string }[]
}

export function useBreakouts(sessionId: string) {
  const [rooms, setRooms] = useState<ApiBreakout[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const r = await getJson<{ items: ApiBreakout[] }>(`/api/classroom/sessions/${sessionId}/breakouts`)
    if (r.ok) { setRooms(r.data.items); setError(null) } else setError(r.error.message)
  }, [sessionId])
  useEffect(() => { refresh() }, [refresh])

  const create = useCallback(async (groupCount: number, namePrefix?: string) => {
    const r = await sendJson<unknown>(`/api/classroom/sessions/${sessionId}/breakouts`, 'POST', {
      groupingMode: 'RANDOM', groupCount, ...(namePrefix ? { namePrefix } : {}),
    })
    await refresh()
    return r
  }, [sessionId, refresh])

  return { rooms, error, refresh, create }
}

// ─── Live captions (SSE) ──────────────────────────────────────────────────────
export interface CaptionSeg { startMs: number; endMs: number; text: string; lang: string; speaker?: string; partial: boolean }

export function useCaptions(sessionId: string, enabled: boolean) {
  const [segments, setSegments] = useState<CaptionSeg[]>([])
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const es = new EventSource(`/api/classroom/sessions/${sessionId}/live-captions`, { withCredentials: true })
    es.addEventListener('hello', () => setConnected(true))
    es.addEventListener('caption', (e) => {
      try {
        const seg = JSON.parse((e as MessageEvent).data) as CaptionSeg
        setSegments((prev) => (seg.partial ? prev : [...prev, seg].slice(-200)))
      } catch { /* ignore malformed */ }
    })
    es.onerror = () => setConnected(false)
    return () => es.close()
  }, [sessionId, enabled])
  return { segments, connected }
}

// ─── Presenter alerts (SSE) — the real AI co-facilitator nudges ───────────────
export interface PresenterAlert { id: string; kind: string; severity: 'WARN' | 'INFO'; message: string; createdAt: string }

export function usePresenterAlerts(sessionId: string, enabled: boolean) {
  const [alerts, setAlerts] = useState<PresenterAlert[]>([])
  const seen = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!enabled) return
    const es = new EventSource(`/api/classroom/sessions/${sessionId}/presenter-alerts`, { withCredentials: true })
    es.addEventListener('alert', (e) => {
      try {
        const a = JSON.parse((e as MessageEvent).data) as PresenterAlert
        if (seen.current.has(a.id)) return
        seen.current.add(a.id)
        setAlerts((prev) => [a, ...prev].slice(0, 20))
      } catch { /* ignore */ }
    })
    return () => es.close()
  }, [sessionId, enabled])
  return alerts
}
