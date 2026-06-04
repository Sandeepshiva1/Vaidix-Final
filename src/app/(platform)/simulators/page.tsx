'use client'

import {
  Eye,
  ScanEye,
  Gauge,
  Scan,
  Radio,
  Play,
  TrendingUp,
  Target,
  Clock,
  Lock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageTransition, StaggerItem, HoverCard } from '@/lib/motion'
import type { LucideIcon } from 'lucide-react'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

interface Simulator {
  id: string
  title: string
  icon: LucideIcon
  description: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  practiceCount: number
  bestScore: number
  available: boolean
}

const simulators: Simulator[] = [
  {
    id: 'slit-lamp',
    title: 'Slit Lamp Examination',
    icon: Eye,
    description: 'Practice systematic anterior segment examination using virtual slit lamp controls. Master illumination techniques and documentation.',
    difficulty: 'Beginner',
    practiceCount: 5,
    bestScore: 82,
    available: true,
  },
  {
    id: 'fundoscopy',
    title: 'Fundoscopy',
    icon: ScanEye,
    description: 'Navigate the fundus and identify key anatomical landmarks. Practice direct and indirect ophthalmoscopy techniques.',
    difficulty: 'Intermediate',
    practiceCount: 3,
    bestScore: 74,
    available: true,
  },
  {
    id: 'tonometry',
    title: 'Tonometry',
    icon: Gauge,
    description: 'Simulate intraocular pressure measurement using applanation and non-contact methods. Calibrate and interpret readings.',
    difficulty: 'Beginner',
    practiceCount: 7,
    bestScore: 91,
    available: true,
  },
]

const comingSoon: { title: string; icon: LucideIcon }[] = [
  { title: 'Gonioscopy', icon: Scan },
  { title: 'B-Scan Ultrasonography', icon: Radio },
]

const difficultyColor: Record<string, string> = {
  Beginner: 'bg-green-500/10 text-green-700 dark:text-green-400',
  Intermediate: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  Advanced: 'bg-red-500/10 text-red-700 dark:text-red-400',
}

interface ProgressStat {
  label: string
  value: string
  trend: string
  icon: LucideIcon
}

const progressStats: ProgressStat[] = [
  { label: 'Total Practice Sessions', value: '15', trend: '+3 this week', icon: Play },
  { label: 'Average Accuracy', value: '82%', trend: '+5% improvement', icon: Target },
  { label: 'Time Spent', value: '4.2 hrs', trend: 'This month', icon: Clock },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SimulatorsPage() {
  return (
    <PageTransition className="space-y-8">
      {/* Page header */}
      <StaggerItem>
        <div className="flex items-center gap-2">
          <Eye className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Virtual Simulators</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Practice HANDS domain skills
        </p>
      </StaggerItem>

      {/* Main simulator cards */}
      <StaggerItem>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {simulators.map((sim) => {
            const Icon = sim.icon
            return (
              <HoverCard key={sim.id}>
                <Card className="flex flex-col">
                  <CardHeader className="items-center text-center pb-2">
                    <div className="flex items-center justify-center rounded-xl bg-primary/10 p-4 mb-2">
                      <Icon className="size-10 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{sim.title}</CardTitle>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${difficultyColor[sim.difficulty]}`}
                    >
                      {sim.difficulty}
                    </span>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col space-y-4">
                    <p className="text-sm text-muted-foreground text-center leading-relaxed">
                      {sim.description}
                    </p>

                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>Practiced {sim.practiceCount} times</span>
                      <span className="font-medium text-foreground">Best: {sim.bestScore}%</span>
                    </div>

                    <Button className="w-full mt-auto">
                      <Play className="size-3.5 mr-1.5" />
                      Launch Simulator
                    </Button>
                  </CardContent>
                </Card>
              </HoverCard>
            )
          })}
        </div>
      </StaggerItem>

      {/* Your Simulator Progress */}
      <StaggerItem>
        <h2 className="text-lg font-semibold mb-4">Your Simulator Progress</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {progressStats.map((stat) => {
            const Icon = stat.icon
            return (
              <HoverCard key={stat.label}>
                <Card size="sm">
                  <CardContent className="flex items-center gap-3">
                    <div className="flex items-center justify-center rounded-lg bg-primary/10 p-2.5">
                      <Icon className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                      <p className="text-xl font-bold">{stat.value}</p>
                      <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <TrendingUp className="size-3" />
                        {stat.trend}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </HoverCard>
            )
          })}
        </div>
      </StaggerItem>

      {/* Coming Soon */}
      <StaggerItem>
        <h2 className="text-lg font-semibold mb-4">Coming Soon</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {comingSoon.map((item) => {
            const Icon = item.icon
            return (
              <HoverCard key={item.title}>
                <Card className="opacity-50">
                  <CardContent className="flex items-center gap-4 py-2">
                    <div className="flex items-center justify-center rounded-xl bg-muted p-3">
                      <Icon className="size-8 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">Under development</p>
                    </div>
                    <Lock className="size-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </HoverCard>
            )
          })}
        </div>
      </StaggerItem>
    </PageTransition>
  )
}
