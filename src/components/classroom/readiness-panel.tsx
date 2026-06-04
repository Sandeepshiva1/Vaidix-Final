'use client'

// ════════════════════════════════════════════════════════════════════════════
// Readiness Panel — faculty / PD / admin view
// ════════════════════════════════════════════════════════════════════════════
// Shows the per-learner readiness snapshot for an upcoming session:
//   - Top: 4 stat cards (total / ready / at-risk / underprepared / avg)
//   - Bottom: sortable list with tier badge + per-learner score breakdown
//
// Polls /api/classroom/sessions/[id]/readiness every 60s so the UI updates
// as residents complete pre-cases / pre-readings without a manual refresh.

import { useEffect, useState, useCallback } from 'react'
import {
  Users, Activity, AlertTriangle, ShieldCheck, Loader2, RefreshCw,
  BookOpen, Video, Sparkles, MessageCircle, Calendar,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type Tier = 'READY' | 'AT_RISK' | 'UNDERPREPARED'

interface Learner {
  userId: string
  name: string
  email: string
  avatarUrl: string | null
  preReadings: { count: number; total: number }
  preVideos: { count: number; total: number }
  preCases: { count: number; total: number }
  preQuestionsSubmitted: number
  priorAttendance30d: { joined: number; scheduled: number }
  readinessScore: number
  tier: Tier
  lastSignalAt: string | null
}

interface Snapshot {
  sessionId: string
  computedAt: string
  versionTag: string
  cohortStats: {
    totalLearners: number
    ready: number
    atRisk: number
    underprepared: number
    averageScore: number
  }
  perLearner: Learner[]
}

interface ApiOk<T> { ok: true; data: T }
interface ApiErr { ok: false; error: { code: string; message: string } }

const POLL_MS = 60_000

const TIER_BADGES: Record<Tier, { label: string; cls: string }> = {
  READY: { label: 'Ready', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  AT_RISK: { label: 'At risk', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  UNDERPREPARED: { label: 'Underprepared', cls: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((p) => !p.startsWith('Dr.'))
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const now = Date.now()
  const t = new Date(iso).getTime()
  const sec = Math.max(0, Math.round((now - t) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.round(hr / 24)
  return `${d}d ago`
}

export function ReadinessPanel({ sessionId }: { sessionId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/readiness`)
      const json = (await res.json()) as ApiOk<Snapshot> | ApiErr
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : `HTTP ${res.status}`
        throw new Error(msg)
      }
      setSnapshot(json.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(true), POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" /> Loading readiness…
      </div>
    )
  }
  if (error && !snapshot) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">Couldn&apos;t load readiness: {error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refresh()}>Retry</Button>
        </CardContent>
      </Card>
    )
  }
  if (!snapshot) return null

  const { cohortStats, perLearner, computedAt } = snapshot

  return (
    <div className="space-y-4">
      {/* Cohort stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="readiness-stats">
        <Stat icon={Users} label="Learners" value={cohortStats.totalLearners} accent="bg-blue-500/10 text-blue-600" />
        <Stat icon={ShieldCheck} label="Ready" value={cohortStats.ready} accent="bg-emerald-500/10 text-emerald-600" />
        <Stat icon={Activity} label="At risk" value={cohortStats.atRisk} accent="bg-amber-500/10 text-amber-600" />
        <Stat icon={AlertTriangle} label="Underprepared" value={cohortStats.underprepared} accent="bg-rose-500/10 text-rose-600" />
      </div>

      {/* Refresh control */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="readiness-computed-at">
          Average score <span className="font-mono font-medium text-foreground">{cohortStats.averageScore}</span> ·
          updated {relativeTime(computedAt)} · auto-refreshes every 60s
        </span>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} className="gap-1.5">
          <RefreshCw className="size-3" /> Refresh
        </Button>
      </div>

      {/* Per-learner list */}
      {perLearner.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No learners with visibility into this session yet.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="readiness-learners">
          {perLearner.map((l) => {
            const tier = TIER_BADGES[l.tier]
            return (
              <li
                key={l.userId}
                className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3"
                data-testid={`readiness-learner-${l.userId}`}
              >
                <Avatar size="lg" className="size-10 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initials(l.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{l.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{l.email}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono tabular-nums" data-testid="readiness-score">
                        {l.readinessScore}/100
                      </span>
                      <Badge className={tier.cls} data-testid={`readiness-tier-${l.userId}`}>
                        {tier.label}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <Sub icon={BookOpen} label="Readings" value={`${l.preReadings.count}/${l.preReadings.total}`} />
                    <Sub icon={Video} label="Videos" value={`${l.preVideos.count}/${l.preVideos.total}`} />
                    <Sub icon={Sparkles} label="Pre-cases" value={`${l.preCases.count}/${l.preCases.total}`} />
                    <Sub icon={MessageCircle} label="Pre-Qs" value={String(l.preQuestionsSubmitted)} />
                    <Sub icon={Calendar} label="Attendance 30d" value={`${l.priorAttendance30d.joined}/${l.priorAttendance30d.scheduled || '–'}`} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Stat({
  icon: Icon, label, value, accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  accent: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-md ${accent}`}>
          <Icon className="size-4" />
        </div>
        <div>
          <div className="text-xl font-bold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function Sub({
  icon: Icon, label, value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-muted/20 px-2 py-1">
      <Icon className="size-3 text-muted-foreground" />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="ml-auto text-xs font-mono tabular-nums font-medium">{value}</span>
    </div>
  )
}
