'use client'

// ════════════════════════════════════════════════════════════════════════════
// Teaser Video Button — faculty / host triggers + previews the promo MP4 (W6.8)
// ════════════════════════════════════════════════════════════════════════════
// Click → POST /api/promo/teaser-video → poll /api/documents/[id] until the
// worker has uploaded the MP4 (sizeBytes > 0). Then render an inline <video>
// preview + a download link.
//
// Before the click, we fetch GET /api/promo/teaser-video/sources and surface
// what the AI will use as input (objectives count, study material, top
// pre-questions). No more black-box generation — the curator sees exactly
// what's feeding Gemini before they spend the render.

import { useCallback, useEffect, useState } from 'react'
import {
  Sparkles, Loader2, Download, AlertCircle, Film,
  Target, BookOpen, MessageCircleQuestion, Tag, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface RequestResult {
  documentId: string
  jobId: string
  s3Key: string
}

interface DocumentDto {
  id: string
  title: string
  sizeBytes: number | string
  mimeType: string
  signedUrl?: string
  rejectionReason?: string | null
}

interface TeaserSourcesDto {
  sessionId: string
  title: string
  description: string | null
  hostName: string
  scheduledStart: string
  sessionType: string
  tags: string[]
  objectives: Array<{ text: string; blooms: number }>
  studyMaterial: Array<{ kind: string; title: string }>
  topPreQuestions: Array<{ content: string; voteCount: number }>
  counts: { objectives: number; studyMaterial: number; preQuestions: number }
}

interface ApiOk<T> { ok: true; data: T }
interface ApiErr { ok: false; error: { code: string; message: string } }

async function getCsrf(): Promise<string> {
  const m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
    if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
    headers.set('x-csrf-token', await getCsrf())
  }
  const res = await fetch(input, { ...init, headers })
  const json = (await res.json()) as ApiOk<T> | ApiErr
  if (!res.ok || !json.ok) {
    const msg = !json.ok ? json.error.message : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json.data
}

const POLL_INTERVAL_MS = 2_000
const POLL_MAX_MS = 60_000

export function TeaserVideoButton({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<'idle' | 'queued' | 'rendering' | 'ready' | 'error'>('idle')
  const [doc, setDoc] = useState<DocumentDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pollHandle, setPollHandle] = useState<{ cancel: () => void } | null>(null)
  const [sources, setSources] = useState<TeaserSourcesDto | null>(null)
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [showFull, setShowFull] = useState(false)

  // Cleanup interval on unmount
  useEffect(() => () => pollHandle?.cancel(), [pollHandle])

  // Pre-fetch the AI inputs so the curator sees them before generating.
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetching effect: sets loading state before the async sources prefetch
    setSourcesLoading(true)
    jsonFetch<{ sources: TeaserSourcesDto }>(
      `/api/promo/teaser-video/sources?sessionId=${encodeURIComponent(sessionId)}`
    )
      .then((data) => { if (!cancelled) setSources(data.sources) })
      .catch(() => { /* fall back to no preview */ })
      .finally(() => { if (!cancelled) setSourcesLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  const generate = useCallback(async () => {
    setStatus('queued')
    setError(null)
    setDoc(null)
    try {
      const result = await jsonFetch<RequestResult>('/api/promo/teaser-video', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      })
      toast.success('Teaser render queued')
      setStatus('rendering')
      const startedAt = Date.now()
      let cancelled = false
      const poll = async () => {
        if (cancelled) return
        try {
          const got = await jsonFetch<{ document: DocumentDto }>(
            `/api/documents/${result.documentId}`
          )
          if (got.document.rejectionReason) {
            setStatus('error')
            setError(got.document.rejectionReason)
            return
          }
          const bytes = typeof got.document.sizeBytes === 'string'
            ? parseInt(got.document.sizeBytes, 10)
            : got.document.sizeBytes
          if (bytes > 0) {
            setDoc(got.document)
            setStatus('ready')
            toast.success('Teaser ready')
            return
          }
        } catch (e) {
          console.debug('[teaser] poll error', (e as Error).message)
        }
        if (Date.now() - startedAt > POLL_MAX_MS) {
          setStatus('error')
          setError('Render is taking longer than expected. Check workers (npm run workers).')
          return
        }
        const t = setTimeout(poll, POLL_INTERVAL_MS)
        setPollHandle({ cancel: () => { cancelled = true; clearTimeout(t) } })
      }
      void poll()
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
      toast.error(`Could not generate teaser: ${(e as Error).message}`)
    }
  }, [sessionId])

  const hasAnySource = sources && (
    sources.counts.objectives > 0 ||
    sources.counts.studyMaterial > 0 ||
    sources.counts.preQuestions > 0 ||
    sources.tags.length > 0
  )

  return (
    <div className="space-y-4">
      {/* ─── AI source digest — visible always so curator sees what feeds the AI */}
      {sourcesLoading ? (
        <Card className="border-dashed">
          <CardContent className="py-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading session signals…
          </CardContent>
        </Card>
      ) : sources ? (
        <Card data-testid="teaser-source-digest">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-start gap-2">
              <Info className="size-4 mt-0.5 text-primary" />
              <div className="flex-1">
                <p className="text-sm font-semibold">What the AI will use</p>
                <p className="text-[11px] text-muted-foreground">
                  Title, host, time, plus the signals below. Add more objectives, study material, or
                  invite resident questions to sharpen the teaser.
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <SourceStat
                icon={<Target className="size-3.5" />}
                label="Objectives"
                count={sources.counts.objectives}
              />
              <SourceStat
                icon={<BookOpen className="size-3.5" />}
                label="Study material"
                count={sources.counts.studyMaterial}
              />
              <SourceStat
                icon={<MessageCircleQuestion className="size-3.5" />}
                label="Pre-questions"
                count={sources.counts.preQuestions}
                hint={sources.topPreQuestions.length > 0 ? `top: ${sources.topPreQuestions.length}` : undefined}
              />
            </div>

            {sources.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag className="size-3 text-muted-foreground" />
                {sources.tags.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {hasAnySource && (
              <button
                type="button"
                onClick={() => setShowFull((v) => !v)}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                {showFull ? 'Hide source detail' : 'Show source detail'}
              </button>
            )}

            {showFull && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-3 border-t border-border/50 pt-3 text-xs"
              >
                {sources.objectives.length > 0 && (
                  <div>
                    <p className="font-semibold text-foreground mb-1">Objectives ({sources.objectives.length})</p>
                    <ul className="space-y-1 list-decimal ml-5 text-muted-foreground">
                      {sources.objectives.map((o, i) => (
                        <li key={i}>{o.text} <span className="text-[10px] opacity-60">[Bloom {o.blooms}]</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {sources.studyMaterial.length > 0 && (
                  <div>
                    <p className="font-semibold text-foreground mb-1">Study material ({sources.studyMaterial.length})</p>
                    <ul className="space-y-1 list-disc ml-5 text-muted-foreground">
                      {sources.studyMaterial.map((m, i) => (
                        <li key={i}>
                          <span className="text-[10px] uppercase tracking-wider opacity-60">{m.kind}</span>{' '}
                          {m.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {sources.topPreQuestions.length > 0 && (
                  <div>
                    <p className="font-semibold text-foreground mb-1">
                      Top pre-questions ({sources.counts.preQuestions} total — sending top {sources.topPreQuestions.length})
                    </p>
                    <ul className="space-y-1 list-disc ml-5 text-muted-foreground">
                      {sources.topPreQuestions.map((q, i) => (
                        <li key={i}>{q.content} <span className="text-[10px] opacity-60">[{q.voteCount} votes]</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {!hasAnySource && (
                  <p className="italic text-muted-foreground">
                    No structured signals yet. The AI will fall back to title + description only.
                  </p>
                )}
              </motion.div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ─── Generate button */}
      <div className="flex items-center gap-2">
        <Button
          onClick={generate}
          disabled={status === 'queued' || status === 'rendering'}
          data-testid="teaser-video-generate"
        >
          {status === 'queued' || status === 'rendering' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {status === 'idle' && 'Generate teaser video'}
          {status === 'queued' && 'Queueing…'}
          {status === 'rendering' && 'Rendering…'}
          {status === 'ready' && 'Generate again'}
          {status === 'error' && 'Try again'}
        </Button>
        <p className="text-xs text-muted-foreground">
          15-second silent vertical MP4. ~5–10 sec to render.
        </p>
      </div>

      {status === 'rendering' && (
        <Card className="border-dashed">
          <CardContent className="pt-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            {sources && hasAnySource
              ? `Composing your teaser using ${sources.counts.objectives} objective${sources.counts.objectives === 1 ? '' : 's'}, ${sources.counts.studyMaterial} study item${sources.counts.studyMaterial === 1 ? '' : 's'}, and ${sources.counts.preQuestions} pre-question${sources.counts.preQuestions === 1 ? '' : 's'}.`
              : 'FFmpeg + resvg are composing your teaser. Sit tight.'}
          </CardContent>
        </Card>
      )}

      {status === 'error' && error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertCircle className="size-5 text-destructive mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {status === 'ready' && doc?.signedUrl && (
        <Card data-testid="teaser-video-preview">
          <CardContent className="pt-4 space-y-3">
            <video
              controls
              src={doc.signedUrl}
              className="w-full rounded-md bg-black aspect-[9/16] max-h-[80vh] object-contain"
              data-testid="teaser-video-element"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Film className="size-3.5" />
                {doc.title}
              </span>
              <a
                href={doc.signedUrl}
                download
                className="inline-flex items-center gap-1 text-primary hover:underline"
                data-testid="teaser-video-download"
              >
                <Download className="size-3.5" /> Download MP4
              </a>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SourceStat({
  icon, label, count, hint,
}: {
  icon: React.ReactNode
  label: string
  count: number
  hint?: string
}) {
  const empty = count === 0
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${empty ? 'border-dashed bg-muted/20' : 'bg-primary/5 border-primary/20'}`}
    >
      <div className={`flex size-7 items-center justify-center rounded-md ${empty ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className={`text-xs font-semibold ${empty ? 'text-muted-foreground' : 'text-foreground'}`}>
          {count} {label.toLowerCase()}
        </p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}
