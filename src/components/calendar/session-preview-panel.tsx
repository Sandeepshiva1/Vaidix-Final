'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Clock, Users, RefreshCw, ExternalLink, BookOpen, Activity,
  Search, BookMarked, Wrench, ClipboardList, ChevronDown, ChevronUp,
  ArrowRight, Zap, Video, CheckCircle2, Circle, Radio,
  MessageSquare, BarChart3, CalendarClock, Link2, Check,
} from 'lucide-react'
import Link from 'next/link'
import { format, differenceInMinutes } from 'date-fns'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PanelCalEvent {
  id: string
  sessionId: string
  title: string
  start: Date
  end: Date
  resource: {
    status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED'
    approvalStatus: 'DRAFT' | 'PENDING_FACULTY' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
    host: { id: string; name: string } | null
    isRecurring: boolean
  }
}

interface StudentActivityRow {
  userId: string
  name: string
  email: string
  preWorkDone: boolean
  preQuestionAsked: boolean
  rsvpStatus: string | null
  attended: boolean
  isActive: boolean
  attendanceDurationMin: number | null
  evalSubmitted: boolean
  objectivesMarked: boolean
}

interface SessionPreview {
  id: string
  title: string
  sessionType: string
  status: string
  approvalStatus: string
  scheduledStart: string
  scheduledEnd: string
  isRecurring: boolean
  openToAll: boolean
  host: { id: string; name: string; email: string; role: string } | null
  cohort: {
    id: string
    name: string
    memberCount: number
    members: { id: string; name: string; email: string }[]
  } | null
  participantCount: number
  studentActivity: StudentActivityRow[] | null
}

export interface SessionPreviewPanelProps {
  event: PanelCalEvent | null
  allEvents: PanelCalEvent[]
  onClose: () => void
  onNavigate: (sessionId: string) => void
}

// ── Config & helpers ──────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, {
  label: string
  Icon: React.FC<{ className?: string }>
  cls: string
}> = {
  LECTURE:         { label: 'Lecture',         Icon: BookOpen,      cls: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800' },
  GRAND_ROUNDS:    { label: 'Grand Rounds',    Icon: Activity,      cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800' },
  CASE_CONFERENCE: { label: 'Case Conference', Icon: Search,        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
  JOURNAL_CLUB:    { label: 'Journal Club',    Icon: BookMarked,    cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
  SKILLS_WORKSHOP: { label: 'Skills Workshop', Icon: Wrench,        cls: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800' },
  ASSESSMENT:      { label: 'Assessment',      Icon: ClipboardList, cls: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-800' },
}

function statusMeta(status: string, approvalStatus: string) {
  if (status === 'LIVE')                    return { label: 'Live now',  dot: '#16a34a', cls: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300',   pulse: true  }
  if (approvalStatus === 'APPROVED')        return { label: 'Approved',  dot: '#2563eb', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',    pulse: false }
  if (approvalStatus === 'PENDING_FACULTY') return { label: 'Pending',   dot: '#d97706', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',  pulse: false }
  if (approvalStatus === 'DRAFT')           return { label: 'Draft',     dot: '#94a3b8', cls: 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400',  pulse: false }
  return                                           { label: 'Cancelled', dot: '#f43f5e', cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',      pulse: false }
}

function nameInitials(name: string) {
  return name.trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_PALETTE = [
  'bg-violet-100 text-violet-700', 'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700', 'bg-orange-100 text-orange-700',
  'bg-teal-100 text-teal-700', 'bg-indigo-100 text-indigo-700',
]
const avatarCls = (i: number) => AVATAR_PALETTE[i % AVATAR_PALETTE.length]

// ── Phase badge components ────────────────────────────────────────────────────

function PreBadge({ done, asked }: { done: boolean; asked: boolean }) {
  if (done) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
        <CheckCircle2 className="size-2.5" />
        Ready
      </span>
    )
  }
  if (asked) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
        <MessageSquare className="size-2.5" />
        Q&amp;A
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
      <Circle className="size-2.5" />
      Pre
    </span>
  )
}

function LiveBadge({
  attended,
  isActive,
  sessionStatus,
}: {
  attended: boolean
  isActive: boolean
  sessionStatus: string
}) {
  if (sessionStatus === 'SCHEDULED') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
        <Circle className="size-2.5" />
        Live
      </span>
    )
  }
  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-1.5 py-0.5 text-[9px] font-bold text-green-700">
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-green-500" />
        </span>
        Active
      </span>
    )
  }
  if (attended) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
        <CheckCircle2 className="size-2.5" />
        Attended
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-500">
      <Circle className="size-2.5" />
      Absent
    </span>
  )
}

function PostBadge({
  submitted,
  objectivesMarked,
  sessionStatus,
}: {
  submitted: boolean
  objectivesMarked: boolean
  sessionStatus: string
}) {
  if (sessionStatus !== 'ENDED') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
        <Circle className="size-2.5" />
        Post
      </span>
    )
  }
  if (submitted || objectivesMarked) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">
        <CheckCircle2 className="size-2.5" />
        Evaluated
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
      <Circle className="size-2.5" />
      Post
    </span>
  )
}

// ── Student activity section ──────────────────────────────────────────────────

function PhaseStat({
  label,
  count,
  total,
  color,
}: {
  label: string
  count: number
  total: number
  color: string
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="text-lg font-bold leading-none text-foreground">
        {count}
        <span className="text-xs font-semibold text-muted-foreground">/{total}</span>
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: 'easeOut', delay: 0.1 }}
        />
      </div>
    </div>
  )
}

function StudentActivitySection({
  students,
  sessionStatus,
}: {
  students: StudentActivityRow[]
  sessionStatus: string
}) {
  const [expanded, setExpanded] = useState(true)
  const total = students.length

  const preCount = students.filter((s) => s.preWorkDone || s.preQuestionAsked).length
  const liveCount = students.filter((s) => s.attended).length
  const activeCount = students.filter((s) => s.isActive).length
  const postCount = students.filter((s) => s.evalSubmitted || s.objectivesMarked).length

  const liveLabel =
    sessionStatus === 'LIVE'
      ? `Live (${activeCount} active)`
      : sessionStatus === 'ENDED'
      ? 'Attended'
      : 'Joined'

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Section header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 transition hover:bg-muted/30 rounded-xl"
      >
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-lg bg-primary/10">
            <Users className="size-3.5 text-primary" />
          </div>
          <span className="text-xs font-bold text-foreground">Student Readiness</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
            {total}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {/* Phase summary stats */}
              <div className="mb-4 grid grid-cols-3 gap-2">
                <PhaseStat label="Pre-Session" count={preCount} total={total} color="#3b82f6" />
                <PhaseStat label={liveLabel} count={liveCount} total={total} color="#10b981" />
                <PhaseStat
                  label="Post-Session"
                  count={postCount}
                  total={total}
                  color="#8b5cf6"
                />
              </div>

              {/* Column header */}
              <div className="mb-1.5 flex items-center gap-3 px-3">
                <div className="size-7 shrink-0" />
                <p className="min-w-0 flex-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  Student
                </p>
                <div className="flex shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  <span className="w-13 text-center">Pre</span>
                  <span className="w-14.5 text-center">Live</span>
                  <span className="w-15.5 text-center">Post</span>
                </div>
              </div>

              {/* Student rows */}
              <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
                {students.map((s, i) => (
                  <motion.div
                    key={s.userId}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.15 }}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-muted/40"
                  >
                    <div
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
                        avatarCls(i)
                      )}
                    >
                      {nameInitials(s.name)}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                      {s.name}
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                      <div className="w-13 flex justify-center">
                        <PreBadge done={s.preWorkDone} asked={s.preQuestionAsked} />
                      </div>
                      <div className="w-14.5 flex justify-center">
                        <LiveBadge
                          attended={s.attended}
                          isActive={s.isActive}
                          sessionStatus={sessionStatus}
                        />
                      </div>
                      <div className="w-15.5 flex justify-center">
                        <PostBadge
                          submitted={s.evalSubmitted}
                          objectivesMarked={s.objectivesMarked}
                          sessionStatus={sessionStatus}
                        />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SessionPreviewPanel({ event, allEvents, onClose, onNavigate }: SessionPreviewPanelProps) {
  const [preview, setPreview]   = useState<SessionPreview | null>(null)
  const [loading, setLoading]   = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  // `copied` flips to true for ~1.6s after the host clicks the guest-link
  // copy button, swapping the icon to a checkmark. Cheap visual feedback —
  // the alternative (a toast) would require pulling a global notification
  // primitive into a leaf component.
  const [copied, setCopied] = useState(false)

  const targetId = activeId ?? event?.sessionId

  const concurrent = event
    ? allEvents.filter(
        (e) => e.sessionId !== event.sessionId && e.start < event.end && e.end > event.start
      )
    : []

  const allTabs = event ? [event, ...concurrent] : []

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate reset of selection/preview when the previewed event changes (prop-driven reset)
    setActiveId(null)
    setPreview(null)
  }, [event?.sessionId])

  useEffect(() => {
    if (!targetId) return
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard data-fetching effect: sets loading/cleared state before the async preview fetch
    setLoading(true)
    setPreview(null)
    fetch(`/api/calendar/session-preview/${targetId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setPreview(j.data.session) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [targetId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const activeTabId = activeId ?? event?.sessionId

  return (
    <AnimatePresence>
      {event && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            style={{ maxHeight: 'min(88vh, 780px)' }}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
              <div className="flex items-center gap-2">
                <Video className="size-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Session Details</span>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Concurrent sessions tabs */}
            {concurrent.length > 0 && (
              <div className="shrink-0 border-b border-border bg-amber-50/70 px-6 pb-3 pt-3 dark:bg-amber-950/20">
                <div className="mb-2.5 flex items-center gap-2">
                  <Zap className="size-3.5 text-amber-500" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
                    {allTabs.length} concurrent sessions — click a tab to preview
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {allTabs.map((tab) => {
                    const isActive = tab.sessionId === activeTabId
                    const sm = statusMeta(tab.resource.status, tab.resource.approvalStatus)
                    return (
                      <button
                        key={tab.sessionId}
                        onClick={() =>
                          setActiveId(tab.sessionId === event.sessionId ? null : tab.sessionId)
                        }
                        className={cn(
                          'min-w-37 shrink-0 rounded-xl border px-3 py-2 text-left transition',
                          isActive
                            ? 'border-primary/40 bg-white shadow-sm dark:bg-card'
                            : 'border-border bg-white/60 hover:border-primary/20 hover:bg-white dark:bg-card/50 dark:hover:bg-card'
                        )}
                      >
                        <div className="mb-0.5 flex items-center gap-1.5">
                          <span className="size-1.5 shrink-0 rounded-full" style={{ background: sm.dot }} />
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {isActive ? 'Viewing' : sm.label}
                          </span>
                        </div>
                        <p className="truncate text-xs font-semibold text-foreground">{tab.title}</p>
                        {tab.resource.host && (
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {tab.resource.host.name}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              <AnimatePresence mode="wait">
                {loading ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center gap-3 py-20"
                  >
                    <div className="size-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                    <span className="text-xs text-muted-foreground">Loading details…</span>
                  </motion.div>
                ) : preview ? (
                  <motion.div
                    key={targetId}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                    className="space-y-4 p-6"
                  >
                    {/* Type + Status */}
                    <div className="flex items-start justify-between gap-3">
                      <TypeBadge sessionType={preview.sessionType} />
                      <StatusBadge status={preview.status} approvalStatus={preview.approvalStatus} />
                    </div>

                    {/* Title */}
                    <div>
                      <h2 className="text-xl font-bold leading-snug text-foreground">
                        {preview.title}
                      </h2>
                      {preview.isRecurring && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <RefreshCw className="size-3" />
                          Recurring session
                        </p>
                      )}
                    </div>

                    {/* Time */}
                    <TimeBlock start={preview.scheduledStart} end={preview.scheduledEnd} />

                    {/* Faculty + Cohort */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-muted/20 p-4">
                        <FacultyBlock host={preview.host} />
                      </div>
                      <div className="rounded-xl border border-border bg-muted/20 p-4">
                        <CohortSummary cohort={preview.cohort} openToAll={preview.openToAll} />
                      </div>
                    </div>

                    {/* Student activity (faculty/admin only) */}
                    {preview.studentActivity && preview.studentActivity.length > 0 && (
                      <StudentActivitySection
                        students={preview.studentActivity}
                        sessionStatus={preview.status}
                      />
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => onNavigate(preview.id)}
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 active:scale-95"
                      >
                        {preview.status === 'LIVE' ? (
                          <>
                            <Radio className="size-3.5" />
                            Join Now
                          </>
                        ) : (
                          <>
                            Open Session
                            <ArrowRight className="size-3.5" />
                          </>
                        )}
                      </button>
                      {/* Reschedule — visible for non-ended sessions. The
                          /edit page already gates write access server-side
                          (host / proposer / ADMIN / PROGRAM_DIRECTOR), so
                          surfacing the link to everyone is safe — non-
                          authorized users get redirected back. */}
                      {preview.status !== 'ENDED' && preview.status !== 'CANCELLED' && (
                        <Link
                          href={`/classroom/${preview.id}/edit`}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-accent active:scale-95"
                        >
                          <CalendarClock className="size-3.5" />
                          Reschedule
                        </Link>
                      )}
                      {/* Copy guest link — only meaningful when the session is
                          openToAll (Teams-style "anyone with the link can
                          join"). For invite-only sessions the URL would just
                          bounce visitors to /login, which isn't a "share
                          link" UX, so we hide the button there. The host can
                          flip openToAll on the /edit page. */}
                      {preview.openToAll && preview.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/classroom/${preview.id}`
                            // Modern Clipboard API is HTTPS-only; on prod
                            // (https://vaidix.arthivaa.com) we're fine. The
                            // fallback is a no-op — clipboard write rejection
                            // just leaves `copied` false and the user can
                            // long-press the button to read the tooltip URL.
                            navigator.clipboard?.writeText(url).then(() => {
                              setCopied(true)
                              setTimeout(() => setCopied(false), 1600)
                            }).catch(() => {})
                          }}
                          title={`Copy: ${typeof window !== 'undefined' ? window.location.origin : ''}/classroom/${preview.id}`}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-accent active:scale-95"
                          data-testid="copy-guest-link"
                        >
                          {copied ? (
                            <>
                              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Link2 className="size-3.5" />
                              Copy guest link
                            </>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => onNavigate(preview.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-accent active:scale-95"
                      >
                        <ExternalLink className="size-3" />
                        Full details
                      </button>
                      {preview.studentActivity && (
                        <div className="ml-auto flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                          <BarChart3 className="size-3" />
                          {preview.studentActivity.filter((s) => s.preWorkDone || s.preQuestionAsked).length}/{preview.studentActivity.length} pre-ready
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ sessionType }: { sessionType: string }) {
  const cfg = TYPE_CONFIG[sessionType]
  if (!cfg) {
    return (
      <span className="inline-flex items-center rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
        {sessionType}
      </span>
    )
  }
  const { label, Icon, cls } = cfg
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold', cls)}>
      <Icon className="size-3" />
      {label}
    </span>
  )
}

function StatusBadge({ status, approvalStatus }: { status: string; approvalStatus: string }) {
  const { label, dot, cls, pulse } = statusMeta(status, approvalStatus)
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', cls)}>
      <span className="relative flex size-1.5 shrink-0">
        {pulse && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
        )}
        <span className="relative inline-flex size-1.5 rounded-full" style={{ background: dot }} />
      </span>
      {label}
    </span>
  )
}

function TimeBlock({ start, end }: { start: string; end: string }) {
  const s    = new Date(start)
  const e    = new Date(end)
  const mins = differenceInMinutes(e, s)
  const h    = Math.floor(mins / 60)
  const m    = mins % 60
  const dur  = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`
  return (
    <div className="flex items-start gap-3 rounded-xl bg-muted/30 px-4 py-3">
      <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
      <div>
        <p className="text-sm font-semibold text-foreground">
          {format(s, 'EEEE, MMM d')} · {format(s, 'h:mm a')} – {format(e, 'h:mm a')}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{dur}</p>
      </div>
    </div>
  )
}

function FacultyBlock({ host }: { host: SessionPreview['host'] }) {
  return (
    <div>
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Teacher Host
      </p>
      {host ? (
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {nameInitials(host.name)}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{host.name}</p>
            <p className="text-xs capitalize text-muted-foreground">
              {host.role.toLowerCase().replace(/_/g, ' ')}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">Host not assigned</p>
      )}
    </div>
  )
}

function CohortSummary({
  cohort,
  openToAll,
}: {
  cohort: SessionPreview['cohort']
  openToAll: boolean
}) {
  return (
    <div>
      <p className="mb-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Cohort
      </p>
      {cohort ? (
        <>
          <p className="text-sm font-semibold text-foreground">{cohort.name}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3" />
            {cohort.memberCount} {cohort.memberCount === 1 ? 'student' : 'students'} enrolled
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {openToAll ? 'Anyone with link can join' : 'Invite-only session'}
        </p>
      )}
    </div>
  )
}
