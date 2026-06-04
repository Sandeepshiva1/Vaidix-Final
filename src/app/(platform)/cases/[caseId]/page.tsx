'use client'

// DB-backed case detail page. The "Start Case" button creates a real
// Case + Conversation server-side via POST /api/cases/[id]/conversations and
// then routes to the live chat at /cases/[id]/session?conv=<id>.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Clock,
  Image,
  Users,
  BookOpen,
  Play,
  Eye,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'

interface CaseTemplateApi {
  id: string
  legacyId: string | null
  title: string
  condition: string
  specialty: string
  topicSlug: string | null
  bloomsLevel: number
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
  estimatedMinutes: number
  description: string
  patientName: string
  patientAgeYears: number
  patientSex: string
  oslerianPrinciples: string[]
  tags: string[]
  imageCount: number
  isEmergency: boolean
  completions: number
}

interface ConversationSummary {
  id: string
  caseId: string
  status: 'ACTIVE' | 'COMPLETED' | 'FLAGGED'
  stage: string
  startedAt: string
  updatedAt: string
}

const difficultyConfig = {
  BEGINNER: {
    label: 'Beginner',
    cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400',
  },
  INTERMEDIATE: {
    label: 'Intermediate',
    cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  },
  ADVANCED: {
    label: 'Advanced',
    cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  },
} as const

export default function CaseOverviewPage() {
  const params = useParams<{ caseId: string }>()
  const router = useRouter()
  const [caseData, setCaseData] = useState<CaseTemplateApi | null>(null)
  const [previousConversation, setPreviousConversation] = useState<ConversationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [tplRes, convRes] = await Promise.all([
        fetch(`/api/cases/${params.caseId}`, { credentials: 'include' }),
        fetch(`/api/cases/${params.caseId}/conversations`, { credentials: 'include' }),
      ])
      const tpl = await tplRes.json()
      const conv = await convRes.json()
      if (cancelled) return
      if (tpl.ok) setCaseData(tpl.data)
      if (conv.ok && conv.data?.items?.length > 0) {
        // Show the most recent completed attempt for "Review" — falls back
        // to the most recent active one if none completed.
        const items = conv.data.items as ConversationSummary[]
        const completed = items.find((c) => c.status === 'COMPLETED')
        setPreviousConversation(completed ?? items[0])
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [params.caseId])

  const startCase = async () => {
    if (!caseData) return
    setStarting(true)
    try {
      const res = await fetch(`/api/cases/${params.caseId}/conversations`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json()
      if (json.ok) {
        router.push(`/cases/${params.caseId}/session?conv=${json.data.conversationId}`)
      } else {
        alert(json.error?.message ?? 'Failed to start case')
        setStarting(false)
      }
    } catch (err) {
      alert((err as Error).message)
      setStarting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading case…
      </div>
    )
  }
  if (!caseData) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Case not found.</p>
      </div>
    )
  }

  const difficulty = difficultyConfig[caseData.difficulty]
  const genderLabel = caseData.patientSex === 'M' || caseData.patientSex === 'Male' ? 'Male' : 'Female'

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-6">
      <StaggerItem>
        <Link
          href="/cases"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Cases
        </Link>
      </StaggerItem>

      <StaggerItem>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={difficulty.cls}>
              {difficulty.label}
            </Badge>
            <Badge variant="secondary">{caseData.specialty}</Badge>
          </div>

          <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
            {caseData.title}
          </h1>

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="size-4" />
              {caseData.patientName} ({caseData.patientAgeYears}y / {genderLabel})
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" />
              ~{caseData.estimatedMinutes} minutes
            </span>
            <span className="flex items-center gap-1.5">
              <Image className="size-4" aria-label="Clinical images" />
              {caseData.imageCount} clinical images
            </span>
          </div>
        </div>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardContent className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-1 rounded-full bg-primary/30" />
            <div className="pl-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                Patient Presentation
              </p>
              <p className="text-sm italic leading-relaxed text-foreground/80">
                &ldquo;{caseData.description}&rdquo;
              </p>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardContent>
            <div className="mb-3 flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">Case Statistics</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums text-foreground">{caseData.completions}</p>
                <p className="text-xs text-muted-foreground">Learners completed</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums text-foreground">{caseData.imageCount}</p>
                <p className="text-xs text-muted-foreground">Clinical images</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      {caseData.tags.length > 0 && (
        <StaggerItem>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Related Topics
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {caseData.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </StaggerItem>
      )}

      <StaggerItem>
        <div className="flex flex-col gap-3 pb-4 sm:flex-row">
          <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} className="flex-1">
            <Button
              onClick={startCase}
              disabled={starting}
              className="h-12 w-full gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Play className="size-5" />
              {starting ? 'Starting…' : 'Start Case'}
            </Button>
          </motion.div>

          {previousConversation && (
            <Link
              href={`/cases/${params.caseId}/session?conv=${previousConversation.id}`}
              className="sm:w-auto"
            >
              <Button variant="outline" className="h-12 w-full gap-2 rounded-xl text-base sm:px-6">
                <Eye className="size-5" />
                Review Previous Attempt
              </Button>
            </Link>
          )}
        </div>
      </StaggerItem>
    </PageTransition>
  )
}
