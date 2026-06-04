'use client'

import { useState } from 'react'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { csrfHeaders } from '@/lib/csrf-client'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROCEDURES = [
  'Intravitreal Injection',
  'Phacoemulsification',
  'Nd:YAG Laser Capsulotomy',
  'PRP Laser Photocoagulation',
  'Direct Ophthalmoscopy',
  'Indirect Ophthalmoscopy',
  'Slit Lamp Examination',
  'Trabeculectomy',
  'Pterygium Excision',
  'Chalazion Incision & Curettage',
]

const SCORING_DOMAINS = [
  { id: 'indication', label: 'Demonstrates Appropriate Indication' },
  { id: 'consent', label: 'Informed Consent' },
  { id: 'preparation', label: 'Pre-procedure Preparation' },
  { id: 'technique', label: 'Technical Ability' },
  { id: 'asepsis', label: 'Aseptic Technique' },
  { id: 'postProcedure', label: 'Post-procedure Management' },
  { id: 'communication', label: 'Communication Skills' },
]

function getOverallLabel(score: number): string {
  if (score <= 3) return 'Below Expectations'
  if (score <= 6) return 'Meets Expectations'
  return 'Above Expectations'
}

function getOverallColor(score: number): string {
  if (score <= 3) return 'text-red-500'
  if (score <= 6) return 'text-amber-500'
  return 'text-emerald-500'
}

export interface DopsResidentOption {
  id: string
  name: string
  year: number | null
}

// ---------------------------------------------------------------------------
// Client form
// ---------------------------------------------------------------------------

export function DopsClient({ residents }: { residents: DopsResidentOption[] }) {
  const [selectedLearner, setSelectedLearner] = useState('')
  const [selectedProcedure, setSelectedProcedure] = useState('')
  const [assessmentDate, setAssessmentDate] = useState(new Date().toISOString().split('T')[0])
  const [domainScores, setDomainScores] = useState<Record<string, number>>({})
  const [overallRating, setOverallRating] = useState<number>(0)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleDomainScore = (domainId: string, score: number) => {
    setDomainScores((prev) => ({ ...prev, [domainId]: score }))
  }

  function resetForm() {
    setSelectedLearner('')
    setSelectedProcedure('')
    setAssessmentDate(new Date().toISOString().split('T')[0])
    setDomainScores({})
    setOverallRating(0)
    setFeedback('')
  }

  const canSubmit =
    !!selectedLearner && !!selectedProcedure && overallRating > 0 && !submitting

  async function handleSubmit() {
    if (!selectedLearner) return toast.error('Select a resident to assess')
    if (!selectedProcedure) return toast.error('Select a procedure')
    if (overallRating < 1) return toast.error('Give an overall rating (1–9)')

    setSubmitting(true)
    try {
      const res = await fetch('/api/teacher/dops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          residentId: selectedLearner,
          procedureName: selectedProcedure,
          performedAt: assessmentDate,
          domainScores,
          overallRating,
          feedback: feedback.trim() || undefined,
        }),
      })
      const json = (await res.json()) as { ok: boolean; error?: { message?: string } }
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? `Submission failed (${res.status})`)
      }
      const who = residents.find((r) => r.id === selectedLearner)?.name ?? 'resident'
      toast.success(`DOPS assessment saved for ${who}`)
      resetForm()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageTransition className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <StaggerItem>
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">DOPS Assessment</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Direct Observation of Procedural Skills — rate a resident and save it to their record.
          </p>
        </div>
      </StaggerItem>

      {residents.length === 0 && (
        <StaggerItem>
          <Card className="border-dashed">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No residents are available to assess yet. Once residents are invited and active,
              they&rsquo;ll appear in the list below.
            </CardContent>
          </Card>
        </StaggerItem>
      )}

      {/* Form */}
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assessment Details</CardTitle>
            <CardDescription>Select the learner, procedure, and date</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Learner Select — real residents from the DB */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Select Learner</label>
              <select
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                value={selectedLearner}
                onChange={(e) => setSelectedLearner(e.target.value)}
              >
                <option value="">Choose a student...</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.year != null ? ` (PGY-${r.year})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Procedure Select */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Select Procedure</label>
              <select
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                value={selectedProcedure}
                onChange={(e) => setSelectedProcedure(e.target.value)}
              >
                <option value="">Choose a procedure...</option>
                {PROCEDURES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                value={assessmentDate}
                onChange={(e) => setAssessmentDate(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Scoring Domains */}
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scoring Domains</CardTitle>
            <CardDescription>Rate each domain from 1 (lowest) to 9 (highest)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {SCORING_DOMAINS.map((domain, index) => (
              <motion.div
                key={domain.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: index * 0.06 }}
                className="space-y-2"
              >
                <label className="text-sm font-medium">{domain.label}</label>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleDomainScore(domain.id, n)}
                      className={cn(
                        'flex size-9 items-center justify-center rounded-lg border text-sm font-medium transition-all sm:size-10',
                        domainScores[domain.id] === n
                          ? 'border-teal-500 bg-teal-500 text-white shadow-sm'
                          : 'border-input bg-background text-foreground hover:border-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Overall Rating */}
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overall Rating</CardTitle>
            <CardDescription>
              1-3 Below Expectations | 4-6 Meets Expectations | 7-9 Above Expectations
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setOverallRating(n)}
                  className={cn(
                    'flex size-10 items-center justify-center rounded-lg border text-sm font-semibold transition-all sm:size-11',
                    overallRating === n
                      ? 'border-teal-500 bg-teal-500 text-white shadow-sm'
                      : 'border-input bg-background text-foreground hover:border-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            {overallRating > 0 && (
              <p className={cn('text-sm font-medium', getOverallColor(overallRating))}>
                {getOverallLabel(overallRating)}
              </p>
            )}
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Feedback */}
      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Feedback</CardTitle>
            <CardDescription>Provide constructive feedback for the learner</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Write your feedback here..."
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="min-h-24"
            />
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Submit */}
      <StaggerItem>
        <div className="flex flex-col items-end gap-2 pb-6">
          <Button size="lg" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
            {submitting ? 'Saving…' : 'Submit Assessment'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Saved to the resident&rsquo;s record (DopsAssessment).
          </p>
        </div>
      </StaggerItem>
    </PageTransition>
  )
}
