'use client'

// ════════════════════════════════════════════════════════════════════════════
// RecordingViewer — redesigned with hero card, unified Q&A, Goals tab
// ════════════════════════════════════════════════════════════════════════════
// Desktop layout:  [Hero] / [video + tabs (Goals|Pearls|Transcript)]  [Q&A panel]
// Mobile layout:   [Hero] / [video] [Questions|Goals|Pearls|Transcript] tabs

import { useRef, useState, useTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RecordingPlayer } from './recording-player'
import { RecordingReplayLayer } from './recording-replay-layer'
import { QaSidebar } from '@/components/classroom/qa-sidebar'
import { SessionPearlsTab, type SessionPearl } from './session-pearls-tab'
import { TranscriptTab } from './transcript-tab'
import { ObjectivesChecklist, type ChecklistObjective } from '@/components/classroom/objectives-checklist'
import { PreSessionTab } from './pre-session-tab'
import {
  ThumbsUp, Bookmark, Share2, Gem, BookOpen, MessageSquare,
  User, Calendar, Clock, Captions, X, Copy, Check, Lock,
  Loader2, ExternalLink, Sparkles, VideoOff, Target, ClipboardList,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { csrfHeaders } from '@/lib/csrf-client'
import {
  toggleRecordingBookmarkAction,
  createRecordingShareAction,
} from '@/app/(platform)/classroom/[id]/recording/actions'

const FACULTY_LIKE_ROLES = new Set(['FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN'])

// ─── Types ───────────────────────────────────────────────────────────────────

interface CaptionTrack {
  language: string
  source: string
  vttUrl: string | null
}

interface Props {
  sessionId: string
  sessionTitle: string
  hostName: string | null
  scheduledStart: Date | string
  durationSec?: number | null

  hlsUrl: string | null
  posterUrl?: string | null
  tracks: CaptionTrack[]

  currentUser: { id: string; role: string }
  canPin: boolean
  canAnswer: boolean

  recordingId: string
  initialBookmarked: boolean
  canShare: boolean

  pearls: SessionPearl[]
  objectives?: ChecklistObjective[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'EN', hi: 'हि', te: 'తె', ta: 'த', kn: 'ಕ', ml: 'മ', mr: 'म', bn: 'বা', ur: 'اردو',
}

type TabId = 'questions' | 'presession' | 'goals' | 'pearls' | 'transcript'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RecordingViewer({
  sessionId, sessionTitle, hostName, scheduledStart, durationSec,
  hlsUrl, posterUrl, tracks,
  currentUser, canPin, canAnswer,
  recordingId, initialBookmarked, canShare,
  pearls,
  objectives = [],
}: Props) {
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const seekRef = useRef<((sec: number) => void) | null>(null)

  const [activeLang, setActiveLang] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('vaidix.captionLang')
      if (stored && tracks.some((t) => t.language === stored)) return stored
    }
    return tracks.find((t) => t.language === 'en')?.language ?? tracks[0]?.language ?? 'off'
  })

  // Default to Goals (self-assess) for residents, Pre-session context for others
  const defaultTab: TabId = objectives.length > 0 ? 'goals' : 'presession'
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab)
  const [bookmarked, setBookmarked] = useState(initialBookmarked)
  const [liked, setLiked] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [forging, setForging] = useState(false)
  const [forgeError, setForgeError] = useState<string | null>(null)
  const router = useRouter()

  const canForgeFromTranscript = FACULTY_LIKE_ROLES.has(currentUser.role) && tracks.length > 0
  const hasTracks = tracks.length > 0
  const completedObjectives = objectives.filter((o) => o.myStatus !== null).length

  // Build the tab list dynamically
  const TABS: { id: TabId; label: string; icon: typeof Gem }[] = [
    // Questions tab — mobile only (desktop Q&A lives in right panel)
    { id: 'questions', label: 'Questions', icon: MessageSquare },
    // Pre-session — always shown, even when empty
    { id: 'presession', label: 'Pre-session', icon: ClipboardList },
    // Goals tab — only if objectives exist (RESIDENT / EXTERNAL_LEARNER)
    ...(objectives.length > 0
      ? [{ id: 'goals' as TabId, label: 'Goals', icon: Target }]
      : []),
    { id: 'pearls', label: 'Pearls', icon: Gem },
    { id: 'transcript', label: 'Transcript', icon: BookOpen },
  ]

  async function handleForgeFromTranscript() {
    setForging(true)
    setForgeError(null)
    try {
      const res = await fetch('/api/decks/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ recordingId }),
      })
      const json = (await res.json()) as {
        ok: boolean
        data?: { jobId: string }
        error?: { message: string }
      }
      if (!json.ok || !json.data) {
        throw new Error(json.error?.message ?? `Forge failed (${res.status})`)
      }
      router.push(`/teacher/decks/${json.data.jobId}`)
    } catch (err) {
      setForgeError((err as Error).message)
    } finally {
      setForging(false)
    }
  }

  function handleLangChange(lang: string) {
    setActiveLang(lang)
    if (typeof window !== 'undefined') {
      if (lang === 'off') window.localStorage.removeItem('vaidix.captionLang')
      else window.localStorage.setItem('vaidix.captionLang', lang)
    }
  }

  function handleBookmark() {
    const prev = bookmarked
    setBookmarked(!prev)
    startTransition(async () => {
      try {
        const r = await toggleRecordingBookmarkAction(recordingId)
        setBookmarked(r.bookmarked)
      } catch {
        setBookmarked(prev)
      }
    })
  }

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Compact hero strip — title + meta + actions in 2 tight rows         */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div className="premium-hero relative mb-4 overflow-hidden rounded-2xl px-5 py-4 text-white">
        {/* Grain texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '18px 18px' }}
        />
        <div className="relative z-10 flex items-start gap-4">
          {/* Left: status chips + title + meta */}
          <div className="min-w-0 flex-1">
            {/* Row 1: status badge + inline stats */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-white/20">
                Completed
              </span>
              {durationSec != null && durationSec > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-white/60">
                  <Clock className="size-3" />{formatDuration(durationSec)}
                </span>
              )}
              {objectives.length > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-white/60">
                  <Target className="size-3" />{completedObjectives}/{objectives.length} goals
                </span>
              )}
              {pearls.length > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-white/60">
                  <Gem className="size-3" />{pearls.length} pearls
                </span>
              )}
            </div>
            {/* Row 2: title */}
            <h1 className="mt-1 truncate text-lg font-bold leading-tight tracking-tight sm:text-xl">
              {sessionTitle}
            </h1>
            {/* Row 3: meta */}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/60">
              {hostName && (
                <span className="flex items-center gap-1">
                  <User className="size-3" />{hostName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="size-3" />{formatDate(scheduledStart)}
              </span>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <motion.button
              onClick={() => setLiked((v) => !v)}
              whileTap={{ scale: 0.93 }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ring-1 transition-all',
                liked ? 'bg-white text-primary ring-white' : 'bg-white/15 text-white ring-white/20 hover:bg-white/25',
              )}
            >
              <ThumbsUp className={cn('size-3.5 transition-transform', liked && 'fill-current -rotate-6')} />
              Helpful
            </motion.button>

            <motion.button
              onClick={handleBookmark}
              disabled={isPending}
              whileTap={{ scale: 0.93 }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ring-1 transition-all',
                bookmarked ? 'bg-amber-400/90 text-amber-900 ring-amber-400/50' : 'bg-white/15 text-white ring-white/20 hover:bg-white/25',
              )}
            >
              <Bookmark className={cn('size-3.5', bookmarked && 'fill-current')} />
              {bookmarked ? 'Saved' : 'Save'}
            </motion.button>

            {canShare && (
              <motion.button
                onClick={() => setShareOpen(true)}
                whileTap={{ scale: 0.93 }}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm ring-1 ring-white/20 transition-all hover:bg-white/25"
              >
                <Share2 className="size-3.5" />
                Share
              </motion.button>
            )}

            {canForgeFromTranscript && (
              <motion.button
                onClick={handleForgeFromTranscript}
                disabled={forging}
                whileTap={{ scale: 0.93 }}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm ring-1 ring-white/20 transition-all hover:bg-white/25 disabled:opacity-50"
              >
                {forging ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                {forging ? 'Forging…' : 'Forge slides'}
              </motion.button>
            )}
          </div>
        </div>
        {forgeError && (
          <p className="relative z-10 mt-2 text-xs text-rose-300">{forgeError}</p>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Main grid                                                           */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_390px]">

        {/* ════ Left column ════ */}
        <div className="min-w-0 space-y-4">

          {/* Video */}
          <div className="relative">
            {hlsUrl ? (
              <RecordingPlayer
                hlsUrl={hlsUrl}
                posterUrl={posterUrl}
                tracks={tracks}
                onTimeUpdate={setCurrentTimeSec}
                seekRef={seekRef}
                activeLang={activeLang}
              />
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-zinc-900 text-white/80">
                <VideoOff className="size-10 opacity-50" />
                <p className="text-sm font-medium">No video recorded for this session</p>
                <p className="text-xs text-white/40">Transcript and discussion are still available.</p>
              </div>
            )}
            <RecordingReplayLayer sessionId={sessionId} currentTimeSec={currentTimeSec} />
          </div>

          {/* Caption language selector */}
          {hasTracks && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Captions className="size-3.5" />
                CC
              </span>
              <button
                onClick={() => handleLangChange('off')}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-all',
                  activeLang === 'off'
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
              >
                Off
              </button>
              {tracks.map((t) => (
                <button
                  key={t.language}
                  disabled={!t.vttUrl}
                  onClick={() => handleLangChange(t.language)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-all disabled:opacity-40',
                    activeLang === t.language
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                  )}
                >
                  {LANGUAGE_LABEL[t.language] ?? t.language.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* ─── Tab bar ─── */}
          <div>
            <div className="flex items-center gap-0.5 border-b border-border/60">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative flex items-center gap-1.5 px-4 pb-3 pt-1 text-sm font-semibold transition-colors',
                    // Questions tab: visible only on mobile (right panel handles desktop)
                    tab.id === 'questions' && 'xl:hidden',
                    activeTab === tab.id
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground/70',
                  )}
                >
                  <tab.icon className="size-3.5" />
                  {tab.label}
                  {tab.id === 'pearls' && pearls.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      {pearls.length}
                    </span>
                  )}
                  {tab.id === 'goals' && objectives.length > 0 && (
                    <span className={cn(
                      'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                      completedObjectives === objectives.length
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'bg-primary/10 text-primary',
                    )}>
                      {completedObjectives}/{objectives.length}
                    </span>
                  )}
                  {activeTab === tab.id && (
                    <motion.div
                      layoutId="tab-underline"
                      className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="pt-4"
              >
                {activeTab === 'questions' && (
                  <div className="h-[60vh] min-h-96 xl:hidden">
                    <div className="h-full overflow-hidden rounded-2xl border border-border shadow-sm">
                      <QaSidebar
                        sessionId={sessionId}
                        currentUser={currentUser}
                        currentTimeSec={currentTimeSec}
                        onSeek={(sec) => seekRef.current?.(sec)}
                        canPin={canPin}
                        canAnswer={canAnswer}
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'presession' && (
                  <PreSessionTab sessionId={sessionId} objectives={objectives} />
                )}

                {activeTab === 'goals' && (
                  <ObjectivesChecklist sessionId={sessionId} initial={objectives} />
                )}

                {activeTab === 'pearls' && (
                  <SessionPearlsTab pearls={pearls} />
                )}

                {activeTab === 'transcript' && (
                  <TranscriptTab
                    tracks={tracks}
                    currentTimeSec={currentTimeSec}
                    onSeek={(sec) => seekRef.current?.(sec)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* ════ Right column — unified Q&A panel (desktop only) ════ */}
        <aside className="hidden xl:flex xl:flex-col">
          <div className="sticky top-4 flex h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-border shadow-sm">
            <QaSidebar
              sessionId={sessionId}
              currentUser={currentUser}
              currentTimeSec={currentTimeSec}
              onSeek={(sec) => seekRef.current?.(sec)}
              canPin={canPin}
              canAnswer={canAnswer}
            />
          </div>
        </aside>
      </div>

      {/* ─── Share modal ─── */}
      <AnimatePresence>
        {shareOpen && (
          <ShareModal recordingId={recordingId} onClose={() => setShareOpen(false)} />
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Share modal ──────────────────────────────────────────────────────────────

function ShareModal({ recordingId, onClose }: { recordingId: string; onClose: () => void }) {
  const [ttlDays, setTtlDays] = useState(7)
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const result = await createRecordingShareAction({
        recordingId,
        ttlDays,
        password: usePassword && password.trim() ? password.trim() : undefined,
      })
      setLink(`${window.location.origin}/recordings/share/${result.token}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create share link')
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Share2 className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">Share recording</p>
              <p className="text-[11px] text-muted-foreground">Audited link — read-only access</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <X className="size-4" />
          </button>
        </div>

        {!link ? (
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Link expires in</p>
              <div className="flex flex-wrap gap-2">
                {[1, 7, 14, 30].map((d) => (
                  <button
                    key={d}
                    onClick={() => setTtlDays(d)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                      ttlDays === d
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {d === 1 ? '1 day' : `${d} days`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={usePassword}
                  onChange={(e) => setUsePassword(e.target.checked)}
                  className="size-4 accent-primary"
                />
                <Lock className="size-3.5 text-muted-foreground" />
                Password protect
              </label>
              <AnimatePresence>
                {usePassword && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <Input
                      type="password"
                      placeholder="Set a password (min 6 chars)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-2"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={creating}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={creating || (usePassword && password.trim().length < 6)}
              >
                {creating
                  ? <><Loader2 className="mr-1.5 size-3.5 animate-spin" />Creating…</>
                  : 'Create link'
                }
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 px-5 py-4">
            <p className="text-xs text-muted-foreground">
              Copy this link — shown once, not stored in plaintext.
            </p>
            <div className="flex items-center gap-2">
              <Input value={link} readOnly className="font-mono text-xs" />
              <Button size="sm" onClick={handleCopy} className="shrink-0">
                {copied
                  ? <><Check className="mr-1 size-3.5" />Copied</>
                  : <><Copy className="mr-1 size-3.5" />Copy</>
                }
              </Button>
            </div>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Open link <ExternalLink className="size-3" />
            </a>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
