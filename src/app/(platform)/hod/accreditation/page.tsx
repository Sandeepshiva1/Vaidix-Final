'use client'

import { Award, FileText, CheckCircle2, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ProgressRing } from '@/components/shared/progress-ring'
import { cn } from '@/lib/utils'
import { PageTransition, StaggerItem, AnimatedBar } from '@/lib/motion'

// ---------------------------------------------------------------------------
// Mock accreditation data
// ---------------------------------------------------------------------------

interface AccreditationCategory {
  id: string
  label: string
  percentage: number
  description: string
}

const categories: AccreditationCategory[] = [
  {
    id: 'evaluations',
    label: 'Student Evaluations',
    percentage: 92,
    description: 'Timely completion of student assessment forms',
  },
  {
    id: 'faculty',
    label: 'Teacher Assessments',
    percentage: 85,
    description: 'Teacher evaluation submissions and DOPS records',
  },
  {
    id: 'case_volume',
    label: 'Case Volume Documentation',
    percentage: 70,
    description: 'Surgical and clinical case logging completeness',
  },
  {
    id: 'scholarly',
    label: 'Scholarly Activity',
    percentage: 65,
    description: 'Research publications, presentations, and conference participation',
  },
  {
    id: 'program_eval',
    label: 'Program Evaluation',
    percentage: 80,
    description: 'Annual program review and curriculum assessment',
  },
]

const overallReadiness = 78
const lastGenerated = 'March 15, 2026'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentageColor(pct: number): string {
  if (pct >= 85) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

function barColor(pct: number): string {
  if (pct >= 85) return 'bg-emerald-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-red-500'
}

function statusIcon(pct: number) {
  if (pct >= 85)
    return <CheckCircle2 className="size-4 text-emerald-500" />
  if (pct >= 70)
    return <AlertCircle className="size-4 text-amber-500" />
  return <AlertCircle className="size-4 text-red-500" />
}

function ringStroke(pct: number): string {
  if (pct >= 85) return 'stroke-emerald-500'
  if (pct >= 70) return 'stroke-amber-500'
  return 'stroke-red-500'
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AccreditationPage() {
  return (
    <PageTransition className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <StaggerItem>
        <div>
          <div className="flex items-center gap-2">
            <Award className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Accreditation</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Track accreditation readiness and generate compliance reports
          </p>
        </div>
      </StaggerItem>

      {/* Overall Readiness */}
      <StaggerItem>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-8 sm:flex-row sm:gap-8">
            <ProgressRing
              value={overallReadiness}
              size={140}
              strokeWidth={10}
              color={ringStroke(overallReadiness)}
              label="Overall Readiness"
            />
            <div className="text-center sm:text-left space-y-2">
              <h2 className="text-lg font-bold">
                Program is{' '}
                <span className={percentageColor(overallReadiness)}>
                  {overallReadiness}%
                </span>{' '}
                ready for accreditation review
              </h2>
              <p className="text-sm text-muted-foreground">
                Based on completion of documentation, assessments, case volumes, and
                scholarly activity across all program requirements.
              </p>
              <p className="text-xs text-muted-foreground">
                Last report generated: {lastGenerated}
              </p>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Category Breakdowns */}
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Category Breakdowns</CardTitle>
            <CardDescription>
              Detailed readiness by accreditation requirement area
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {categories.map((cat, index) => (
              <div key={cat.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {statusIcon(cat.percentage)}
                    <div>
                      <span className="text-sm font-medium">{cat.label}</span>
                      <p className="text-xs text-muted-foreground">{cat.description}</p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'text-sm font-bold tabular-nums',
                      percentageColor(cat.percentage)
                    )}
                  >
                    {cat.percentage}%
                  </span>
                </div>
                <AnimatedBar
                  value={cat.percentage}
                  barClassName={barColor(cat.percentage)}
                  delay={index * 0.1}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Generate Report */}
      <StaggerItem>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-6 sm:flex-row sm:justify-between">
            <div className="text-center sm:text-left">
              <h3 className="text-sm font-semibold">Generate Accreditation Report</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Compile all documentation, assessments, and metrics into a comprehensive
                accreditation-ready PDF report.
              </p>
            </div>
            <Button size="lg" className="shrink-0">
              <FileText className="size-4" />
              Generate Report
            </Button>
          </CardContent>
        </Card>
      </StaggerItem>
    </PageTransition>
  )
}
