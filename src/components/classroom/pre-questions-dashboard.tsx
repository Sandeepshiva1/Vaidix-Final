'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, RefreshCw, MessageSquare, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DashboardTheme {
  id: string
  label: string
  summary: string
  questionCount: number
  rank: number
  generatedAt: string
  exampleQuestions: string[]
}

interface DashboardPayload {
  totalQuestions: number
  themesGeneratedAt: string | null
  unthemedCount: number
  topThemes: DashboardTheme[]
}

interface Props {
  sessionId: string
  /** False for residents — we still render the component for symmetry, but it
   *  will surface a "you don't have access" state instead of fetching. */
  canViewDashboard: boolean
}

export function PreQuestionsDashboard({ sessionId, canViewDashboard }: Props) {
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [reclustering, setReclustering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!canViewDashboard) {
      setLoading(false)
      setError('You do not have access to the presenter dashboard.')
      return
    }
    const res = await fetch(`/api/classroom/sessions/${sessionId}/pre-questions/dashboard`, {
      credentials: 'include',
    })
    const json = await res.json()
    if (json.ok) {
      setData(json.data)
      setError(null)
    } else {
      setError(json.error?.message ?? 'Failed to load dashboard')
    }
    setLoading(false)
  }, [sessionId, canViewDashboard])

  useEffect(() => {
    void refresh()
    // While the worker is debounced, themes can change — poll every 10s for
    // fresh counts. Cheap query (~3 indexed reads).
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [refresh])

  const recluster = async () => {
    setReclustering(true)
    try {
      await fetch(`/api/classroom/sessions/${sessionId}/pre-questions/recluster`, {
        method: 'POST',
        credentials: 'include',
      })
      // The worker takes a few seconds to run; wait briefly then refresh.
      setTimeout(() => void refresh(), 4_000)
    } finally {
      setReclustering(false)
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading dashboard…</div>
  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertCircle className="mr-1 inline h-4 w-4" /> {error}
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Anticipated learner concerns</h2>
          <p className="text-xs text-muted-foreground">
            {data.totalQuestions} question{data.totalQuestions === 1 ? '' : 's'} submitted
            {data.unthemedCount > 0 ? ` · ${data.unthemedCount} not yet themed` : ''}
            {data.themesGeneratedAt ? (
              <>
                {' '}· themes refreshed{' '}
                {new Date(data.themesGeneratedAt).toLocaleTimeString()}
              </>
            ) : null}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={recluster} disabled={reclustering}>
          <RefreshCw className={`mr-1 h-3 w-3 ${reclustering ? 'animate-spin' : ''}`} />
          Re-cluster now
        </Button>
      </header>

      {data.topThemes.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No themes yet. Submissions are clustered ~30 seconds after the most recent one.
        </div>
      ) : (
        <ol className="space-y-3">
          {data.topThemes.map((theme, idx) => (
            <li key={theme.id} className="rounded-md border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    #{idx + 1}
                  </span>
                  <h3 className="text-sm font-semibold">
                    <Sparkles className="mr-1 inline h-3 w-3" />
                    {theme.label}
                  </h3>
                </div>
                <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {theme.questionCount} Q
                </span>
              </div>
              {theme.summary ? (
                <p className="mt-1 text-sm text-muted-foreground">{theme.summary}</p>
              ) : null}
              {theme.exampleQuestions.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t pt-2">
                  {theme.exampleQuestions.map((q, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      <MessageSquare className="mr-1 inline h-3 w-3" />“{q}”
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
