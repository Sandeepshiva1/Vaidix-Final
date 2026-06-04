'use client'

// ════════════════════════════════════════════════════════════════════════════
// Pre-Conference Prep Block — shared surface for SCHEDULED + PENDING sessions
// ════════════════════════════════════════════════════════════════════════════
// Renders the 3-tab Pre-Conference panel (Study Pack curator + Readiness +
// Teaser video) above the LiveSession pre-join screen for host/teacher/PD/admin.
// Same component re-used inside pending-session-manager via PreConferencePanels
// — extracted here so the SCHEDULED page can render without duplicating code.

import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ClipboardList, BookOpen, Activity, Sparkles, Target, ShieldCheck,
  Wand2, Loader2, CheckCircle2, Check, Layers, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StudyPackCurator } from './study-pack-curator'
import { ReadinessPanel } from './readiness-panel'
import { TeaserVideoButton } from './teaser-video-button'
import { ObjectivesChipList, type ObjectiveRow } from './objectives-chip-list'
import { ObjectivesCurator } from './objectives-curator'
import { ensureCsrfHeaders } from '@/lib/csrf-client'
import type { PrereqConfig } from '@/lib/validation/session'

export function PreConferencePrepBlock({
  sessionId,
  canCurate,
  objectives = [],
  topic,
  prereqConfig,
}: {
  sessionId: string
  canCurate: boolean
  objectives?: ObjectiveRow[]
  topic?: { name: string; subspecialty: string | null } | null
  prereqConfig?: PrereqConfig | null
}) {
  const [tab, setTab] = useState<'objectives' | 'pack' | 'readiness' | 'teaser'>('objectives')
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto mt-6 mb-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      data-testid="pre-conference-panels"
    >
      <div className="border-b border-border px-6 py-3 flex flex-wrap items-center gap-2">
        <ClipboardList className="size-4 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wider text-foreground">
          Pre-Conference Prep
        </span>
        {prereqConfig && prereqConfig.mode !== 'NONE' && (
          <PrereqBadge config={prereqConfig} />
        )}
        {topic && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
            <BookOpen className="size-3" />
            {topic.name}
            {topic.subspecialty && (
              <span className="font-normal text-primary/70">· {topic.subspecialty}</span>
            )}
          </span>
        )}
      </div>
      {objectives.length > 0 && (
        <div className="border-b border-border px-6 py-4">
          <ObjectivesChipList objectives={objectives} />
        </div>
      )}
      <div className="p-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList variant="line" className="mb-5">
            <TabsTrigger value="objectives" data-testid="prep-tab-objectives">
              <Target className="size-3.5" /> Objectives
            </TabsTrigger>
            <TabsTrigger value="pack" data-testid="prep-tab-pack">
              <BookOpen className="size-3.5" /> Study Pack
            </TabsTrigger>
            <TabsTrigger value="readiness" data-testid="prep-tab-readiness">
              <Activity className="size-3.5" /> Readiness
            </TabsTrigger>
            <TabsTrigger value="teaser" data-testid="prep-tab-teaser">
              <Sparkles className="size-3.5" /> Teaser video
            </TabsTrigger>
          </TabsList>
          <TabsContent value="objectives">
            {canCurate ? (
              <div className="space-y-4">
                <PromoShareBanner sessionId={sessionId} />
                <ObjectivesCurator sessionId={sessionId} />
              </div>
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Only the host (or PD/admin) can edit objectives. Read-only preview is in the chip list above.
                </CardContent>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="pack">
            {canCurate ? (
              <StudyPackCurator sessionId={sessionId} />
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Only the host (or PD/admin) can curate the study pack. Preview the resident view at{' '}
                  <a href={`/classroom/${sessionId}/study`} className="text-primary hover:underline">
                    /classroom/{sessionId}/study
                  </a>.
                </CardContent>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="readiness">
            <ReadinessPanel sessionId={sessionId} />
          </TabsContent>
          <TabsContent value="teaser">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">AI Promo Teaser Video</CardTitle>
                <CardDescription>
                  Generate a 15-second silent vertical MP4 to share on WhatsApp Status / Instagram Reels.
                  Copy is auto-written by Gemini with a clinical-marketing persona.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TeaserVideoButton sessionId={sessionId} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </motion.div>
  )
}

// Presenter-only callout that mints a public share link (flyer + WhatsApp
// banner + Instagram card) for this session. Surfaced next to the objectives
// editor so the host sees it the moment they're authoring objectives. Visible
// regardless of objective count — empty/short objective lists may yield a
// sparser asset, but the affordance stays discoverable.
function PromoShareBanner({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState<'idle' | 'generating' | 'sharing'>('idle')
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const publishingRef = useRef(false)
  const shareUrlRef = useRef<string | null>(null)

  async function publishShare() {
    if (publishingRef.current || shareUrlRef.current) return
    publishingRef.current = true
    setBusy('sharing')
    let ok = false
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch('/api/promo/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrf },
        body: JSON.stringify({ sessionId }),
      })
      const j = (await res.json()) as
        | { ok: true; data: { url: string; expiresAt: string } }
        | { ok: false; error: { code: string; message: string } }
      if (!res.ok || !j.ok) {
        if (!j.ok && j.error.code === 'NO_ASSETS') {
          toast.message('No promo assets yet — generating first…')
          setBusy('generating')
          const gen = await fetch('/api/promo/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...csrf },
            body: JSON.stringify({ sessionId }),
          })
          if (!gen.ok) {
            const g = (await gen.json()) as { error?: { message?: string } }
            toast.error(g.error?.message ?? `HTTP ${gen.status}`)
            return
          }
          setBusy('sharing')
          const r2 = await fetch('/api/promo/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...csrf },
            body: JSON.stringify({ sessionId }),
          })
          const j2 = (await r2.json()) as
            | { ok: true; data: { url: string; expiresAt: string } }
            | { ok: false; error: { message: string } }
          if (!r2.ok || !j2.ok) {
            toast.error(!j2.ok ? j2.error.message : `HTTP ${r2.status}`)
            return
          }
          setShareUrl(j2.data.url)
          shareUrlRef.current = j2.data.url
          ok = true
          toast.success('Share link ready')
          return
        }
        toast.error(!j.ok ? j.error.message : `HTTP ${res.status}`)
        return
      }
      setShareUrl(j.data.url)
      shareUrlRef.current = j.data.url
      ok = true
      toast.success('Share link ready')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy('idle')
      if (!ok) publishingRef.current = false
    }
  }

  function copyShareUrl() {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      },
      () => toast.error('Could not copy'),
    )
  }

  if (dismissed && !shareUrl) return null

  return (
    <AnimatePresence mode="wait">
      {shareUrl ? (
        <motion.div
          key="success"
          data-testid="promo-banner-success"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden rounded-xl border border-emerald-300/40 bg-linear-to-r from-emerald-50 to-teal-50/60 dark:border-emerald-800/40 dark:from-emerald-900/15 dark:to-teal-900/10"
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
              <CheckCircle2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-emerald-900 dark:text-emerald-200">Share link ready</p>
              <p className="truncate text-[11px] font-mono text-emerald-800/80 dark:text-emerald-300/80">{shareUrl}</p>
            </div>
            <button
              type="button"
              onClick={copyShareUrl}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-emerald-700"
            >
              {copied ? <><Check className="size-3.5" /> Copied</> : <><Layers className="size-3.5" /> Copy link</>}
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="cta"
          data-testid="promo-banner"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden rounded-xl border border-amber-300/40 bg-linear-to-r from-amber-50 via-amber-50/70 to-rose-50/60 dark:border-amber-700/30 dark:from-amber-900/15 dark:via-amber-900/10 dark:to-rose-900/10"
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-amber-400 to-amber-600 text-white shadow-sm">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-amber-900 dark:text-amber-200">Share this session</p>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-300/70">
                Generate flyer + WhatsApp + Instagram from your objectives and mint a public link in one click.
              </p>
            </div>
            <button
              type="button"
              data-testid="promo-generate-share"
              onClick={() => void publishShare()}
              disabled={busy !== 'idle'}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
            >
              {busy === 'sharing'
                ? <><Loader2 className="size-3.5 animate-spin" /> Publishing…</>
                : busy === 'generating'
                ? <><Loader2 className="size-3.5 animate-spin" /> Generating…</>
                : <><Wand2 className="size-3.5" /> Generate &amp; share</>}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="shrink-0 rounded-lg p-1.5 text-amber-700/70 transition hover:bg-amber-200/50 dark:text-amber-300/60"
              title="Dismiss"
              aria-label="Dismiss share banner"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function PrereqBadge({ config }: { config: PrereqConfig }) {
  const enabled = [
    config.requirePreQuestions ? `pre-Qs ≥ ${config.minPreQuestions}` : null,
    config.requireStudyPack ? 'study pack' : null,
    config.requireReadinessAck ? 'readiness' : null,
  ].filter(Boolean)
  const cls =
    config.mode === 'MANDATORY'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
      data-testid="curator-prereq-badge"
    >
      <ShieldCheck className="size-3" />
      Gate: {config.mode === 'MANDATORY' ? 'Required' : 'Show only'}
      {enabled.length > 0 && (
        <span className="font-normal opacity-80">· {enabled.join(', ')}</span>
      )}
    </span>
  )
}
