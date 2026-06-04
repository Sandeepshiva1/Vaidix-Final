'use client'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EPA_LIST, ENTRUSTMENT_LEVELS } from '@/lib/constants'
import {
  ClipboardCheck,
  BarChart3,
  Target,
  Calendar,
  Award,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

interface EPAMock {
  epaId: number
  title: string
  category: string
  entrustmentLevel: number
  assessmentCount: number
  lastAssessed: string
}

const epaMockData: EPAMock[] = EPA_LIST.map((epa) => {
  // First 4 EPAs at level 3-4
  if (epa.id <= 4) {
    const level = epa.id <= 2 ? 4 : 3
    return {
      epaId: epa.id,
      title: epa.title,
      category: epa.category,
      entrustmentLevel: level,
      assessmentCount: 4 + epa.id,
      lastAssessed:
        epa.id === 1
          ? '2026-03-28'
          : epa.id === 2
            ? '2026-03-25'
            : epa.id === 3
              ? '2026-03-20'
              : '2026-03-15',
    }
  }
  // Middle EPAs (5-9) at level 2-3
  if (epa.id <= 9) {
    const level = epa.id <= 7 ? 3 : 2
    return {
      epaId: epa.id,
      title: epa.title,
      category: epa.category,
      entrustmentLevel: level,
      assessmentCount: 2 + (epa.id % 3),
      lastAssessed:
        epa.id === 5
          ? '2026-03-10'
          : epa.id === 6
            ? '2026-03-05'
            : epa.id === 7
              ? '2026-02-28'
              : epa.id === 8
                ? '2026-02-20'
                : '2026-02-15',
    }
  }
  // Last EPAs (10-13) at level 1-2
  const level = epa.id <= 11 ? 2 : 1
  return {
    epaId: epa.id,
    title: epa.title,
    category: epa.category,
    entrustmentLevel: level,
    assessmentCount: epa.id <= 11 ? 1 : 0,
    lastAssessed:
      epa.id === 10
        ? '2026-02-10'
        : epa.id === 11
          ? '2026-01-28'
          : epa.id === 12
            ? '2026-01-15'
            : '2025-12-20',
  }
})

const totalAssessments = 25
const averageEntrustment = 2.8
const domainsAtTarget = 4

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getEntrustmentConfig(level: number) {
  return (
    ENTRUSTMENT_LEVELS.find((e) => e.level === level) ?? ENTRUSTMENT_LEVELS[0]
  )
}

function entrustmentBgClass(level: number): string {
  const map: Record<number, string> = {
    1: 'bg-red-500/10 text-red-700 dark:text-red-400',
    2: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
    3: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    4: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    5: 'bg-green-500/10 text-green-700 dark:text-green-400',
  }
  return map[level] ?? map[1]
}

function entrustmentBarColor(level: number): string {
  const map: Record<number, string> = {
    1: 'bg-red-500',
    2: 'bg-orange-500',
    3: 'bg-amber-500',
    4: 'bg-emerald-500',
    5: 'bg-green-500',
  }
  return map[level] ?? map[1]
}

const categoryColors: Record<string, string> = {
  'Clinical Skills': 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  Diagnostic: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  Management: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  Surgical: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  Emergency: 'bg-red-500/10 text-red-700 dark:text-red-400',
  Professionalism: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Competency Portfolio
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your Entrustable Professional Activities and progression toward
          clinical autonomy
        </p>
      </div>

      {/* Portfolio summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-1">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
              <ClipboardCheck className="size-5 text-blue-500" />
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Total Assessments
              </p>
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {totalAssessments}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 pt-1">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
              <BarChart3 className="size-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Avg Entrustment
              </p>
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {averageEntrustment.toFixed(1)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 pt-1">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
              <Target className="size-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Domains at Target
              </p>
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {domainsAtTarget}
                <span className="text-lg font-normal text-muted-foreground">
                  /13
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Entrustment scale legend */}
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground mr-1">
            Entrustment Scale:
          </span>
          {ENTRUSTMENT_LEVELS.map((level) => (
            <div key={level.level} className="flex items-center gap-1.5">
              <div
                className="size-2.5 rounded-full"
                style={{ backgroundColor: level.color }}
              />
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  L{level.level}
                </span>{' '}
                {level.label}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* EPA list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="size-4.5 text-amber-500" />
            EPA Progress
          </CardTitle>
          <CardDescription>
            Entrustable Professional Activities -- 13 core competencies for
            ophthalmology residency
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {epaMockData.map((epa) => {
            const entrust = getEntrustmentConfig(epa.entrustmentLevel)
            const progressPct = (epa.entrustmentLevel / 5) * 100

            return (
              <div
                key={epa.epaId}
                className="group flex flex-col gap-2 rounded-lg p-3 transition-colors hover:bg-muted/40"
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold tabular-nums text-muted-foreground">
                        EPA {epa.epaId}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] border-transparent ${
                          categoryColors[epa.category] ?? ''
                        }`}
                      >
                        {epa.category}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-foreground leading-snug">
                      {epa.title}
                    </p>
                  </div>

                  <Badge
                    variant="secondary"
                    className={`shrink-0 border-transparent font-semibold ${entrustmentBgClass(
                      epa.entrustmentLevel
                    )}`}
                  >
                    L{epa.entrustmentLevel} -- {entrust.label}
                  </Badge>
                </div>

                {/* Progress bar */}
                <div className="flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${entrustmentBarColor(
                        epa.entrustmentLevel
                      )}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium tabular-nums text-muted-foreground w-8 text-right">
                    {epa.entrustmentLevel}/5
                  </span>
                </div>

                {/* Meta info */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ClipboardCheck className="size-3" />
                    {epa.assessmentCount} assessment
                    {epa.assessmentCount !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3" />
                    Last:{' '}
                    {new Date(epa.lastAssessed).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
