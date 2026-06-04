'use client'

import { Flag, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'

// ---------------------------------------------------------------------------
// Mock milestone data
// ---------------------------------------------------------------------------

interface Milestone {
  id: string
  residentName: string
  description: string
  epaRef: string
  targetLevel: number
  dueDate: string
  status: 'on_track' | 'at_risk' | 'completed'
}

const milestones: Milestone[] = [
  {
    id: 'ms-1',
    residentName: 'Dr. Arjun Krishnamurthy',
    description: 'Ready for independent intravitreal injections',
    epaRef: 'EPA-9',
    targetLevel: 4,
    dueDate: 'April 2026',
    status: 'on_track',
  },
  {
    id: 'ms-2',
    residentName: 'Dr. Kavya Desai',
    description: 'Complete 20 phaco cases for EPA-10 progression',
    epaRef: 'EPA-10',
    targetLevel: 3,
    dueDate: 'May 2026',
    status: 'on_track',
  },
  {
    id: 'ms-3',
    residentName: 'Dr. Rohan Mehta',
    description: 'Achieve indirect supervision for posterior segment assessment',
    epaRef: 'EPA-4',
    targetLevel: 3,
    dueDate: 'June 2026',
    status: 'at_risk',
  },
  {
    id: 'ms-4',
    residentName: 'Dr. Sneha Kulkarni',
    description: 'Demonstrate proficiency in IOP measurement techniques',
    epaRef: 'EPA-5',
    targetLevel: 3,
    dueDate: 'April 2026',
    status: 'on_track',
  },
  {
    id: 'ms-5',
    residentName: 'Dr. Meghana Rao',
    description: 'Qualify for full autonomy in laser procedures',
    epaRef: 'EPA-11',
    targetLevel: 5,
    dueDate: 'July 2026',
    status: 'on_track',
  },
  {
    id: 'ms-6',
    residentName: 'Dr. Vikram Reddy',
    description: 'Complete anterior segment assessment under direct supervision',
    epaRef: 'EPA-3',
    targetLevel: 2,
    dueDate: 'May 2026',
    status: 'at_risk',
  },
  {
    id: 'ms-7',
    residentName: 'Dr. Siddharth Joshi',
    description: 'Achieve on-demand supervision for surgical planning and consent',
    epaRef: 'EPA-8',
    targetLevel: 4,
    dueDate: 'August 2026',
    status: 'completed',
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusConfig(status: Milestone['status']) {
  switch (status) {
    case 'on_track':
      return {
        label: 'On Track',
        icon: CheckCircle2,
        badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        dotClass: 'bg-emerald-500',
        borderClass: 'border-l-emerald-500',
      }
    case 'at_risk':
      return {
        label: 'At Risk',
        icon: AlertTriangle,
        badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        dotClass: 'bg-amber-500',
        borderClass: 'border-l-amber-500',
      }
    case 'completed':
      return {
        label: 'Completed',
        icon: CheckCircle2,
        badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        dotClass: 'bg-blue-500',
        borderClass: 'border-l-blue-500',
      }
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MilestonesPage() {
  return (
    <PageTransition className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <StaggerItem>
        <div>
          <div className="flex items-center gap-2">
            <Flag className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Milestones</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Track upcoming student milestones and EPA progression targets
          </p>
        </div>
      </StaggerItem>

      {/* Timeline */}
      <StaggerItem>
        <div className="relative space-y-0">
          {/* Vertical timeline line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

          {milestones.map((ms, index) => {
            const config = statusConfig(ms.status)
            const StatusIcon = config.icon
            return (
              <motion.div
                key={ms.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.15 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="relative flex gap-4 pb-6 last:pb-0"
              >
                {/* Timeline dot */}
                <div className="relative z-10 flex shrink-0 items-start pt-1">
                  <div
                    className={cn(
                      'size-[11px] rounded-full ring-4 ring-background',
                      config.dotClass
                    )}
                  />
                </div>

                {/* Card */}
                <Card
                  className={cn(
                    'flex-1 border-l-4 transition-shadow hover:shadow-md',
                    config.borderClass
                  )}
                >
                  <CardContent className="pt-1">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground">
                          {ms.residentName}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {ms.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {ms.epaRef}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Target: Level {ms.targetLevel}
                          </span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="size-3" />
                            {ms.dueDate}
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn('shrink-0 gap-1 text-[10px]', config.badgeClass)}
                      >
                        <StatusIcon className="size-3" />
                        {config.label}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      </StaggerItem>
    </PageTransition>
  )
}
