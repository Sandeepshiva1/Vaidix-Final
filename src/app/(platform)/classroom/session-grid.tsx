'use client'

import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Video, Calendar, Clock, Users, Plus, PlayCircle, Radio,
  Search, Share2, Bookmark, Gem, SortDesc, X, Check, ThumbsUp,
  BookOpen, MessageCircleQuestion, RefreshCw, CheckCircle2, Pencil, Copy, ExternalLink, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ensureCsrfHeaders } from '@/lib/csrf-client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ListedSession {
  id: string
  title: string
  sessionType: string
  status: string
  scheduledStart: string
  scheduledEnd: string
  host: { id: string; name: string }
  /** Creator/proposer — may differ from host when a non-host scheduled it. */
  proposedById: string | null
  participantCount: number
  studyPackCount: number
  questionCount: number
  objectiveCount: number
  thumbnailUrl: string | null
  durationSec: number | null
  tags: string[]
  pearlCount: number
  isRecurring: boolean
}

function fmtUpcomingWhen(d: Date) {
  const date = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { key: 'all',             label: 'All' },
  { key: 'LECTURE',         label: 'Lecture' },
  { key: 'GRAND_ROUNDS',    label: 'Grand Rounds' },
  { key: 'CASE_CONFERENCE', label: 'Case Conference' },
  { key: 'JOURNAL_CLUB',    label: 'Journal Club' },
  { key: 'SKILLS_WORKSHOP', label: 'Skills' },
  { key: 'ASSESSMENT',      label: 'Assessment' },
] as const

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'popular', label: 'Most joined' },
] as const

type SortKey = (typeof SORT_OPTIONS)[number]['key']
type TypeKey = (typeof TYPE_FILTERS)[number]['key']

const typeBadge: Record<string, { bg: string; text: string; label: string }> = {
  LECTURE:         { bg: 'bg-blue-500/15',   text: 'text-blue-700 dark:text-blue-300',    label: 'Lecture' },
  GRAND_ROUNDS:    { bg: 'bg-amber-500/15',  text: 'text-amber-700 dark:text-amber-300',  label: 'Grand Rounds' },
  CASE_CONFERENCE: { bg: 'bg-purple-500/15', text: 'text-purple-700 dark:text-purple-300', label: 'Case Conf.' },
  JOURNAL_CLUB:    { bg: 'bg-teal-500/15',   text: 'text-teal-700 dark:text-teal-300',    label: 'Journal Club' },
  SKILLS_WORKSHOP: { bg: 'bg-pink-500/15',   text: 'text-pink-700 dark:text-pink-300',    label: 'Skills' },
  ASSESSMENT:      { bg: 'bg-slate-500/15',  text: 'text-slate-700 dark:text-slate-300',  label: 'Assessment' },
}

const typeGradients: Record<string, string> = {
  LECTURE:         'from-blue-900 via-blue-800 to-teal-800',
  GRAND_ROUNDS:    'from-amber-900 via-orange-800 to-red-900',
  CASE_CONFERENCE: 'from-purple-900 via-violet-800 to-indigo-900',
  JOURNAL_CLUB:    'from-teal-900 via-emerald-800 to-green-900',
  SKILLS_WORKSHOP: 'from-pink-900 via-rose-800 to-red-900',
  ASSESSMENT:      'from-slate-900 via-slate-800 to-gray-900',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function scheduledMins(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

function relativeDate(d: string) {
  const diffMs = Date.now() - new Date(d).getTime()
  // Within ±24 h → "Today"
  if (Math.abs(diffMs) < 86400000) return 'Today'
  const days = Math.floor(diffMs / 86400000)
  if (days < 0) return 'Today'           // future but close — treat as today
  if (days === 1) return '1 day ago'
  if (days < 7) return `${days} days ago`
  if (days < 14) return '1 week ago'
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ─── Main feed component ──────────────────────────────────────────────────────

interface FeedProps {
  live: ListedSession[]
  upcoming: ListedSession[]
  past: ListedSession[]
  nowMs: number
  canSchedule: boolean
  userId: string
  /** ADMIN / PROGRAM_DIRECTOR can edit any upcoming session, not just ones they host. */
  canManage: boolean
}

export function ClassroomFeed({ live, upcoming, past, nowMs, canSchedule, userId, canManage }: FeedProps) {
  const [activeTab, setActiveTab] = useState<'live' | 'upcoming' | 'past'>(
    live.length > 0 ? 'live' : upcoming.length > 0 ? 'upcoming' : 'past'
  )
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeKey>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [sortOpen, setSortOpen] = useState(false)

  const source = activeTab === 'live' ? live : activeTab === 'upcoming' ? upcoming : past

  const filtered = useMemo(() => {
    let items = [...source]
    if (typeFilter !== 'all') items = items.filter((s) => s.sessionType === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.host.name.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
      )
    }
    if (sort === 'newest') items.sort((a, b) => new Date(b.scheduledStart).getTime() - new Date(a.scheduledStart).getTime())
    if (sort === 'oldest') items.sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
    if (sort === 'popular') items.sort((a, b) => b.participantCount - a.participantCount)
    // Upcoming always soonest-first regardless of sort choice
    if (activeTab === 'upcoming') items.sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
    return items
  }, [source, typeFilter, search, sort, activeTab])

  const tabs = [
    { key: 'live' as const,     label: 'Live',     count: live.length,     isLive: true },
    { key: 'upcoming' as const, label: 'Upcoming', count: upcoming.length, isLive: false },
    { key: 'past' as const,     label: 'Replays',  count: past.length,     isLive: false },
  ]

  return (
    <div className="space-y-5">
      {/* ─── Header + inline search ─── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
            <Video className="size-4 text-primary" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Classroom</h1>
        </div>

        {/* Compact search — sits between title and CTA */}
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="ml-auto shrink-0">
          {canSchedule && (
            <Link
              href="/calendar/new"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              <Plus className="size-4" />
              Schedule
            </Link>
          )}
        </div>
      </div>

      {/* ─── Tab bar — segmented pill control ─── */}
      <div className="inline-flex items-center rounded-xl bg-muted/70 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="relative flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold"
          >
            {activeTab === tab.key && (
              <motion.div
                layoutId="tab-seg-bg"
                className="absolute inset-0 rounded-lg bg-card shadow-sm"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className={cn(
              'relative z-10 flex items-center gap-1.5 transition-colors',
              activeTab === tab.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/70'
            )}>
              {tab.isLive && tab.count > 0 && (
                <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
              )}
              {tab.label}
              <span className={cn(
                'rounded-full px-1.5 py-px text-[10px] font-bold',
                activeTab === tab.key
                  ? tab.isLive && tab.count > 0
                    ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                    : 'bg-primary/10 text-primary'
                  : 'bg-muted-foreground/15 text-muted-foreground'
              )}>
                {tab.count}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* ─── Filters + sort ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-all',
                typeFilter === f.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => setSortOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
          >
            <SortDesc className="size-3.5 text-muted-foreground" />
            {SORT_OPTIONS.find((o) => o.key === sort)?.label}
          </button>
          <AnimatePresence>
            {sortOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.14 }}
                className="absolute right-0 top-9 z-20 min-w-[140px] overflow-hidden rounded-xl border border-border bg-card shadow-xl"
              >
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => { setSort(o.key); setSortOpen(false) }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted',
                      sort === o.key && 'text-primary'
                    )}
                  >
                    {sort === o.key && <Check className="size-3" />}
                    {o.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ─── Results ─── */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${activeTab}-${typeFilter}-${sort}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {filtered.length === 0 ? (
            <EmptyState
              message={search ? `No results for "${search}"` : 'Nothing here yet'}
              canSchedule={canSchedule && activeTab === 'upcoming'}
            />
          ) : (
            <div className="grid auto-rows-fr gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((s, idx) => (
                <motion.div
                  key={s.id}
                  className="flex flex-col"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.04, 0.3), duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
                >
                  {s.status !== 'LIVE' && s.status !== 'ENDED'
                    ? <UpcomingCard session={s} nowMs={nowMs} isHost={s.host.id === userId} canManage={canManage || s.proposedById === userId} />
                    : <VideoCard session={s} nowMs={nowMs} />}
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ─── Video Card ───────────────────────────────────────────────────────────────

function VideoCard({ session: s, nowMs }: { session: ListedSession; nowMs: number }) {
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [saved, setSaved] = useState(false)
  const [copiedShare, setCopiedShare] = useState(false)

  const start = new Date(s.scheduledStart)
  const isLive = s.status === 'LIVE'
  const isPast = s.status === 'ENDED'
  const inWindow = isLive || start.getTime() - nowMs <= 15 * 60 * 1000
  const href = isPast ? `/classroom/${s.id}/recording` : `/classroom/${s.id}`
  const badge = typeBadge[s.sessionType]
  const initials = s.host.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const duration = s.durationSec
    ? fmtDuration(s.durationSec)
    : `${scheduledMins(s.scheduledStart, s.scheduledEnd)}m`

  function handleLike(e: React.MouseEvent) {
    e.preventDefault()
    setLiked((v) => {
      setLikeCount((c) => v ? c - 1 : c + 1)
      return !v
    })
  }

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault()
    const url = `${window.location.origin}${href}`
    try {
      if (navigator.share) { await navigator.share({ title: s.title, url }); return }
      await navigator.clipboard.writeText(url)
      setCopiedShare(true)
      setTimeout(() => setCopiedShare(false), 2000)
    } catch { /* user cancelled */ }
  }

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* ── Thumbnail — edge-to-edge, no corner rounding needed (card clips) ── */}
      <Link href={href} className="relative block aspect-video w-full overflow-hidden bg-slate-900">
        {s.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.thumbnailUrl}
            alt={s.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <ThumbnailPlaceholder title={s.title} sessionType={s.sessionType} />
        )}

        {/* Hover play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-200 group-hover:bg-black/35">
          <PlayCircle className="size-14 text-white opacity-0 drop-shadow-2xl transition-all duration-200 group-hover:opacity-100 scale-75 group-hover:scale-100" />
        </div>

        {/* LIVE badge */}
        {isLive && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-lg bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white shadow-lg">
            <Radio className="size-2.5 animate-pulse" /> LIVE
          </div>
        )}

        {/* Duration pill */}
        {isPast && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-bold text-white">
            {duration}
          </div>
        )}

        {/* Upcoming date overlay */}
        {!isLive && !isPast && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55">
            <Calendar className="size-6 text-white/60" />
            <p className="text-sm font-bold text-white">
              {start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
            <p className="text-xs text-white/70">
              {start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        )}
      </Link>

      {/* ── Title + meta ── */}
      <div className="mt-3 flex gap-2.5 px-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary ring-2 ring-primary/10">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <Link href={href}>
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
              {s.title}
            </p>
          </Link>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{s.host.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {isPast ? (
              <>
                <span>{relativeDate(s.scheduledStart)}</span>
                <span className="opacity-40">·</span>
                <span className="flex items-center gap-0.5"><Users className="size-3" />{s.participantCount} joined</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <Calendar className="size-3" />{fmtUpcomingWhen(start)}
                </span>
                <span className="opacity-40">·</span>
                <span className="flex items-center gap-0.5">
                  <Clock className="size-3" />{scheduledMins(s.scheduledStart, s.scheduledEnd)} min
                </span>
                {s.isRecurring && (
                  <span className="flex items-center gap-0.5 text-primary">
                    <RefreshCw className="size-3" />Recurring
                  </span>
                )}
              </>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {badge && (
              <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold', badge.bg, badge.text)}>
                {badge.label}
              </span>
            )}
            {s.pearlCount > 0 && (
              <Link
                href={href}
                className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
              >
                <Gem className="size-2.5" />{s.pearlCount} pearl{s.pearlCount !== 1 ? 's' : ''}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Pre-class quick links (upcoming only) ── */}
      {!isPast && !isLive && (
        <div className="mt-2.5 flex items-center gap-1.5 px-3">
          <Link
            href={`/classroom/${s.id}/study`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary/5 py-1.5 text-[11px] font-semibold text-primary ring-1 ring-primary/15 transition hover:bg-primary/10"
          >
            <BookOpen className="size-3" />
            Study pack
          </Link>
          <Link
            href={`/classroom/${s.id}/pre-questions`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary/5 py-1.5 text-[11px] font-semibold text-primary ring-1 ring-primary/15 transition hover:bg-primary/10"
          >
            <MessageCircleQuestion className="size-3" />
            Ask &amp; vote
          </Link>
        </div>
      )}

      {/* ── Action bar ── */}
      <div className="mt-3 flex items-center gap-1.5 border-t border-border/50 px-3 pb-3 pt-3">
        {/* Like */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleLike}
          className={cn(
            'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
            liked
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
          )}
        >
          <ThumbsUp className={cn('size-3.5', liked && 'fill-current')} />
          Like{likeCount > 0 && ` · ${likeCount}`}
        </motion.button>

        {/* Save */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setSaved((v) => !v)}
          className={cn(
            'inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
            saved
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
          )}
        >
          <Bookmark className={cn('size-3.5', saved && 'fill-current')} />
          {saved ? 'Saved' : 'Save'}
        </motion.button>

        {/* Share */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleShare}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-muted py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:bg-muted/70 hover:text-foreground"
        >
          {copiedShare
            ? <><Check className="size-3.5 text-primary" />Copied!</>
            : <><Share2 className="size-3.5" />Share</>}
        </motion.button>
      </div>

      {/* CTA for live / upcoming */}
      {!isPast && (
        <Link
          href={href}
          className={cn(
            'mx-3 mb-3 mt-0 inline-flex w-[calc(100%-1.5rem)] items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all',
            inWindow
              ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {isLive ? (
            <><Radio className="size-3.5 animate-pulse" /> Join live now</>
          ) : inWindow ? (
            <><PlayCircle className="size-3.5" /> Join session</>
          ) : (
            <><Calendar className="size-3.5" /> Scheduled</>
          )}
        </Link>
      )}
    </div>
  )
}

// ─── Upcoming Event Card ─────────────────────────────────────────────────────

function countdown(startMs: number, nowMs: number) {
  const diff = startMs - nowMs
  if (diff <= 0) return 'starting now'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (days > 1) return `in ${days} days`
  if (days === 1) return 'tomorrow'
  if (hours > 0) return `in ${hours}h ${mins}m`
  if (mins > 0) return `in ${mins} min`
  return 'very soon'
}

function UpcomingCard({ session: s, nowMs, isHost, canManage }: { session: ListedSession; nowMs: number; isHost: boolean; canManage: boolean }) {
  const start = new Date(s.scheduledStart)
  const inWindow = start.getTime() - nowMs <= 15 * 60 * 1000
  const href = `/classroom/${s.id}`
  const badge = typeBadge[s.sessionType]
  const initials = s.host.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
  const mins = scheduledMins(s.scheduledStart, s.scheduledEnd)

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* Thin teal accent — the console uses one restrained accent, not a
          per-type rainbow bar + tinted hero. */}
      <div className="h-[3px] w-full bg-primary/70" />

      {/* Date hero — neutral surface (console aesthetic) */}
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-4">
        <div>
          <p className="text-4xl font-black leading-none tracking-tight text-foreground">
            {start.getDate()}
          </p>
          <p className="mt-0.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {start.toLocaleString('en', { month: 'short' })}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {start.toLocaleString('en', { weekday: 'long' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-black text-primary">
            {countdown(start.getTime(), nowMs)}
          </p>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
            {start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
          </p>
          <p className="text-[11px] text-muted-foreground">{mins} min</p>
        </div>
      </div>

      {/* Title + host */}
      <div className="flex gap-2.5 px-3 pt-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary ring-2 ring-primary/10">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <Link href={href}>
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
              {s.title}
            </p>
          </Link>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{s.host.name}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {badge && (
              <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold', badge.bg, badge.text)}>
                {badge.label}
              </span>
            )}
            {isHost && (
              <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                Hosting
              </span>
            )}
            {s.isRecurring && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                <RefreshCw className="size-2.5" /> Recurring
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Prep status strip — visible to all, shows what's ready */}
      <div className="mx-3 mt-3 flex items-stretch overflow-hidden rounded-xl border border-border/50">
        <PrepStatusChip label="Objectives" done={s.objectiveCount > 0} value={s.objectiveCount > 0 ? `${s.objectiveCount} set` : 'Pending'} />
        <div className="w-px bg-border/50" />
        <PrepStatusChip label="Materials" done={s.studyPackCount > 0} value={s.studyPackCount > 0 ? `${s.studyPackCount} added` : 'Pending'} />
        <div className="w-px bg-border/50" />
        <PrepStatusChip label="Questions" done={s.questionCount > 0} value={s.questionCount > 0 ? `${s.questionCount} asked` : 'Pending'} />
      </div>

      {/* Pre-class links — always vibrant, badge appears when content exists */}
      <div className="mt-2 flex items-center gap-1.5 px-3">
        <Link
          href={`/classroom/${s.id}/study`}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-500/10 py-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/20 transition hover:bg-emerald-500/20 dark:text-emerald-400"
        >
          <BookOpen className="size-3" />
          {isHost ? 'Manage pack' : 'Study pack'}
          {s.studyPackCount > 0 ? (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold leading-none text-white">
              {s.studyPackCount}
            </span>
          ) : (
            <span className="ml-0.5 text-[9px] text-emerald-500/60">{isHost ? '+add' : '+add'}</span>
          )}
        </Link>
        <Link
          href={`/classroom/${s.id}/pre-questions`}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-violet-500/10 py-1.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-500/20 transition hover:bg-violet-500/20 dark:text-violet-400"
        >
          <MessageCircleQuestion className="size-3" />
          {isHost ? 'Review Q&A' : 'Ask & vote'}
          {s.questionCount > 0 ? (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[9px] font-bold leading-none text-white">
              {s.questionCount}
            </span>
          ) : (
            <span className="ml-0.5 text-[9px] text-violet-500/60">+add</span>
          )}
        </Link>
      </div>

      {/* Bottom row — Share + Edit (host) + Study hub + Join */}
      <div className="mx-3 mt-3 mb-3 flex items-center gap-1.5">
        <ShareButton sessionId={s.id} title={s.title} fallbackHref={href} canShare={isHost || canManage} />
        {/* Editable until the session starts — host always, admins/PDs for any session. */}
        {(isHost || canManage) && <EditButton sessionId={s.id} />}
        <Link
          href={`/classroom/${s.id}/study`}
          className={cn(
            'inline-flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-bold transition-all',
            inWindow
              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
          )}
        >
          <BookOpen className="size-3.5" /> Study hub
        </Link>
        <Link
          href={href}
          className={cn(
            'inline-flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-bold transition-all',
            inWindow
              ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
              : 'border border-border bg-muted/40 text-muted-foreground hover:bg-muted/70'
          )}
          title={inWindow ? 'Join the live session' : `Opens ${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · join becomes available 15 min before`}
        >
          <PlayCircle className="size-3.5" />
          {inWindow ? 'Join now' : 'Join'}
        </Link>
      </div>
    </div>
  )
}

// ─── Prep status chip (used by UpcomingCard) ─────────────────────────────────

function PrepStatusChip({ label, done, value }: { label: string; done: boolean; value: string }) {
  return (
    <div className={cn(
      'flex flex-1 flex-col items-center gap-0.5 px-2 py-2',
      done ? 'bg-emerald-50/60 dark:bg-emerald-900/10' : 'bg-amber-50/40 dark:bg-amber-900/5'
    )}>
      <span className={cn(
        'text-[9px] font-bold uppercase tracking-widest',
        done ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500 dark:text-amber-400'
      )}>
        {label}
      </span>
      <span className={cn(
        'flex items-center gap-0.5 text-[10px] font-semibold',
        done ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-400'
      )}>
        {done
          ? <CheckCircle2 className="size-3 shrink-0" />
          : <span className="size-2 shrink-0 rounded-full border border-amber-400" />}
        {value}
      </span>
    </div>
  )
}

// ─── Share button (used by UpcomingCard) ─────────────────────────────────────

function EditButton({ sessionId }: { sessionId: string }) {
  return (
    <Link
      href={`/classroom/${sessionId}/edit`}
      title="Edit session"
      className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      <Pencil className="size-4" />
    </Link>
  )
}

function ShareButton({
  sessionId,
  title,
  fallbackHref,
  canShare,
}: {
  sessionId: string
  title: string
  /** Plain in-app session URL used when the viewer can't mint a public link. */
  fallbackHref: string
  /** Host / PD / admin can mint a public no-login link; others copy the in-app URL. */
  canShare: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  async function resolveShareUrl(): Promise<{ url: string; isPublic: boolean }> {
    if (canShare) {
      try {
        const res = await fetch(`/api/classroom/sessions/${sessionId}/public-share`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await ensureCsrfHeaders()) },
        })
        const body = await res.json().catch(() => null)
        if (res.ok && body?.data?.url) return { url: body.data.url as string, isPublic: true }
      } catch { /* fall through to in-app URL */ }
    }
    return { url: `${window.location.origin}${fallbackHref}`, isPublic: false }
  }

  // Open the popup, minting the link on the way in.
  async function handleOpen(e: React.MouseEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setCopied(false)
    try {
      const { url: u, isPublic: pub } = await resolveShareUrl()
      setUrl(u)
      setIsPublic(pub)
      setOpen(true)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select the link and copy manually.')
    }
  }

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={handleOpen}
        disabled={busy}
        title="Share session link"
        className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
      </motion.button>

      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-9999 grid place-items-center bg-black/40 p-4 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.14 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl shadow-black/20"
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <h3 className="text-[15px] font-semibold text-foreground">Share “{title}”</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              {isPublic
                ? 'Anyone with this link can view the session details — no login required.'
                : 'Copy the link to this session.'}
            </p>

            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 flex-1 rounded-xl border border-input bg-muted/40 px-3 text-[12.5px] text-foreground outline-none"
                aria-label="Share link"
              />
              <button
                type="button"
                onClick={copy}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-teal-500"
              >
                {copied ? <><Check className="size-4" />Copied</> : <><Copy className="size-4" />Copy</>}
              </button>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[12.5px] font-medium text-foreground transition-colors hover:bg-foreground/5"
              >
                <ExternalLink className="size-3.5" /> Open
              </a>
            </div>
          </motion.div>
        </div>,
        document.body,
      )}
    </>
  )
}

// ─── Thumbnail placeholder ────────────────────────────────────────────────────

function ThumbnailPlaceholder({ title, sessionType }: { title: string; sessionType: string }) {
  const gradient = typeGradients[sessionType] ?? 'from-slate-900 via-slate-800 to-slate-700'
  const words = title.trim().split(/\s+/).slice(0, 4).join(' ')
  return (
    <div className={cn('flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br p-5', gradient)}>
      <div className="flex size-10 items-center justify-center rounded-xl bg-white/10">
        <Video className="size-5 text-white/70" />
      </div>
      <p className="line-clamp-2 text-center text-xs font-semibold leading-snug text-white/75">{words}</p>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ message, canSchedule }: { message: string; canSchedule: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-muted/20 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Video className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">{message}</p>
        {canSchedule && (
          <Link
            href="/calendar/new"
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            Schedule a session
          </Link>
        )}
      </div>
    </div>
  )
}
