'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { RRule, Frequency } from 'rrule'
import {
  Copy, Check, Loader2,
  Globe, UsersRound, UserCheck, Lock, Repeat, AlertCircle,
  GraduationCap, Activity, FolderOpen, BookMarked, Wrench, ClipboardCheck,
  ChevronRight, ChevronLeft, CalendarDays, Clock, Sparkles, Zap,
  ChevronDown, Plus, X,
} from 'lucide-react'
import type { PrereqConfig } from '@/lib/validation/session'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { type ObjectiveDraft } from '@/components/classroom/objectives-editor'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { UserPicker, type PickableUser } from '@/components/user-picker'
import { CohortQuickAdd } from '@/components/cohort-quick-add'

interface Faculty { id: string; name: string; email: string; role: string }
interface Cohort { id: string; name: string; memberCount: number }
interface Topic { id: string; name: string; subspecialty: string | null }

interface EditingState {
  sessionId: string
  initial: {
    title: string
    description: string | null
    sessionType: SessionType
    hostId: string
    topicId: string | null
    scheduledStart: string
    scheduledEnd: string
    openToAll: boolean
    cohortId: string | null
    invitees: PickableUser[]
    recordingEnabled: boolean
    consentRequired: boolean
    objectives: ObjectiveDraft[]
    prereq: PrereqConfig | null
    recurrenceRule: string | null
  }
}

interface Props {
  faculty: Faculty[]
  cohorts: Cohort[]
  topics: Topic[]
  defaultStart?: string
  defaultEnd?: string
  currentUserId: string
  currentUserRole: string
  editing?: EditingState
}

type SessionType = 'LECTURE' | 'GRAND_ROUNDS' | 'CASE_CONFERENCE' | 'JOURNAL_CLUB' | 'SKILLS_WORKSHOP' | 'ASSESSMENT'
type EndMode = 'count' | 'date' | 'never'
type AudienceAxis = 'openToAll' | 'cohort' | 'invite' | 'private'

const SESSION_TYPES: Array<{
  value: SessionType; label: string; desc: string
  icon: typeof GraduationCap; gradient: string; iconColor: string
  selectedBorder: string; selectedBg: string; glow: string
}> = [
  { value: 'LECTURE',          label: 'Lecture',         desc: 'Structured didactic teaching',    icon: GraduationCap,  gradient: 'from-blue-500/30 to-blue-500/5',    iconColor: 'text-blue-600 dark:text-blue-400',    selectedBorder: 'border-blue-500',    selectedBg: 'bg-blue-500/8',    glow: 'shadow-blue-500/25' },
  { value: 'GRAND_ROUNDS',     label: 'Grand Rounds',    desc: 'Clinical case presentation',      icon: Activity,       gradient: 'from-violet-500/30 to-violet-500/5', iconColor: 'text-violet-600 dark:text-violet-400', selectedBorder: 'border-violet-500',  selectedBg: 'bg-violet-500/8',  glow: 'shadow-violet-500/25' },
  { value: 'CASE_CONFERENCE',  label: 'Case Conference', desc: 'Multi-team case review',          icon: FolderOpen,     gradient: 'from-orange-500/30 to-orange-500/5', iconColor: 'text-orange-600 dark:text-orange-400', selectedBorder: 'border-orange-500',  selectedBg: 'bg-orange-500/8',  glow: 'shadow-orange-500/25' },
  { value: 'JOURNAL_CLUB',     label: 'Journal Club',    desc: 'Literature review & critique',    icon: BookMarked,     gradient: 'from-amber-500/30 to-amber-500/5',   iconColor: 'text-amber-600 dark:text-amber-400',   selectedBorder: 'border-amber-500',   selectedBg: 'bg-amber-500/8',   glow: 'shadow-amber-500/25' },
  { value: 'SKILLS_WORKSHOP',  label: 'Skills Workshop', desc: 'Hands-on procedural practice',   icon: Wrench,         gradient: 'from-emerald-500/30 to-emerald-500/5',iconColor: 'text-emerald-600 dark:text-emerald-400',selectedBorder: 'border-emerald-500', selectedBg: 'bg-emerald-500/8', glow: 'shadow-emerald-500/25' },
  { value: 'ASSESSMENT',       label: 'Assessment',      desc: 'Quiz, OSCE or evaluation',        icon: ClipboardCheck, gradient: 'from-rose-500/30 to-rose-500/5',     iconColor: 'text-rose-600 dark:text-rose-400',     selectedBorder: 'border-rose-500',    selectedBg: 'bg-rose-500/8',    glow: 'shadow-rose-500/25' },
]

const AUDIENCE_OPTIONS: Array<{
  value: AudienceAxis; label: string; description: string
  icon: typeof Globe; accent: string; bg: string; border: string; glow: string
}> = [
  { value: 'openToAll', label: 'Anyone with link',      description: 'Share the URL — anyone can join the call & chat', icon: Globe,      accent: 'text-sky-600',     bg: 'bg-sky-500/10',     border: 'border-sky-500',     glow: 'shadow-sky-500/20' },
  { value: 'cohort',    label: 'Cohort',                description: 'Batch or specialty group members',                icon: UsersRound, accent: 'text-violet-600',  bg: 'bg-violet-500/10',  border: 'border-violet-500',  glow: 'shadow-violet-500/20' },
  { value: 'invite',    label: 'Invite specific people', description: 'Pick individuals to add to this session',        icon: UserCheck,  accent: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500', glow: 'shadow-emerald-500/20' },
  { value: 'private',   label: 'Private',               description: 'Only you and the host — no audience',            icon: Lock,       accent: 'text-slate-600',   bg: 'bg-slate-500/10',   border: 'border-slate-400',   glow: 'shadow-slate-500/20' },
]

// 3 steps: Session → Schedule & Audience → Finish
const STEPS = [
  { id: 'what',     label: 'Session',  subtitle: 'Format & title',   heading: "What's this session?",     sub: 'Name it and pick the format.' },
  { id: 'schedule', label: 'Schedule', subtitle: 'When & who joins', heading: 'Host, timing & audience',  sub: 'Set the schedule and who can join.' },
  { id: 'details',  label: 'Finish',   subtitle: 'Review & submit',  heading: 'Almost there!',            sub: 'Add optional details and schedule it.' },
]

const STEP_THEMES = [
  { gradient: 'from-blue-500/20 via-blue-400/8 to-transparent',     cBorder: 'border-blue-500/25',   icon: Sparkles,    iconBg: 'bg-blue-500/15',    iconColor: 'text-blue-600 dark:text-blue-400',    ring: 'ring-blue-500/30' },
  { gradient: 'from-violet-500/20 via-violet-400/8 to-transparent',  cBorder: 'border-violet-500/25', icon: CalendarDays, iconBg: 'bg-violet-500/15', iconColor: 'text-violet-600 dark:text-violet-400', ring: 'ring-violet-500/30' },
  { gradient: 'from-emerald-500/20 via-emerald-400/8 to-transparent',cBorder: 'border-emerald-500/25',icon: Zap,         iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400',ring: 'ring-emerald-500/30' },
]

const WEEKDAYS = [
  { label: 'Mo', rrule: RRule.MO }, { label: 'Tu', rrule: RRule.TU },
  { label: 'We', rrule: RRule.WE }, { label: 'Th', rrule: RRule.TH },
  { label: 'Fr', rrule: RRule.FR }, { label: 'Sa', rrule: RRule.SA },
  { label: 'Su', rrule: RRule.SU },
]

const DURATION_PRESETS = [
  { label: '30 min', minutes: 30 }, { label: '1 hour', minutes: 60 },
  { label: '1.5 h', minutes: 90 },  { label: '2 hours', minutes: 120 },
]

function toLocalInput(iso: string | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
function addMinutesToLocal(local: string, minutes: number) {
  const [datePart, timePart] = local.split('T')
  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, mi] = timePart.split(':').map(Number)
  const next = new Date(y, mo - 1, d, h, mi + minutes)
  return new Date(next.getTime() - next.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
function diffMinutes(start: string, end: string) {
  if (!start || !end) return null
  return Math.round((new Date(end.replace('T', ' ')).getTime() - new Date(start.replace('T', ' ')).getTime()) / 60000)
}
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}
function humanRole(r: string) {
  return r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}
function fmtLocal(local: string) {
  if (!local) return '—'
  return new Date(local.replace('T', ' ')).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Surface field-level Zod errors from the API. `details` is the
// `parsed.error.flatten().fieldErrors` shape: { fieldName: string[] }.
// Falls back to the top-level message when no field details are present.
function formatApiError(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { message?: string; details?: Record<string, string[] | undefined> }
  const details = e.details
  if (details && typeof details === 'object') {
    const parts: string[] = []
    for (const [field, msgs] of Object.entries(details)) {
      if (Array.isArray(msgs) && msgs.length > 0) parts.push(`${field}: ${msgs.join('; ')}`)
    }
    if (parts.length > 0) return parts.join(' · ')
  }
  return e.message ?? null
}

const slide = {
  enter: (d: number) => ({ x: d * 56, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:   (d: number) => ({ x: d * -56, opacity: 0 }),
}

// ─── Main component ───────────────────────────────────────────────────────────
export function NewSessionForm({
  faculty, cohorts, topics, defaultStart, defaultEnd, currentUserId, currentUserRole, editing,
}: Props) {
  const router = useRouter()
  const isEditing = !!editing
  const e0 = editing?.initial

  const [title, setTitle]           = useState(e0?.title ?? '')
  const [description, setDesc]      = useState(e0?.description ?? '')
  const [objectives] = useState<ObjectiveDraft[]>(e0?.objectives ?? [])
  const [sessionType, setSessionType] = useState<SessionType>(e0?.sessionType ?? 'LECTURE')
  const [topicId, setTopicId]       = useState(e0?.topicId ?? '')
  const [topicList, setTopicList]   = useState<Topic[]>(topics)
  const [hostId, setHostId]         = useState(
    e0?.hostId ??
    (currentUserRole === 'FACULTY' || currentUserRole === 'RESIDENT'
      ? currentUserId
      : (faculty[0]?.id ?? ''))
  )
  const [start, setStart]           = useState(
    e0 ? toLocalInput(e0.scheduledStart) : (toLocalInput(defaultStart) || '')
  )
  const [end, setEnd]               = useState(
    e0 ? toLocalInput(e0.scheduledEnd) : (toLocalInput(defaultEnd) || '')
  )

  const initialAxes: Set<AudienceAxis> = (() => {
    if (!e0) return new Set<AudienceAxis>(['cohort'])
    const s = new Set<AudienceAxis>()
    if (e0.openToAll) s.add('openToAll')
    if (e0.cohortId) s.add('cohort')
    if (e0.invitees && e0.invitees.length > 0) s.add('invite')
    if (s.size === 0) s.add('private')
    return s
  })()
  const [audience, setAudience]     = useState<Set<AudienceAxis>>(initialAxes)
  const [cohortId, setCohortId]     = useState(e0?.cohortId ?? '')
  const [invitees, setInvitees]     = useState<PickableUser[]>(e0?.invitees ?? [])

  function toggleAxis(axis: AudienceAxis) {
    setAudience((prev) => {
      const next = new Set(prev)
      if (axis === 'private') return new Set<AudienceAxis>(['private'])
      next.delete('private')
      if (next.has(axis)) {
        next.delete(axis)
        if (next.size === 0) next.add('private')
      } else {
        next.add(axis)
      }
      return next
    })
  }

  const initialRecurrence = (() => {
    if (!e0?.recurrenceRule) return null
    try {
      const rr = RRule.fromString(`DTSTART:${new Date(e0.scheduledStart).toISOString().replace(/[-:]/g, '').split('.')[0]}Z\nRRULE:${e0.recurrenceRule}`)
      const opts = rr.origOptions
      return {
        freq: opts.freq === Frequency.DAILY ? 'DAILY' : opts.freq === Frequency.MONTHLY ? 'MONTHLY' : 'WEEKLY',
        interval: opts.interval ?? 1,
        byDays: Array.isArray(opts.byweekday)
          ? new Set(opts.byweekday.map(d => typeof d === 'object' && 'toString' in d ? d.toString().slice(0, 2).toUpperCase() : String(d)))
          : new Set<string>(['MO']),
        endMode: (opts.count ? 'count' : opts.until ? 'date' : 'never') as EndMode,
        count: opts.count ?? 8,
        until: opts.until instanceof Date ? opts.until.toISOString().slice(0, 10) : '',
      }
    } catch { return null }
  })()

  const [repeats, setRepeats]         = useState(!!initialRecurrence)
  const [freq, setFreq]               = useState<'WEEKLY' | 'DAILY' | 'MONTHLY'>((initialRecurrence?.freq as 'WEEKLY' | 'DAILY' | 'MONTHLY') ?? 'WEEKLY')
  const [repeatEvery, setRepeatEvery] = useState(initialRecurrence?.interval ?? 1)
  const [byDays, setByDays]           = useState<Set<string>>(initialRecurrence?.byDays ?? new Set(['MO']))
  const [endMode, setEndMode]         = useState<EndMode>(initialRecurrence?.endMode ?? 'count')
  const [count, setCount]             = useState(initialRecurrence?.count ?? 8)
  const [endDate, setEndDate]         = useState(initialRecurrence?.until ?? '')
  const [excludedDates]               = useState<string[]>([]) // kept for API payload; UI removed

  const [genLink]                     = useState(false)
  const [linkTtl]                     = useState(48)
  const [createdLink, setCreatedLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [copied, setCopied]           = useState(false)

  const [prereqMode]                  = useState<PrereqConfig['mode']>(e0?.prereq?.mode ?? 'NONE')
  const [reqQ]                        = useState(e0?.prereq?.requirePreQuestions ?? false)
  const [minQ]                        = useState(e0?.prereq?.minPreQuestions ?? 1)
  const [reqPack]                     = useState(e0?.prereq?.requireStudyPack ?? false)
  const [reqAck]                      = useState(e0?.prereq?.requireReadinessAck ?? false)

  const [captionsProfile]             = useState<'english-only' | 'indic-mix' | 'off'>('english-only')

  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [step, setStep]               = useState(0)
  const [dir, setDir]                 = useState(1)
  const [stepErr, setStepErr]         = useState<string | null>(null)

  const hostIsSelf   = hostId === currentUserId
  const selectedHost = faculty.find((f) => f.id === hostId)
  const wantsOpenToAll = audience.has('openToAll')
  const wantsCohort    = audience.has('cohort')
  const wantsInvite    = audience.has('invite')
  const isPrivate      = audience.has('private')

  function validateStep(s: number): string | null {
    if (s === 0 && !title.trim()) return 'Give this session a title before continuing.'
    if (s === 1) {
      if (!start) return 'Pick a start date and time.'
      if (!end)   return 'Pick an end date and time.'
      const d = diffMinutes(start, end)
      if (d !== null && d <= 0) return 'End time must be after start.'
      // Past-time guard (matches the 5-minute server grace). disablePast on the
      // picker only blocks past *dates*, so a past time on today's date still
      // gets through the UI without this check.
      const startMs = new Date(start).getTime()
      if (Number.isFinite(startMs) && startMs < Date.now() - 5 * 60 * 1000) {
        return 'Start time has already passed — pick a future time.'
      }
      if (wantsCohort && !cohortId)            return 'Select a cohort or uncheck the Cohort option.'
      if (wantsInvite && invitees.length === 0) return 'Add at least one invitee or uncheck Invite specific people.'
    }
    return null
  }

  // Validate every step (used at submit-time so step 1 errors are caught even
  // when the user clicks Save from step 2).
  function validateAll(): { step: number; err: string } | null {
    for (let i = 0; i < STEPS.length; i += 1) {
      const err = validateStep(i)
      if (err) return { step: i, err }
    }
    return null
  }

  function goNext() {
    const err = validateStep(step)
    if (err) { setStepErr(err); return }
    setStepErr(null); setDir(1); setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  function goBack() {
    setStepErr(null); setDir(-1); setStep((s) => Math.max(s - 1, 0))
  }

  function buildRRule() {
    if (!repeats) return undefined
    const freqMap = { WEEKLY: Frequency.WEEKLY, DAILY: Frequency.DAILY, MONTHLY: Frequency.MONTHLY }
    const byweekday = freq === 'WEEKLY'
      ? WEEKDAYS.filter((w) => byDays.has(w.label.toUpperCase().slice(0, 2))).map((w) => w.rrule)
      : undefined
    const opts: ConstructorParameters<typeof RRule>[0] = {
      freq: freqMap[freq],
      ...(byweekday ? { byweekday } : {}),
      ...(repeatEvery > 1 ? { interval: repeatEvery } : {}),
      dtstart: new Date(start),
    }
    if (endMode === 'count') opts.count = count
    else if (endMode === 'date' && endDate) opts.until = new Date(endDate + 'T23:59:59Z')
    const rule = new RRule(opts)
    return rule.toString().split('\n').find((l) => l.startsWith('RRULE:'))?.replace('RRULE:', '')
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Validate every step so step-1 errors (e.g. past start time) surface when
    // saving from step 2, instead of bubbling up as a generic 422.
    const all = validateAll()
    if (all) { setStepErr(all.err); setDir(-1); setStep(all.step); return }
    setError(null); setSubmitting(true)
    try {
      if (isEditing && editing) {
        const patchBody = {
          title,
          description: description.trim().length === 0 ? null : description,
          topicId: topicId || null,
          objectives: objectives.length > 0 ? objectives.filter((o) => o.text.trim().length >= 3) : null,
          prereq: prereqMode === 'NONE' ? undefined : { mode: prereqMode, requirePreQuestions: reqQ, minPreQuestions: minQ, requireStudyPack: reqPack, requireReadinessAck: reqAck },
          openToAll: !isPrivate && wantsOpenToAll,
          cohortId: !isPrivate && wantsCohort && cohortId ? cohortId : null,
        }
        const patchRes = await fetch(`/api/classroom/sessions/${editing.sessionId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patchBody),
        })
        const patchJson = await patchRes.json()
        if (!patchJson.ok) throw new Error(formatApiError(patchJson.error) ?? 'Failed to save')

        // Tolerant comparison: the picker is minute-precision, so anything
        // within 60 s of the original is "unchanged". Without this, a session
        // whose stored scheduledStart has non-zero seconds always trips the
        // reschedule branch on save — and then re-validates against the
        // past-time guard, breaking edits to already-past sessions.
        const startMs    = new Date(start).getTime()
        const endMs      = new Date(end).getTime()
        const origStart  = new Date(editing.initial.scheduledStart).getTime()
        const origEnd    = new Date(editing.initial.scheduledEnd).getTime()
        const startChanged = Math.abs(startMs - origStart) >= 60 * 1000
        const endChanged   = Math.abs(endMs   - origEnd)   >= 60 * 1000
        if (startChanged || endChanged) {
          const r = await fetch(`/api/classroom/sessions/${editing.sessionId}/reschedule`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheduledStart: new Date(start).toISOString(), scheduledEnd: new Date(end).toISOString(), scope: 'series' }),
          })
          const rj = await r.json()
          if (!rj.ok) throw new Error(formatApiError(rj.error) ?? 'Failed to reschedule')
        }

        {
          const effectiveInvitees = isPrivate || !wantsInvite ? [] : invitees
          const initialIds = new Set(editing.initial.invitees.map((u) => u.id))
          const currentIds = new Set(effectiveInvitees.map((u) => u.id))
          const toAdd = effectiveInvitees.filter((u) => !initialIds.has(u.id)).map((u) => u.id)
          const toRemove = editing.initial.invitees.filter((u) => !currentIds.has(u.id)).map((u) => u.id)
          if (toAdd.length > 0) {
            const ar = await fetch(`/api/classroom/sessions/${editing.sessionId}/invites`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userIds: toAdd }),
            })
            const aj = await ar.json()
            if (!aj.ok) throw new Error(formatApiError(aj.error) ?? 'Failed to add invitees')
          }
          for (const userId of toRemove) {
            const dr = await fetch(`/api/classroom/sessions/${editing.sessionId}/invites/${userId}`, { method: 'DELETE' })
            const dj = await dr.json()
            if (!dj.ok) throw new Error(formatApiError(dj.error) ?? 'Failed to remove invitee')
          }
        }

        router.push(`/classroom/${editing.sessionId}/study`)
        router.refresh()
        return
      }

      const payload = {
        title, description: description || undefined, sessionType,
        topicId: topicId || undefined, hostId,
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd:   new Date(end).toISOString(),
        openToAll: !isPrivate && wantsOpenToAll,
        cohortId:   !isPrivate && wantsCohort ? cohortId : undefined,
        inviteeIds: !isPrivate && wantsInvite ? invitees.map((u) => u.id) : undefined,
        recurrenceRule: buildRRule(),
        maxParticipants: 100, recordingEnabled: true, consentRequired: true, tags: [],
        objectives: objectives.length > 0 ? objectives.filter((o) => o.text.trim().length >= 3) : undefined,
        prereq: prereqMode === 'NONE' ? undefined : { mode: prereqMode, requirePreQuestions: reqQ, minPreQuestions: minQ, requireStudyPack: reqPack, requireReadinessAck: reqAck },
        ...(excludedDates.length > 0 ? { excludedDates } : {}),
        captionsProfile,
      }
      const res  = await fetch('/api/classroom/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(formatApiError(json.error) ?? 'Failed to create session')

      const conflicts = (json.data?.warnings?.hostConflicts ?? []) as Array<{ title: string; scheduledStart: string }>
      if (conflicts.length > 0) {
        const c = conflicts[0]
        if (typeof window !== 'undefined') window.alert(`Heads up: host already has "${c.title}" at ${new Date(c.scheduledStart).toLocaleString()}. Scheduled anyway.`)
      }
      const newId = (json.data?.session ?? json.data)?.id
      if (genLink && newId) {
        const lr  = await fetch(`/api/classroom/sessions/${newId}/share-link`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ttlHours: linkTtl }),
        })
        const lb = await lr.json()
        if (lb.ok) { setCreatedLink({ url: lb.data.url, expiresAt: lb.data.expiresAt }); setSubmitting(false); return }
        setError(`Session created, but share link failed: ${lb.error?.message ?? 'unknown'}`)
      }
      router.push('/calendar')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function copyLink() {
    if (!createdLink) return
    await navigator.clipboard.writeText(createdLink.url)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  if (createdLink) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="overflow-hidden rounded-2xl border-2 border-emerald-300 bg-linear-to-br from-emerald-50 to-white dark:border-emerald-700 dark:from-emerald-950/50 dark:to-transparent"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <motion.div
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.1 }}
              className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 shadow-xl shadow-emerald-500/40"
            >
              <Check className="size-7 text-white" />
            </motion.div>
            <div>
              <p className="text-lg font-bold text-emerald-900 dark:text-emerald-200">Session scheduled!</p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">Share link expires {new Date(createdLink.expiresAt).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-stretch gap-2">
            <div className="flex-1 overflow-hidden rounded-xl border border-emerald-300 bg-white px-3 py-2.5 font-mono text-xs dark:bg-emerald-950/60 dark:text-emerald-100">
              <div className="truncate">{createdLink.url}</div>
            </div>
            <button type="button" onClick={copyLink}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 transition shadow-lg shadow-emerald-500/30"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <Button type="button" variant="outline" onClick={() => router.push('/calendar')}>Done</Button>
          </div>
        </div>
      </motion.div>
    )
  }

  const theme = STEP_THEMES[step]

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <StepBar steps={STEPS} current={step} onJump={(i) => {
        if (i < step) { setDir(-1); setStep(i); setStepErr(null) }
      }} />

      <div className="relative rounded-2xl border border-border bg-card shadow-md" style={{ minHeight: 440 }}>
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative"
          >
            <div className={cn('relative overflow-hidden bg-linear-to-br px-6 pt-6 pb-5 border-b border-border/40', theme.gradient)}>
              <div className={cn('pointer-events-none absolute -right-10 -top-10 size-40 rounded-full border-2 opacity-60', theme.cBorder)} />
              <div className={cn('pointer-events-none absolute -right-3 -top-3 size-24 rounded-full border opacity-40', theme.cBorder)} />
              <div className={cn('pointer-events-none absolute right-8 -top-6 size-14 rounded-full border opacity-25', theme.cBorder)} />
              <div className="flex items-center gap-3.5">
                <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-sm', theme.iconBg, `ring-2 ${theme.ring}`)}>
                  <theme.icon className={cn('size-5', theme.iconColor)} />
                </div>
                <div>
                  <h2 className="text-lg font-bold leading-tight tracking-tight">{STEPS[step].heading}</h2>
                  <p className="text-sm text-muted-foreground">{STEPS[step].sub}</p>
                </div>
                <div className="ml-auto text-3xl font-black text-foreground/5 select-none tabular-nums">{step + 1}</div>
              </div>
            </div>

            <div className="px-6 pb-6 pt-5">
              {step === 0 && (
                <StepWhat title={title} setTitle={setTitle} sessionType={sessionType} setSessionType={setSessionType} />
              )}
              {step === 1 && (
                <StepScheduleAndAudience
                  faculty={faculty} hostId={hostId} setHostId={setHostId}
                  currentUserId={currentUserId} currentUserRole={currentUserRole}
                  start={start} setStart={setStart} end={end} setEnd={setEnd}
                  repeats={repeats} setRepeats={setRepeats}
                  freq={freq} setFreq={setFreq}
                  repeatEvery={repeatEvery} setRepeatEvery={setRepeatEvery}
                  byDays={byDays} setByDays={setByDays}
                  endMode={endMode} setEndMode={setEndMode}
                  count={count} setCount={setCount}
                  endDate={endDate} setEndDate={setEndDate}
                  cohorts={cohorts}
                  audience={audience} toggleAxis={toggleAxis}
                  cohortId={cohortId} setCohortId={setCohortId}
                  invitees={invitees} setInvitees={setInvitees}
                  topics={topicList} setTopics={setTopicList}
                  topicId={topicId} setTopicId={setTopicId}
                />
              )}
              {step === 2 && (
                <StepDetails
                  title={title} sessionType={sessionType} selectedHost={selectedHost}
                  start={start} end={end} audience={audience}
                  repeats={repeats} count={count} freq={freq} repeatEvery={repeatEvery} endMode={endMode}
                  description={description} setDesc={setDesc}
                  submitting={submitting}
                />
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {(stepErr || error) && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {stepErr || error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center justify-between gap-4">
        <Button type="button" variant="ghost"
          onClick={step === 0 ? () => router.back() : goBack}
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        <div className="flex items-center gap-3">
          {hostIsSelf && step === STEPS.length - 1 && (
            <p className="hidden text-xs text-muted-foreground sm:block">You&apos;re hosting — schedules immediately</p>
          )}
          {step < STEPS.length - 1 ? (
            <motion.button key="next" type="button" onClick={goNext} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="group relative flex items-center gap-1.5 overflow-hidden rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md shadow-primary/30 transition-shadow hover:shadow-primary/50"
            >
              <span className="relative z-10 flex items-center gap-1.5">Continue <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
              <span className="absolute inset-0 bg-linear-to-r from-transparent to-white/10 opacity-0 transition-opacity group-hover:opacity-100" />
            </motion.button>
          ) : (
            <motion.button key="submit" type="submit" disabled={submitting} whileHover={{ scale: submitting ? 1 : 1.02 }} whileTap={{ scale: submitting ? 1 : 0.98 }}
              className="group relative flex items-center gap-2 overflow-hidden rounded-xl bg-primary px-7 py-2.5 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/35 transition-shadow hover:shadow-primary/55 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="relative z-10 flex items-center gap-2">
                {submitting
                  ? <><Loader2 className="size-4 animate-spin" /> {isEditing ? 'Saving…' : 'Scheduling…'}</>
                  : isEditing
                    ? <>Save changes <Check className="size-4 transition-transform group-hover:scale-110" /></>
                    : <>{hostIsSelf ? 'Schedule session' : 'Send for approval'} <Zap className="size-4 transition-transform group-hover:scale-110" /></>
                }
              </span>
              <span className="absolute inset-0 bg-linear-to-r from-transparent to-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
            </motion.button>
          )}
        </div>
      </div>
    </form>
  )
}

// ─── Step bar ─────────────────────────────────────────────────────────────────
function StepBar({ steps, current, onJump }: { steps: typeof STEPS; current: number; onJump: (i: number) => void }) {
  return (
    <div className="flex items-center px-1">
      {steps.map((s, i) => (
        <div key={s.id} className="flex flex-1 items-center">
          <motion.button type="button" onClick={() => onJump(i)} whileHover={i < current ? { scale: 1.04 } : {}}
            className={cn('flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition', i < current ? 'cursor-pointer' : 'cursor-default')}
          >
            <div className={cn(
              'relative flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-300',
              i < current  ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/40' :
              i === current ? 'bg-primary text-primary-foreground ring-4 ring-primary/25' :
              'bg-muted text-muted-foreground',
            )}>
              {i < current ? <Check className="size-3.5" /> : i + 1}
            </div>
            <div className="hidden sm:block">
              <p className={cn('text-xs font-bold leading-none', i <= current ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{s.subtitle}</p>
            </div>
          </motion.button>
          {i < steps.length - 1 && (
            <div className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-border">
              <motion.div className="absolute inset-y-0 left-0 bg-primary"
                animate={{ width: i < current ? '100%' : '0%' }}
                transition={{ duration: 0.4, ease: 'easeInOut' }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Step 1: Session ─────────────────────────────────────────────────────────
function StepWhat({ title, setTitle, sessionType, setSessionType }: {
  title: string; setTitle: (v: string) => void
  sessionType: SessionType; setSessionType: (v: SessionType) => void
}) {
  return (
    <div className="space-y-5">
      <input
        value={title} onChange={(e) => setTitle(e.target.value)}
        required maxLength={200}
        placeholder="e.g. Grand Rounds — Macular Holes"
        className="w-full rounded-2xl border-2 border-input bg-background px-4 py-3.5 text-[17px] font-semibold placeholder:font-normal placeholder:text-muted-foreground/40 focus:outline-none focus:ring-4 focus:ring-primary/20 focus:border-primary transition-all"
      />
      <div className="space-y-2.5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Format</p>
        {/* Compact 2-column format grid — horizontal chips instead of tall cards */}
        <div className="grid grid-cols-2 gap-2">
          {SESSION_TYPES.map((t) => {
            const Icon = t.icon
            const active = sessionType === t.value
            return (
              <motion.button key={t.value} type="button" onClick={() => setSessionType(t.value)}
                whileHover={{ scale: 1.02, transition: { type: 'spring', stiffness: 400, damping: 20 } }}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  'relative flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-all duration-200',
                  active
                    ? `${t.selectedBorder} ${t.selectedBg} shadow-md ${t.glow}`
                    : 'border-input hover:border-primary/20 hover:bg-accent/30',
                )}
              >
                <div className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                  active ? `bg-linear-to-br ${t.gradient}` : 'bg-muted',
                )}>
                  <Icon className={cn('size-3.5', active ? t.iconColor : 'text-muted-foreground')} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight truncate">{t.label}</p>
                  <p className={cn('text-[10px] leading-tight truncate', active ? 'text-foreground/60' : 'text-muted-foreground/60')}>{t.desc}</p>
                </div>
                <AnimatePresence>
                  {active && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                      className={cn('flex size-4 shrink-0 items-center justify-center rounded-full', t.selectedBg)}
                    >
                      <Check className={cn('size-2.5', t.iconColor)} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Step 2: Schedule + Audience (merged) ────────────────────────────────────
function StepScheduleAndAudience({
  faculty, hostId, setHostId, currentUserId, currentUserRole,
  start, setStart, end, setEnd,
  repeats, setRepeats, freq, setFreq,
  repeatEvery, setRepeatEvery,
  byDays, setByDays,
  endMode, setEndMode,
  count, setCount,
  endDate, setEndDate,
  cohorts,
  audience, toggleAxis,
  cohortId, setCohortId,
  invitees, setInvitees,
  topics, setTopics, topicId, setTopicId,
}: {
  faculty: Faculty[]; hostId: string; setHostId: (v: string) => void
  currentUserId: string; currentUserRole: string
  start: string; setStart: (v: string) => void; end: string; setEnd: (v: string) => void
  repeats: boolean; setRepeats: (v: boolean) => void
  freq: 'WEEKLY' | 'DAILY' | 'MONTHLY'; setFreq: (v: 'WEEKLY' | 'DAILY' | 'MONTHLY') => void
  repeatEvery: number; setRepeatEvery: (v: number) => void
  byDays: Set<string>; setByDays: (v: Set<string>) => void
  endMode: EndMode; setEndMode: (v: EndMode) => void
  count: number; setCount: (v: number) => void
  endDate: string; setEndDate: (v: string) => void
  cohorts: Cohort[]
  audience: Set<AudienceAxis>; toggleAxis: (axis: AudienceAxis) => void
  cohortId: string; setCohortId: (v: string) => void
  invitees: PickableUser[]; setInvitees: (v: PickableUser[]) => void
  topics: Topic[]; setTopics: (next: Topic[]) => void; topicId: string; setTopicId: (v: string) => void
}) {
  const selectedHost = faculty.find((f) => f.id === hostId)
  const hostIsSelf   = hostId === currentUserId
  const isFaculty    = currentUserRole === 'FACULTY'
  const isResident   = currentUserRole === 'RESIDENT'
  const isPrivate    = audience.has('private')

  const [creatingTopic, setCreatingTopic] = useState(false)
  const [newTopicName, setNewTopicName]   = useState('')
  const [topicSaving, setTopicSaving]     = useState(false)
  const [topicError, setTopicError]       = useState<string | null>(null)

  async function saveNewTopic() {
    const name = newTopicName.trim()
    if (name.length < 2) { setTopicError('Name must be at least 2 characters'); return }
    setTopicSaving(true); setTopicError(null)
    try {
      const res = await fetch('/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? 'Failed to create topic')
      const t = json.data.topic as Topic
      setTopics([...topics, t])
      setTopicId(t.id)
      setNewTopicName(''); setCreatingTopic(false)
    } catch (e) {
      setTopicError((e as Error).message)
    } finally {
      setTopicSaving(false)
    }
  }

  function onStartChange(v: string) {
    const dur = diffMinutes(start, end)
    setStart(v)
    setEnd(addMinutesToLocal(v, (dur && dur > 0) ? dur : 60))
  }

  const freqLabel = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' }[freq]
  const recurrenceSummary = repeats
    ? `Every ${repeatEvery > 1 ? `${repeatEvery} ${freqLabel}s` : freqLabel}${endMode === 'count' ? ` · ${count}×` : endMode === 'date' && endDate ? ` · until ${fmtDate(endDate)}` : ' · no end'}`
    : null

  return (
    <div className="space-y-5">
      {/* ── Host ── */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {isResident ? 'Host' : 'Teacher host'}
        </p>
        {isFaculty ? (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-primary/30 bg-primary/5 px-4 py-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {selectedHost ? initials(selectedHost.name) : '?'}
            </div>
            <div>
              <p className="text-sm font-bold">{selectedHost?.name ?? 'You'}</p>
              <p className="text-xs text-primary font-medium">✓ You&apos;re hosting — schedules immediately</p>
            </div>
          </div>
        ) : (
          <>
            <FacultySearch faculty={faculty} value={hostId} onChange={setHostId} currentUserId={currentUserId} />
            <AnimatePresence mode="wait">
              {selectedHost && (
                <motion.p key={hostId}
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={cn('text-xs', hostIsSelf ? 'font-medium text-primary' : 'text-muted-foreground')}
                >
                  {hostIsSelf
                    ? isResident
                      ? '✓ You\'re hosting a peer-led session — schedules immediately, no teacher approval needed.'
                      : '✓ You\'re hosting — schedules immediately, no approval needed.'
                    : `${selectedHost.name} will receive an approval request before publishing.`}
                </motion.p>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* ── Date / time ── */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Date &amp; time</p>
        <div className="grid grid-cols-2 gap-3">
          <DateTimePicker label="Start" required value={start} onChange={onStartChange} disablePast />
          <DateTimePicker label="End" required value={end} onChange={setEnd} min={start || undefined} disablePast />
        </div>
        {start && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Duration:</span>
            {DURATION_PRESETS.map((p) => {
              const active = diffMinutes(start, end) === p.minutes
              return (
                <motion.button key={p.minutes} type="button" whileTap={{ scale: 0.95 }}
                  onClick={() => setEnd(addMinutesToLocal(start, p.minutes))}
                  className={cn('rounded-full border-2 px-2.5 py-0.5 text-xs font-bold transition-all',
                    active ? 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/30' : 'border-input text-muted-foreground hover:border-primary/40',
                  )}
                >{p.label}</motion.button>
              )
            })}
            {(() => {
              const d = diffMinutes(start, end)
              if (!d || d <= 0 || DURATION_PRESETS.some((p) => p.minutes === d)) return null
              const h = Math.floor(d / 60), m = d % 60
              return <span className="rounded-full border border-dashed border-input px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">Custom · {h > 0 ? `${h}h ` : ''}{m > 0 ? `${m}m` : ''}</span>
            })()}
          </div>
        )}
      </div>

      {/* ── Recurrence (no exceptions) ── */}
      <div className={cn('rounded-2xl border-2 transition-colors duration-200', repeats ? 'border-primary/30 bg-primary/5' : 'border-input')}>
        <label className="flex cursor-pointer items-center gap-2.5 px-4 py-3 text-sm font-semibold">
          <input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} className="size-4 accent-primary rounded" />
          <Repeat className={cn('size-4 transition-colors', repeats ? 'text-primary' : 'text-muted-foreground')} />
          Repeat
          <AnimatePresence>
            {repeats && recurrenceSummary && (
              <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                className="ml-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary"
              >{recurrenceSummary}</motion.span>
            )}
          </AnimatePresence>
        </label>

        <AnimatePresence>
          {repeats && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="space-y-4 border-t border-border px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground font-medium">Every</span>
                  <input
                    type="number" min={1} max={52} value={repeatEvery}
                    onChange={(e) => setRepeatEvery(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 rounded-xl border-2 border-input bg-card px-2.5 py-1.5 text-center text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
                  />
                  <Select value={freq} onValueChange={(v) => setFreq((v ?? 'WEEKLY') as 'WEEKLY' | 'DAILY' | 'MONTHLY')}>
                    <SelectTrigger className="w-28 rounded-xl border-2 py-1.5 h-auto">
                      <SelectValue>{(v) => ({ DAILY: 'Day', WEEKLY: 'Week', MONTHLY: 'Month' } as Record<string, string>)[v as string] ?? 'Week'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAILY">Day</SelectItem>
                      <SelectItem value="WEEKLY">Week</SelectItem>
                      <SelectItem value="MONTHLY">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {freq === 'WEEKLY' && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">On</p>
                    <div className="flex gap-1.5">
                      {WEEKDAYS.map((w) => {
                        const key = w.label.toUpperCase().slice(0, 2)
                        const active = byDays.has(key)
                        return (
                          <motion.button key={key} type="button" whileTap={{ scale: 0.88 }}
                            onClick={() => { const n = new Set(byDays); if (active) n.delete(key); else n.add(key); setByDays(n) }}
                            className={cn(
                              'size-9 rounded-xl border-2 text-xs font-bold transition-all',
                              active ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-input text-muted-foreground hover:border-primary/40',
                            )}
                          >{w.label}</motion.button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">Ends</p>
                  <div className="space-y-2 rounded-xl border-2 border-input bg-card p-3">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input type="radio" name="endMode" checked={endMode === 'count'} onChange={() => setEndMode('count')} className="size-4 accent-primary" />
                      <span className="text-sm font-medium w-12">After</span>
                      <input type="number" min={1} max={365} value={count}
                        disabled={endMode !== 'count'}
                        onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
                        className="w-16 rounded-lg border-2 border-input bg-background px-2 py-1 text-center text-sm font-bold outline-none focus:border-primary disabled:opacity-40 transition"
                      />
                      <span className="text-sm text-muted-foreground">occurrence{count !== 1 ? 's' : ''}</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input type="radio" name="endMode" checked={endMode === 'date'} onChange={() => setEndMode('date')} className="size-4 accent-primary" />
                      <span className="text-sm font-medium w-12">By</span>
                      <input type="date" value={endDate} disabled={endMode !== 'date'}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="rounded-lg border-2 border-input bg-background px-2 py-1 text-sm font-medium outline-none focus:border-primary disabled:opacity-40 transition"
                      />
                    </label>
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input type="radio" name="endMode" checked={endMode === 'never'} onChange={() => setEndMode('never')} className="size-4 accent-primary" />
                      <span className="text-sm font-medium">Never ends</span>
                    </label>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Audience — side-by-side: axis pills left, config right ── */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Audience <span className="normal-case font-normal tracking-normal opacity-70">(pick any combination)</span>
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: '168px 1fr' }}>
          {/* Left: axis toggle pills */}
          <div className="space-y-1.5">
            {AUDIENCE_OPTIONS.map((opt) => {
              const Icon = opt.icon; const sel = audience.has(opt.value)
              return (
                <motion.label key={opt.value} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-xl border-2 px-2.5 py-2 transition-all duration-200',
                    sel ? `${opt.border} bg-card shadow-sm ${opt.glow}` : 'border-input hover:border-primary/20 hover:bg-accent/20',
                  )}
                >
                  <input type="checkbox" name={`audience-${opt.value}`} checked={sel} onChange={() => toggleAxis(opt.value)} className="sr-only" />
                  <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-lg transition-colors', sel ? opt.bg : 'bg-muted')}>
                    <Icon className={cn('size-3', sel ? opt.accent : 'text-muted-foreground')} />
                  </div>
                  <span className={cn('flex-1 text-xs font-semibold leading-tight', sel ? 'text-foreground' : 'text-muted-foreground')}>{opt.label}</span>
                  {sel && <Check className={cn('size-3 shrink-0', opt.accent)} />}
                </motion.label>
              )
            })}
          </div>

          {/* Right: configuration panel */}
          <div className="relative rounded-xl border-2 border-dashed border-border/60 bg-muted/10 p-3 overflow-hidden" style={{ minHeight: 156 }}>
            <AnimatePresence mode="wait">
              {isPrivate ? (
                <motion.div key="private-panel"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex h-full min-h-33 flex-col items-center justify-center gap-2 text-center"
                >
                  <div className="flex size-10 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                    <Lock className="size-4 text-slate-500" />
                  </div>
                  <p className="text-sm font-semibold text-muted-foreground">Private session</p>
                  <p className="text-xs text-muted-foreground/60">Only you and the host can join</p>
                </motion.div>
              ) : (
                <motion.div key="config-panel"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="space-y-3"
                >
                  {!audience.has('openToAll') && !audience.has('cohort') && !audience.has('invite') && (
                    <p className="py-8 text-center text-sm text-muted-foreground/60">Select an audience type on the left</p>
                  )}
                  {audience.has('openToAll') && (
                    <motion.div key="opentoall-config"
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2 rounded-lg bg-sky-500/8 border border-sky-500/20 px-3 py-2"
                    >
                      <Globe className="mt-0.5 size-3.5 shrink-0 text-sky-600" />
                      <p className="text-xs text-sky-700 dark:text-sky-400 leading-relaxed">A public link lets anyone join the live call — they won&apos;t see session materials or appear in the roster.</p>
                    </motion.div>
                  )}
                  {audience.has('cohort') && (
                    <motion.div key="cohort-config"
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className="space-y-1.5"
                    >
                      <p className="text-xs font-bold text-foreground">Cohort <span className="text-destructive">*</span></p>
                      <Select value={cohortId} onValueChange={(v) => setCohortId(v ?? '')}>
                        <SelectTrigger className="w-full rounded-xl border-2 bg-card py-2 h-auto text-sm">
                          <SelectValue placeholder="Pick a cohort">
                            {(v) => {
                              const c = cohorts.find((x) => x.id === v)
                              if (!c) return 'Pick a cohort'
                              return <span className="flex items-center gap-1.5"><UsersRound className="size-3.5 text-violet-600" /><span className="font-medium">{c.name}</span><span className="text-xs text-muted-foreground">· {c.memberCount}</span></span>
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {cohorts.length === 0
                            ? <div className="px-3 py-2 text-xs text-muted-foreground">No cohorts — create one in Admin → Cohorts</div>
                            : cohorts.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-2"><UsersRound className="size-3.5 text-violet-600" /><span className="font-medium">{c.name}</span><span className="text-xs text-muted-foreground">({c.memberCount})</span></span>
                              </SelectItem>
                            ))
                          }
                        </SelectContent>
                      </Select>
                    </motion.div>
                  )}
                  {audience.has('invite') && (
                    <motion.div key="invite-config"
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className="space-y-2"
                    >
                      <p className="text-xs font-bold text-foreground">Invite individuals <span className="text-destructive">*</span></p>
                      <CohortQuickAdd selected={invitees} onChange={setInvitees} />
                      <UserPicker selected={invitees} onChange={setInvitees} placeholder="Search by name or email…" purpose="invite" />
                      {invitees.length === 0 && (
                        <p className="flex items-center gap-1 text-xs text-amber-600">
                          <AlertCircle className="size-3 shrink-0" /> At least one invitee required.
                        </p>
                      )}
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Cohort and invitees control who sees the session in their feed.
          &ldquo;Anyone with link&rdquo; is additive — they join the call but don&apos;t get materials.
        </p>
      </div>

      {/* ── Topic (optional) ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Topic <span className="normal-case font-normal tracking-normal opacity-60">(optional)</span></p>
          {!creatingTopic && (
            <button type="button" onClick={() => { setCreatingTopic(true); setTopicError(null) }}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/10 transition"
            >
              <Plus className="size-3" /> New topic
            </button>
          )}
        </div>
        <Select value={topicId || 'none'} onValueChange={(v) => setTopicId(v === 'none' ? '' : (v ?? ''))}>
          <SelectTrigger className="h-11 w-full max-w-sm rounded-lg border bg-background px-3 text-sm font-medium">
            <SelectValue placeholder="No topic">
              {(v) => {
                if (!v || v === 'none') return <span className="text-muted-foreground">No topic</span>
                const t = topics.find((x) => x.id === v)
                if (!t) return <span className="text-muted-foreground">No topic</span>
                return <span className="flex items-center gap-2"><span>{t.name}</span>{t.subspecialty && <span className="text-xs text-muted-foreground">· {t.subspecialty}</span>}</span>
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="none"><span className="text-muted-foreground">No topic</span></SelectItem>
            {topics.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2"><span className="font-medium">{t.name}</span>{t.subspecialty && <span className="text-xs text-muted-foreground">· {t.subspecialty}</span>}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AnimatePresence>
          {creatingTopic && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-1 flex w-full max-w-sm items-center gap-1.5 rounded-lg border bg-card/50 p-1.5">
                <Input
                  autoFocus value={newTopicName}
                  onChange={(e) => { setNewTopicName(e.target.value); if (topicError) setTopicError(null) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveNewTopic() }
                    if (e.key === 'Escape') { setCreatingTopic(false); setNewTopicName(''); setTopicError(null) }
                  }}
                  placeholder="e.g. Diabetic Macular Edema"
                  className="h-8 flex-1 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
                  disabled={topicSaving}
                />
                <Button type="button" size="sm" onClick={saveNewTopic} disabled={topicSaving || newTopicName.trim().length < 2} className="h-8 px-3">
                  {topicSaving ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
                </Button>
                <button type="button" onClick={() => { setCreatingTopic(false); setNewTopicName(''); setTopicError(null) }}
                  disabled={topicSaving}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              {topicError && (
                <p className="mt-1 flex items-center gap-1 text-xs text-destructive"><AlertCircle className="size-3" /> {topicError}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <p className="text-xs text-muted-foreground">Links to the topic library — students find this session alongside related cases and atlas images.</p>
      </div>
    </div>
  )
}

// ─── Step 3: Details + Review ─────────────────────────────────────────────────
function StepDetails({
  title, sessionType, selectedHost, start, end, audience,
  repeats, count, freq,
  description, setDesc,
}: {
  title: string; sessionType: SessionType; selectedHost?: Faculty
  start: string; end: string; audience: Set<AudienceAxis>
  repeats: boolean; count: number; freq: string; repeatEvery: number; endMode: EndMode
  description: string; setDesc: (v: string) => void
  submitting: boolean
}) {
  const [materials, setMaterials] = useState<File[]>([])
  const typeConfig = SESSION_TYPES.find((t) => t.value === sessionType)!
  const TypeIcon   = typeConfig.icon
  const audienceAxes = AUDIENCE_OPTIONS.filter((o) => audience.has(o.value))
  const visOpt       = audienceAxes[0] ?? AUDIENCE_OPTIONS[3]
  const audienceLabel = audience.has('private') ? 'Private' : audienceAxes.map((o) => o.label).join(' · ')
  const dur        = diffMinutes(start, end)
  const durLabel   = dur && dur > 0 ? `${Math.floor(dur / 60) > 0 ? `${Math.floor(dur / 60)}h ` : ''}${dur % 60 > 0 ? `${dur % 60}m` : ''}`.trim() : null
  const freqLabel  = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' }[freq] ?? freq.toLowerCase()
  void freqLabel

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        className={cn('overflow-hidden rounded-xl border-2 px-4 py-3 bg-linear-to-br', typeConfig.gradient, typeConfig.selectedBorder)}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className={cn('mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest', typeConfig.selectedBg, typeConfig.iconColor)}>
              <TypeIcon className="size-2.5" />{typeConfig.label}
            </div>
            <p className="text-2xl font-black leading-tight tracking-tight truncate">
              {title || <span className="opacity-35 font-medium italic">Untitled</span>}
            </p>
          </div>
          <div className="shrink-0 space-y-1 pt-0.5 text-right text-xs text-foreground/60">
            {start && <p className="flex items-center justify-end gap-1"><CalendarDays className="size-3" />{fmtLocal(start)}</p>}
            {durLabel && (
              <p className="flex items-center justify-end gap-1"><Clock className="size-3" />{durLabel}
                {repeats && <span className="opacity-70"> · ×{count}</span>}
              </p>
            )}
            {selectedHost && (
              <p className="flex items-center justify-end gap-1.5">
                <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-primary/70 text-[7px] font-bold leading-none text-primary-foreground">{initials(selectedHost.name)}</span>
                <span className="max-w-30 truncate">{selectedHost.name}</span>
              </p>
            )}
            <p className="flex items-center justify-end gap-1">
              <visOpt.icon className={cn('size-3', visOpt.accent)} />{audienceLabel}
            </p>
          </div>
        </div>
      </motion.div>

      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Description</p>
        <Textarea value={description} onChange={(e) => setDesc(e.target.value)} rows={3} maxLength={2000}
          placeholder="Optional — prep notes, agenda, anything students should know…"
          className="rounded-xl border-2 px-3.5 py-2.5" />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Materials</p>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-input px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary">
            <input type="file" multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.mp4"
              onChange={(e) => setMaterials(prev => [...prev, ...Array.from(e.target.files ?? [])])}
              className="sr-only" />
            <FolderOpen className="size-3.5 shrink-0" />
            Attach files
          </label>
          <span className="text-[10px] text-muted-foreground/40">PDF · PPT · DOCX · MP4</span>
        </div>
        {materials.length > 0 && (
          <div className="space-y-1.5">
            {materials.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-input bg-muted/30 px-3 py-2 text-xs">
                <span className="flex-1 truncate font-medium">{f.name}</span>
                <button type="button" onClick={() => setMaterials(prev => prev.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive transition-colors">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Faculty searchable combobox ──────────────────────────────────────────────
function FacultySearch({ faculty, value, onChange, currentUserId }: {
  faculty: Faculty[]; value: string; onChange: (id: string) => void; currentUserId: string
}) {
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState(false)
  const ref                 = useRef<HTMLDivElement>(null)
  const inputRef            = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the combobox query when the popover closes; a deliberate UI reset effect
    else setQuery('')
  }, [open])

  const selected = faculty.find((f) => f.id === value)
  const filtered = query
    ? faculty.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()) || f.email.toLowerCase().includes(query.toLowerCase()))
    : faculty

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl border-2 bg-card px-3.5 py-2 text-sm text-left transition-all',
          open ? 'border-primary ring-4 ring-primary/10' : 'border-input hover:border-primary/40',
        )}
      >
        {selected ? (
          <>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{initials(selected.name)}</div>
            <span className="flex-1 font-medium">{selected.name}</span>
            <span className="text-xs text-muted-foreground">{humanRole(selected.role)}</span>
            {selected.id === currentUserId && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">YOU</span>}
          </>
        ) : (
          <span className="flex-1 text-muted-foreground">Select a teacher to host</span>
        )}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.12 }}
            className="absolute z-50 top-full mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/10"
          >
            <div className="border-b border-border p-2">
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-lg bg-muted px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus:bg-muted/80 transition"
              />
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>
              ) : (
                filtered.map((f) => (
                  <button key={f.id} type="button" onClick={() => { onChange(f.id); setOpen(false) }}
                    className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-sm transition hover:bg-accent', f.id === value && 'bg-primary/5')}
                  >
                    <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', f.id === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{initials(f.name)}</div>
                    <span className="flex-1 text-left font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{humanRole(f.role)}</span>
                    {f.id === currentUserId && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">YOU</span>}
                    {f.id === value && <Check className="size-3.5 text-primary shrink-0" />}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
