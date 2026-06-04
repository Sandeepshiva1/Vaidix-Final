'use client'

import {
  Crosshair,
  Clock,
  ImageIcon,
  Flame,
  Trophy,
  Zap,
  CheckCircle2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

type Difficulty = 'easy' | 'medium' | 'hard'

interface Challenge {
  id: string
  title: string
  difficulty: Difficulty
  imageCount: number
  timeLimit: number // seconds
  completed: boolean
  score?: number
  timeTaken?: number
}

const challenges: Challenge[] = [
  {
    id: 'ch-1',
    title: 'Identify the Retinal Pathology',
    difficulty: 'easy',
    imageCount: 4,
    timeLimit: 60,
    completed: true,
    score: 90,
    timeTaken: 42,
  },
  {
    id: 'ch-2',
    title: 'Anterior Segment Emergency',
    difficulty: 'medium',
    imageCount: 3,
    timeLimit: 90,
    completed: true,
    score: 85,
    timeTaken: 68,
  },
  {
    id: 'ch-3',
    title: 'Optic Disc Assessment',
    difficulty: 'easy',
    imageCount: 5,
    timeLimit: 60,
    completed: true,
    score: 95,
    timeTaken: 38,
  },
  {
    id: 'ch-4',
    title: 'Fundus Pattern Recognition',
    difficulty: 'hard',
    imageCount: 6,
    timeLimit: 120,
    completed: true,
    score: 72,
    timeTaken: 105,
  },
  {
    id: 'ch-5',
    title: 'Slit Lamp Findings',
    difficulty: 'medium',
    imageCount: 4,
    timeLimit: 90,
    completed: true,
    score: 80,
    timeTaken: 74,
  },
  {
    id: 'ch-6',
    title: 'OCT Interpretation',
    difficulty: 'hard',
    imageCount: 5,
    timeLimit: 120,
    completed: false,
  },
]

// For the "Challenges Completed" stat, count completed out of all challenges
// but spec says 7/10, so we use that mock value
const stats = {
  completed: 7,
  total: 10,
  bestStreak: 5,
  avgTime: 45,
}

const difficultyColor: Record<Difficulty, string> = {
  easy: 'bg-green-500/10 text-green-700 dark:text-green-400',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  hard: 'bg-red-500/10 text-red-700 dark:text-red-400',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChallengesPage() {
  return (
    <PageTransition className="space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div>
          <div className="flex items-center gap-2">
            <Crosshair className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Diagnostic Challenges</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Test your pattern recognition skills
          </p>
        </div>
      </StaggerItem>

      {/* Stats row */}
      <StaggerItem>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-lg bg-blue-500/10 p-2.5">
                <Trophy className="size-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Challenges Completed</p>
                <p className="text-xl font-bold">{stats.completed}/{stats.total}</p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-lg bg-amber-500/10 p-2.5">
                <Flame className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Best Streak</p>
                <p className="text-xl font-bold">{stats.bestStreak}</p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-lg bg-green-500/10 p-2.5">
                <Zap className="size-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Time</p>
                <p className="text-xl font-bold">{stats.avgTime}s</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </StaggerItem>

      {/* Challenge grid */}
      <StaggerItem>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {challenges.map((challenge, index) => (
            <motion.div
              key={challenge.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.22, 1, 0.36, 1],
                delay: 0.1 + index * 0.08,
              }}
            >
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="leading-snug">{challenge.title}</CardTitle>
                    {challenge.completed && (
                      <CheckCircle2 className="size-5 shrink-0 text-green-500" />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${difficultyColor[challenge.difficulty]}`}
                    >
                      {challenge.difficulty}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                      <ImageIcon className="size-3" />
                      {challenge.imageCount} images
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      {challenge.timeLimit}s
                    </span>
                  </div>

                  {challenge.completed ? (
                    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">
                        Score: <span className="font-semibold text-foreground">{challenge.score}%</span>
                      </span>
                      <span className="text-muted-foreground">
                        Time: <span className="font-semibold text-foreground">{challenge.timeTaken}s</span>
                      </span>
                    </div>
                  ) : (
                    <Button className="w-full" size="sm">
                      Start Challenge
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </StaggerItem>
    </PageTransition>
  )
}
