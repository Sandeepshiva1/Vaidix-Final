'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'
import {
  RotateCcw,
  Calendar,
  CheckCircle2,
  Flame,
  Clock,
  ArrowRight,
  Info,
  Eye,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewItem {
  id: string
  caseId: string
  caseTitle: string
  condition: string
  dueLabel: string
  overdue: boolean
  lastReviewed: string
  interval: string
  reviewCount: number
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const stats = {
  dueToday: 3,
  completedThisWeek: 8,
  streak: 5,
}

const reviewItems: ReviewItem[] = [
  {
    id: 'rev-001',
    caseId: 'case-001',
    caseTitle: 'Wet AMD with Subfoveal CNV',
    condition: 'Wet Age-Related Macular Degeneration',
    dueLabel: 'Today',
    overdue: false,
    lastReviewed: '2026-03-26',
    interval: '7-day interval',
    reviewCount: 3,
  },
  {
    id: 'rev-002',
    caseId: 'case-005',
    caseTitle: 'Primary Open Angle Glaucoma',
    condition: 'Primary Open Angle Glaucoma',
    dueLabel: 'Overdue by 1 day',
    overdue: true,
    lastReviewed: '2026-03-18',
    interval: '14-day interval',
    reviewCount: 4,
  },
  {
    id: 'rev-003',
    caseId: 'case-004',
    caseTitle: 'Retinopathy of Prematurity',
    condition: 'Retinopathy of Prematurity - Stage 3',
    dueLabel: 'Today',
    overdue: false,
    lastReviewed: '2026-03-30',
    interval: '3-day interval',
    reviewCount: 2,
  },
  {
    id: 'rev-004',
    caseId: 'case-008',
    caseTitle: 'Childhood Strabismus',
    condition: 'Accommodative Esotropia',
    dueLabel: 'In 2 days',
    overdue: false,
    lastReviewed: '2026-03-27',
    interval: '7-day interval',
    reviewCount: 3,
  },
  {
    id: 'rev-005',
    caseId: 'case-010',
    caseTitle: 'Post-surgical Endophthalmitis',
    condition: 'Acute Post-operative Endophthalmitis',
    dueLabel: 'In 5 days',
    overdue: false,
    lastReviewed: '2026-03-23',
    interval: '14-day interval',
    reviewCount: 5,
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReviewsPage() {
  return (
    <PageTransition className="mx-auto max-w-4xl space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div>
          <div className="flex items-center gap-2">
            <RotateCcw className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Reviews Due
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Scientifically-optimized review schedule
          </p>
        </div>
      </StaggerItem>

      {/* Stats row */}
      <StaggerItem>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-teal-500/10">
                <Calendar className="size-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {stats.dueToday}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reviews Due Today
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {stats.completedThisWeek}
                </p>
                <p className="text-xs text-muted-foreground">
                  Completed This Week
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10">
                <Flame className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {stats.streak}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    days
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">Current Streak</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </StaggerItem>

      {/* Review items */}
      <StaggerItem>
        <div className="space-y-3">
          {reviewItems.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
                delay: 0.1 + index * 0.06,
              }}
            >
              <Card className="transition-colors hover:bg-muted/20">
                <CardContent>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {/* Left: case info */}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-foreground">
                          {item.caseTitle}
                        </h3>
                        <Badge
                          variant={item.overdue ? 'destructive' : 'secondary'}
                          className={
                            item.overdue
                              ? ''
                              : item.dueLabel === 'Today'
                                ? 'bg-teal-500/10 text-teal-700 dark:text-teal-400'
                                : ''
                          }
                        >
                          {item.overdue ? (
                            <Clock className="size-3" />
                          ) : null}
                          Due: {item.dueLabel}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.condition}
                      </p>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="size-3" />
                          Last reviewed:{' '}
                          {new Date(item.lastReviewed).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </span>
                        <span>{item.interval}</span>
                        <span>
                          {item.reviewCount}{' '}
                          {item.reviewCount === 1 ? 'review' : 'reviews'} total
                        </span>
                      </div>
                    </div>

                    {/* Right: action */}
                    <Button
                      size="sm"
                      className={
                        item.dueLabel === 'Today' || item.overdue
                          ? 'bg-teal-600 hover:bg-teal-700 text-white'
                          : ''
                      }
                      variant={
                        item.dueLabel === 'Today' || item.overdue
                          ? 'default'
                          : 'outline'
                      }
                    >
                      Start Review
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </StaggerItem>

      {/* Info card */}
      <StaggerItem>
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="flex gap-3">
            <Info className="size-5 shrink-0 text-blue-500 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground">
                How Spaced Repetition Works
              </h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Reviews are scheduled at optimal intervals (1, 3, 7, 14, 30 days)
                to maximize long-term retention. Each successful review increases
                the interval before the next review, while difficult items are
                reviewed sooner. This scientifically-proven method ensures you
                retain clinical knowledge efficiently over time.
              </p>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>
    </PageTransition>
  )
}
