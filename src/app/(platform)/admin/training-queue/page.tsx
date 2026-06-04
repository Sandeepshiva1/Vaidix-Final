'use client'

import { useEffect, useState } from 'react'
import {
  Brain,
  Download,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Database,
  FileJson,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageTransition, StaggerItem, motion, AnimatedCounter } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  loadQueue,
  summarise,
  deleteEntry,
  clearQueue,
  downloadJSONL,
  type TrainingQueueEntry,
  type NoveltyFlag,
} from '@/lib/training-queue'

const FLAG_LABELS: Record<NoveltyFlag, { label: string; color: string }> = {
  low_keyword_match: { label: 'Low keyword match', color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  mixed_signals: { label: 'Mixed signals', color: 'bg-purple-500/10 text-purple-700 dark:text-purple-400' },
  unusual_length: { label: 'Unusual length', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  outlier_difficulty: { label: 'Outlier vs difficulty', color: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  paraphrase_suspected: { label: 'Paraphrase suspected', color: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400' },
  manual_flag: { label: 'Manual flag', color: 'bg-slate-500/10 text-slate-700 dark:text-slate-400' },
}

export default function TrainingQueuePage() {
  const [entries, setEntries] = useState<TrainingQueueEntry[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed'>('pending')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate post-hydration load of client-only localStorage state behind a `hydrated` mount guard to avoid SSR mismatch
    setEntries(loadQueue())
    setHydrated(true)
  }, [])

  if (!hydrated) {
    return null
  }

  const summary = summarise(entries)
  const visible = entries
    .filter((e) => {
      if (filter === 'pending') return !e.facultyReview
      if (filter === 'reviewed') return e.facultyReview
      return true
    })
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1))

  const handleDelete = (id: string) => {
    deleteEntry(id)
    setEntries(loadQueue())
  }

  const handleClear = () => {
    if (!confirm('Clear the entire training queue? This cannot be undone.')) return
    clearQueue()
    setEntries([])
  }

  return (
    <PageTransition className="space-y-6">
      {/* Header */}
      <StaggerItem>
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/10">
            <Brain className="size-5 text-purple-600" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">ML Training Queue</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Answers the rule-based engine could not confidently score. These become labelled training data when faculty provide ground truth.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadJSONL} disabled={entries.length === 0} className="gap-1.5">
              <Download className="size-3.5" />
              Export JSONL
            </Button>
            <Button variant="outline" size="sm" onClick={handleClear} disabled={entries.length === 0} className="gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/20">
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          </div>
        </div>
      </StaggerItem>

      {/* Summary cards */}
      <StaggerItem>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 pt-1">
              <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/10">
                <Database className="size-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground"><AnimatedCounter value={summary.total} /></p>
                <p className="text-xs text-muted-foreground">total captured</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-1">
              <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10">
                <Clock className="size-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground"><AnimatedCounter value={summary.pendingReview} /></p>
                <p className="text-xs text-muted-foreground">pending review</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-1">
              <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <CheckCircle2 className="size-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground"><AnimatedCounter value={summary.reviewed} /></p>
                <p className="text-xs text-muted-foreground">reviewed</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-1">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/10">
                <FileJson className="size-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-foreground">{Object.keys(summary.byTopic).length}</p>
                <p className="text-xs text-muted-foreground">topics affected</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </StaggerItem>

      {/* Why-this-page card */}
      <StaggerItem>
        <Card className="border-purple-200 bg-purple-50/30 dark:border-purple-500/20 dark:bg-purple-950/10">
          <CardContent className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <Brain className="size-4 text-purple-600" />
              <h3 className="text-sm font-bold text-foreground">How this becomes ML training data</h3>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              When a learner answers a question, the rule-based scorer makes a best-effort guess at the axis scores. If the engine flags any uncertainty (unusual length, low rubric match, paraphrasing suspected, or an outlier score for the difficulty), the answer is captured here for teacher review. Teachers can then provide ground-truth scoring, add new keywords or rubric entries, or flag the item itself for revision. The exported JSONL file is the labelled dataset for fine-tuning Claude or training a custom model in Phase B.
            </p>
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Filter pills */}
      <StaggerItem>
        <div className="flex items-center gap-2">
          {(['all', 'pending', 'reviewed'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'default' : 'outline'}
              onClick={() => setFilter(f)}
              className="capitalize"
            >
              {f}
              {f === 'all' && ` (${summary.total})`}
              {f === 'pending' && ` (${summary.pendingReview})`}
              {f === 'reviewed' && ` (${summary.reviewed})`}
            </Button>
          ))}
        </div>
      </StaggerItem>

      {/* Entries list */}
      {visible.length === 0 ? (
        <StaggerItem>
          <div className="rounded-xl border border-dashed py-12 text-center">
            <Brain className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {filter === 'pending'
                ? 'No pending entries. Take a Review test and answer in unusual ways to populate this queue.'
                : 'No entries to display.'}
            </p>
          </div>
        </StaggerItem>
      ) : (
        <div className="space-y-3">
          {visible.map((entry, i) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Card>
                <CardContent className="space-y-3 pt-1">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {entry.itemType}
                        </Badge>
                        {entry.audience && (
                          <Badge variant="secondary" className="text-[10px] capitalize">
                            {entry.audience.replace('_', ' ')}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {entry.itemTopic} · {entry.itemSubTopic}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          difficulty {Math.round(entry.itemDifficulty * 100)}%
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Captured {new Date(entry.capturedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · item: {entry.itemId}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(entry.id)} className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  {/* Novelty flags */}
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Why captured</p>
                    <div className="flex flex-wrap gap-1">
                      {entry.noveltyFlags.map((flag) => (
                        <span
                          key={flag}
                          className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', FLAG_LABELS[flag].color)}
                        >
                          {FLAG_LABELS[flag].label}
                        </span>
                      ))}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        engine confidence: {Math.round(entry.engineScore.confidence * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Raw answer */}
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Learner answer</p>
                    <p className="mt-1 text-xs leading-relaxed text-foreground">
                      {typeof entry.rawAnswer === 'string'
                        ? entry.rawAnswer
                        : JSON.stringify(entry.rawAnswer)}
                    </p>
                  </div>

                  {/* Engine scores */}
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Engine guess</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(entry.engineScore.axisScores).map(([axis, score]) => (
                        <Badge key={axis} variant="secondary" className="text-[10px] capitalize">
                          {axis}: {score}
                        </Badge>
                      ))}
                      <Badge variant="secondary" className={cn('text-[10px]', entry.engineScore.isCorrect ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700')}>
                        {entry.engineScore.isCorrect ? 'Marked strong' : 'Marked weak'}
                      </Badge>
                    </div>
                  </div>

                  {/* Faculty review CTA */}
                  {!entry.facultyReview ? (
                    <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-2.5 dark:border-amber-500/30 dark:bg-amber-950/20">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="size-4 text-amber-600" />
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Awaiting teacher review</p>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Teacher review form is Phase B. For now, captured entries are exportable as JSONL for offline scoring.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-300 bg-emerald-50/40 p-2.5 dark:border-emerald-500/30 dark:bg-emerald-950/20">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-600" />
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          Reviewed by {entry.facultyReview.reviewedBy} on {new Date(entry.facultyReview.reviewedAt).toLocaleDateString('en-IN')}
                        </p>
                      </div>
                      {entry.facultyReview.facultyNotes && (
                        <p className="mt-1 text-[11px] text-foreground">{entry.facultyReview.facultyNotes}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </PageTransition>
  )
}
