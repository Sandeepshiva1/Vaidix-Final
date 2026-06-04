'use client'

import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BLOOMS_COGNITIVE, OSLERIAN_PRINCIPLES } from '@/lib/constants'
import {
  PageTransition,
  StaggerItem,
  AnimatedCounter,
  HoverCard,
  Shimmer,
  motion,
} from '@/lib/motion'
import {
  Brain,
  Heart,
  Hand,
  Eye,
  Ear,
  GraduationCap,
  TrendingUp,
  CheckCircle2,
  Lock,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Flame,
  LineChart as LineChartIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types — match the GET /api/progress/me response
// ---------------------------------------------------------------------------

interface GrowthPoint { case: string; head: number; heart: number; hands: number; date: string }
interface DeltaTriple {
  head:  { current: number; delta: number }
  heart: { current: number; delta: number }
  hands: { current: number; delta: number }
}
interface OslerianRow { id: string; engagementCount: number; baseline: number | null; current: number | null }
interface RecentCase { id: string; date: string; name: string; head: number; heart: number; hands: number }
interface ProgressSnapshot {
  growthData:    GrowthPoint[]
  growthDeltas:  DeltaTriple | null
  consistency:   { streak: number; casesThisMonth: number; avgSessionMinutes: number | null; totalHours: number | null }
  oslerianGrowth: OslerianRow[]
  bloomsAchieved: number
  recentCases:    RecentCase[]
}

const oslerianIconMap: Record<string, LucideIcon> = {
  Eye, Ear, Brain, Heart, GraduationCap,
}

const DOMAIN_META = [
  { domain: 'HEAD' as const,  icon: Brain, color: 'text-blue-500',    bg: 'bg-blue-500/10' },
  { domain: 'HEART' as const, icon: Heart, color: 'text-rose-500',    bg: 'bg-rose-500/10' },
  { domain: 'HANDS' as const, icon: Hand,  color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
] as const

// Custom tooltip for line chart
type ChartTooltipProps = {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}
function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-semibold text-foreground">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <div className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="font-medium uppercase" style={{ color: p.color }}>{p.name}</span>
          <span className="tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function ProgressPage() {
  const [snap, setSnap] = useState<ProgressSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/progress/me')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (j?.ok && j.data) setSnap(j.data as ProgressSnapshot)
        else setError(j?.error?.message ?? 'Could not load progress')
      })
      .catch(() => { if (!cancelled) setError('Network error loading progress') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
            <TrendingUp className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">My Progress</h1>
            <p className="text-sm text-muted-foreground">Your growth trajectory across completed cases</p>
          </div>
        </div>
      </StaggerItem>

      {error && (
        <StaggerItem>
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {error}
            </CardContent>
          </Card>
        </StaggerItem>
      )}

      {/* Growth deltas — what changed, not just current state */}
      <StaggerItem>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i}><CardContent className="pt-1"><Shimmer className="h-24 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : !snap?.growthDeltas ? (
          <EmptyHero
            icon={LineChartIcon}
            title="No scored cases yet"
            body="Complete your first case to start tracking HEAD, HEART, and HANDS growth."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {DOMAIN_META.map((d) => {
              const slot = snap.growthDeltas![d.domain.toLowerCase() as 'head' | 'heart' | 'hands']
              const positive = slot.delta >= 0
              return (
                <HoverCard key={d.domain}>
                  <Card>
                    <CardContent className="pt-1">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className={`flex size-9 items-center justify-center rounded-lg ${d.bg}`}>
                              <d.icon className={`size-4 ${d.color}`} />
                            </div>
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{d.domain}</span>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-3xl font-bold tabular-nums text-foreground">
                              <AnimatedCounter value={slot.current} />
                            </span>
                            <div className={`flex items-center gap-0.5 text-sm font-semibold ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {positive ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                              {positive ? '+' : ''}{slot.delta}
                            </div>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">vs 30 days ago</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </HoverCard>
              )
            })}
          </div>
        )}
      </StaggerItem>

      {/* THE CORE CHART — 3H growth trajectory */}
      <StaggerItem>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-primary" />
              3H Growth Trajectory
            </CardTitle>
            <CardDescription>How your scores have evolved across recent completed cases</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Shimmer className="h-80 w-full" />
            ) : !snap || snap.growthData.length === 0 ? (
              <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
                <LineChartIcon className="size-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">No trajectory yet</p>
                <p className="max-w-sm text-xs text-muted-foreground">Each scored case becomes a point on this chart. Start a case from the library to see your trajectory.</p>
              </div>
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={snap.growthData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="headGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="heartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#F43F5E" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#F43F5E" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="handsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '11px' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '11px' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} iconType="circle" />
                    <Line type="monotone" dataKey="head"  name="HEAD"  stroke="#3B82F6" strokeWidth={2.5} dot={{ fill: '#3B82F6', r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="heart" name="HEART" stroke="#F43F5E" strokeWidth={2.5} dot={{ fill: '#F43F5E', r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="hands" name="HANDS" stroke="#10B981" strokeWidth={2.5} dot={{ fill: '#10B981', r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Consistency metrics */}
      <StaggerItem>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile
            icon={Flame}
            iconColor="text-orange-500"
            iconBg="bg-orange-500/10"
            value={snap?.consistency.streak ?? 0}
            label="day streak"
            loading={loading}
          />
          <MetricTile
            icon={Target}
            iconColor="text-teal-600"
            iconBg="bg-teal-500/10"
            value={snap?.consistency.casesThisMonth ?? 0}
            label="cases / month"
            loading={loading}
          />
          <MetricTile
            icon={Brain}
            iconColor="text-blue-500"
            iconBg="bg-blue-500/10"
            value={snap?.consistency.avgSessionMinutes ?? 0}
            label="avg session (min)"
            loading={loading}
            empty={snap !== null && snap.consistency.avgSessionMinutes === null}
          />
          <MetricTile
            icon={GraduationCap}
            iconColor="text-purple-500"
            iconBg="bg-purple-500/10"
            value={snap?.consistency.totalHours ?? 0}
            label="this month"
            valueSuffix="h"
            loading={loading}
            empty={snap !== null && snap.consistency.totalHours === null}
          />
        </div>
      </StaggerItem>

      {/* Oslerian Principles */}
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-4 text-amber-500" />
              Oslerian Principles — Engagement
            </CardTitle>
            <CardDescription>Which principles your completed cases have exercised</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <Shimmer className="h-32 w-full" />
            ) : !snap || snap.oslerianGrowth.every((g) => g.engagementCount === 0) ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No principles exercised yet — complete a case to start.</p>
            ) : (
              OSLERIAN_PRINCIPLES.map((principle, i) => {
                const row = snap.oslerianGrowth.find((g) => g.id === principle.id)
                if (!row) return null
                const Icon = oslerianIconMap[principle.icon] ?? Eye
                const pct = row.current ?? 0
                return (
                  <motion.div
                    key={principle.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.08 }}
                    className="space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{principle.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {row.engagementCount} {row.engagementCount === 1 ? 'case' : 'cases'}
                        </span>
                        {row.engagementCount > 0 && (
                          <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            engaged
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                      <motion.div
                        className="absolute inset-y-0 left-0 rounded-full bg-amber-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, delay: 0.5 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </motion.div>
                )
              })
            )}
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Bloom's Cognitive Progression */}
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4.5 text-indigo-500" />
              Bloom&apos;s Cognitive Progression
            </CardTitle>
            <CardDescription>Levels unlocked through demonstrated reasoning</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {BLOOMS_COGNITIVE.map((bloom, i) => {
                const achieved = !loading && bloom.level <= (snap?.bloomsAchieved ?? 0)
                return (
                  <motion.div
                    key={bloom.level}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2 + i * 0.08, type: 'spring', stiffness: 200 }}
                    className="flex flex-col items-center gap-2"
                  >
                    <motion.div
                      whileHover={{ scale: 1.1, rotate: achieved ? 5 : 0 }}
                      className={`flex size-14 items-center justify-center rounded-xl border-2 transition-colors ${
                        achieved ? 'border-emerald-500 bg-emerald-500/10' : 'border-muted bg-muted/40'
                      }`}
                    >
                      {achieved ? (
                        <CheckCircle2 className="size-6 text-emerald-500" />
                      ) : (
                        <Lock className="size-5 text-muted-foreground/50" />
                      )}
                    </motion.div>
                    <div className="text-center">
                      <p className={`text-xs font-semibold ${achieved ? 'text-foreground' : 'text-muted-foreground/60'}`}>
                        L{bloom.level}
                      </p>
                      <p className={`text-[11px] leading-tight ${achieved ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}>
                        {bloom.label}
                      </p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Recent cases */}
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle>Recent Cases</CardTitle>
            <CardDescription>Your last completed cases with HEAD / HEART / HANDS scores</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Shimmer className="h-32 w-full" />
            ) : !snap || snap.recentCases.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No completed cases yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                      <th className="pb-3 pr-4">Date</th>
                      <th className="pb-3 pr-4">Case</th>
                      <th className="pb-3 pr-2 text-center"><span className="text-blue-500">HEAD</span></th>
                      <th className="pb-3 pr-2 text-center"><span className="text-rose-500">HEART</span></th>
                      <th className="pb-3 text-center"><span className="text-emerald-500">HANDS</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.recentCases.map((c, i) => (
                      <motion.tr
                        key={c.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.5 + i * 0.06 }}
                        className="border-b last:border-0 transition-colors hover:bg-muted/30"
                      >
                        <td className="whitespace-nowrap py-3 pr-4 text-xs text-muted-foreground">
                          {new Date(c.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </td>
                        <td className="py-3 pr-4 font-medium text-foreground">{c.name}</td>
                        <td className="py-3 pr-2 text-center"><Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 tabular-nums">{c.head}</Badge></td>
                        <td className="py-3 pr-2 text-center"><Badge variant="secondary" className="bg-rose-500/10 text-rose-600 dark:text-rose-400 tabular-nums">{c.heart}</Badge></td>
                        <td className="py-3 text-center"><Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 tabular-nums">{c.hands}</Badge></td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </StaggerItem>
    </PageTransition>
  )
}

// ---------------------------------------------------------------------------
// Local presentational helpers
// ---------------------------------------------------------------------------

function MetricTile({
  icon: Icon,
  iconColor,
  iconBg,
  value,
  label,
  valueSuffix,
  loading,
  empty,
}: {
  icon: LucideIcon
  iconColor: string
  iconBg: string
  value: number
  label: string
  valueSuffix?: string
  loading?: boolean
  empty?: boolean
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-1">
        <div className={`flex size-10 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`size-5 ${iconColor}`} />
        </div>
        <div>
          {loading ? (
            <div className="h-7 w-12 animate-pulse rounded-md bg-muted" />
          ) : empty ? (
            <p className="text-2xl font-bold tabular-nums text-muted-foreground/50">—</p>
          ) : (
            <p className="text-2xl font-bold tabular-nums text-foreground">
              <AnimatedCounter value={value} />{valueSuffix ?? ''}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyHero({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon
  title: string
  body: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
          <Icon className="size-6 text-primary" />
        </div>
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  )
}
