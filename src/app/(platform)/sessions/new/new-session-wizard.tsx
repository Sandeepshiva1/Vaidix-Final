'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { RRule, Frequency } from 'rrule'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardCheck,
  Loader2,
  Microscope,
  Plus,
  Presentation,
  Repeat,
  Save,
  Sparkles,
  Users2,
  Video,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SessionType } from '@prisma/client'
import { createTeachingSessionAction, updateTeachingSessionAction } from '@/components/medlearn/actions'
import { createSpecialtyAction, createSubSpecialtyAction } from '@/components/medlearn/specialty-actions'
import { UserPicker, type PickableUser } from '@/components/user-picker'
import { DateTimePicker } from '@/components/ui/date-time-picker'

type Mode = 'choose' | 'classroom' | 'boardroom'

// Demo session-type labels (formerly DemoSessionType) — preserved verbatim so
// the design/option arrays match the demo wizard exactly.
type SessionTypeLabel = 'Webinar' | 'Clinical Teaching' | 'Grand Rounds' | 'Simulation Session'

// Specialty / sub-specialty options are loaded from the DB (see the route's
// page.tsx) and can be extended inline; the formerly-hardcoded arrays moved to
// the `specialties` seed migration.
interface WizardSubSpecialty { id: string; name: string }
interface WizardSpecialty { id: string; name: string; subSpecialties: WizardSubSpecialty[] }

const CLASSROOM_TYPES: { value: SessionTypeLabel; description: string; icon: React.ReactNode }[] = [
  { value: 'Webinar', description: 'Lecture-style, online audience', icon: <Presentation className="size-5" /> },
  { value: 'Clinical Teaching', description: 'Bedside or case-based teaching', icon: <BookOpen className="size-5" /> },
  { value: 'Grand Rounds', description: 'Departmental case review', icon: <ClipboardCheck className="size-5" /> },
  { value: 'Simulation Session', description: 'Wet lab or virtual sim', icon: <Microscope className="size-5" /> },
]

const ROLES = ['Presenter', 'Moderator', 'Panelist'] as const
type Role = (typeof ROLES)[number]

// Max assignments allowed per role type (Presenter / Moderator / Panelist).
const MAX_PER_ROLE = 2

const ROLE_COLORS: Record<Role, string> = {
  Presenter: 'border-teal-500/50 bg-teal-500/8 text-teal-700 dark:text-teal-300',
  Moderator: 'border-amber-500/50 bg-amber-500/8 text-amber-700 dark:text-amber-300',
  Panelist: 'border-indigo-500/50 bg-indigo-500/8 text-indigo-700 dark:text-indigo-300',
}

// Map demo session-type label → real SessionType enum.
function mapSessionType(label: SessionTypeLabel): SessionType {
  switch (label) {
    case 'Clinical Teaching':
      return SessionType.LECTURE
    case 'Grand Rounds':
      return SessionType.GRAND_ROUNDS
    case 'Simulation Session':
      return SessionType.SKILLS_WORKSHOP
    case 'Webinar':
      return SessionType.LECTURE
    default:
      return SessionType.LECTURE
  }
}

// `YYYY-MM-DDTHH:mm` in LOCAL time — the format the DateTimePicker reads/writes.
// (Using local getters, NOT toISOString, which would shift the date across the
// UTC boundary for IST and similar +offset zones.)
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nowLocalInput(): string {
  return toLocalInput(new Date())
}

// Default start = the next 15-minute slot from now (local). Stays on today and
// is a clean, just-ahead time (e.g. 2:51 → 3:00), not an arbitrary +1h.
function defaultStart(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  const m = d.getMinutes()
  d.setMinutes(m + (15 - (m % 15 || 15)) + 15) // round up to next slot, +1 slot of buffer
  return toLocalInput(d)
}

// e.g. "Asia/Kolkata · GMT+5:30" — the host's local zone, shown so they know the
// time they enter is in THEIR timezone (invitees see it converted to theirs).
function localTimezoneLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const parts = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ')
    const abbr = parts[parts.length - 1]
    return abbr && abbr !== tz ? `${tz} · ${abbr}` : tz
  } catch {
    return 'your local timezone'
  }
}

// Shared past-start guard. Mirrors the 5-minute server grace so the picker, the
// client submit, and createTeachingSessionAction all agree on "too far in the
// past". Returns true when `localValue` is acceptable.
const PAST_GRACE_MS = 5 * 60 * 1000
function isStartInPast(localValue: string): boolean {
  const ms = new Date(localValue).getTime()
  return Number.isFinite(ms) && ms < Date.now() - PAST_GRACE_MS
}

// ─── Recurrence (mirrors the /calendar/new scheduler so both create flows agree) ──
type RepeatFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY'
type RepeatEnd = 'count' | 'date' | 'never'

const REPEAT_WEEKDAYS = [
  { key: 'MO', label: 'Mo', rule: RRule.MO },
  { key: 'TU', label: 'Tu', rule: RRule.TU },
  { key: 'WE', label: 'We', rule: RRule.WE },
  { key: 'TH', label: 'Th', rule: RRule.TH },
  { key: 'FR', label: 'Fr', rule: RRule.FR },
  { key: 'SA', label: 'Sa', rule: RRule.SA },
  { key: 'SU', label: 'Su', rule: RRule.SU },
] as const

interface RecurrenceState {
  repeats: boolean
  freq: RepeatFreq
  every: number
  byDays: Set<string>
  endMode: RepeatEnd
  count: number
  until: string // yyyy-mm-dd
}

/** Build an RFC-5545 RRULE body (no DTSTART) + an UNTIL cutoff from wizard state. */
function buildWizardRecurrence(startISO: string, r: RecurrenceState): { rule?: string; until?: string } {
  if (!r.repeats) return {}
  const freqMap = { DAILY: Frequency.DAILY, WEEKLY: Frequency.WEEKLY, MONTHLY: Frequency.MONTHLY }
  const byweekday =
    r.freq === 'WEEKLY' ? REPEAT_WEEKDAYS.filter((w) => r.byDays.has(w.key)).map((w) => w.rule) : undefined
  const opts: ConstructorParameters<typeof RRule>[0] = {
    freq: freqMap[r.freq],
    ...(byweekday && byweekday.length > 0 ? { byweekday } : {}),
    ...(r.every > 1 ? { interval: r.every } : {}),
    dtstart: new Date(startISO),
  }
  if (r.endMode === 'count') opts.count = Math.max(1, r.count)
  else if (r.endMode === 'date' && r.until) opts.until = new Date(`${r.until}T23:59:59Z`)
  const rule = new RRule(opts)
    .toString()
    .split('\n')
    .find((l) => l.startsWith('RRULE:'))
    ?.replace('RRULE:', '')
  const until = r.endMode === 'date' && r.until ? new Date(`${r.until}T23:59:59Z`).toISOString() : undefined
  return { rule, until }
}

export interface WizardCohort {
  id: string
  name: string
}

// Sentinel cohort-picker values that target a whole program-wide role group
// instead of a single cohort. Kept distinct from '' (the "Please select"
// placeholder = no audience) and from real cohort ids. Each maps to a Role the
// server fans out to (residents / faculty / heads-of-department). The edit page
// maps a persisted audienceRole back to the matching value (see metadata.audienceRole).
export const ROLE_AUDIENCE_VALUES = {
  '__all_residents__': 'RESIDENT',
  '__all_faculty__': 'FACULTY',
  '__all_hod__': 'PROGRAM_DIRECTOR',
} as const

export type RoleAudienceValue = keyof typeof ROLE_AUDIENCE_VALUES

const ROLE_AUDIENCE_OPTIONS: { value: RoleAudienceValue; label: string }[] = [
  { value: '__all_residents__', label: 'All Residents' },
  { value: '__all_faculty__', label: 'All Faculty' },
  { value: '__all_hod__', label: 'All HODs' },
]

function isRoleAudience(v: string): v is RoleAudienceValue {
  return v in ROLE_AUDIENCE_VALUES
}

/** Reverse of ROLE_AUDIENCE_VALUES: a stored audienceRole → its picker sentinel
 *  (or '' when it isn't a recognised role audience). Used by the edit page to
 *  re-select the right option. */
export function roleAudienceValue(role: string): RoleAudienceValue | '' {
  const match = (Object.entries(ROLE_AUDIENCE_VALUES) as [RoleAudienceValue, string][])
    .find(([, r]) => r === role)
  return match ? match[0] : ''
}

export function NewSessionWizard({
  cohorts,
  specialties,
  editing,
}: {
  cohorts: WizardCohort[]
  specialties: WizardSpecialty[]
  editing?: ClassroomEditInit
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('choose')

  // Edit mode: skip the create/boardroom chooser and land straight on the
  // Classroom form pre-filled with the session's details.
  if (editing) {
    return (
      <ClassroomForm
        router={router}
        cohorts={cohorts}
        specialties={specialties}
        editing={editing}
        // Back returns to wherever the user came from (dashboard, classroom
        // list, …) — NOT a hardcoded page. Falls back to the classroom detail
        // only when there's no history (e.g. /edit opened in a fresh tab).
        onBack={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back()
          else router.push(`/classroom/${editing.sessionId}`)
        }}
      />
    )
  }

  if (mode === 'choose') return <ChoiceScreen onChoose={setMode} />
  if (mode === 'classroom') return <ClassroomForm router={router} cohorts={cohorts} specialties={specialties} onBack={() => setMode('choose')} />
  return <BoardRoomForm router={router} onBack={() => setMode('choose')} />
}

// ─── Choice screen ────────────────────────────────────────────────────────────
function ChoiceScreen({ onChoose }: { onChoose: (mode: Mode) => void }) {
  const router = useRouter()
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Create a new session</h1>
          <p className="text-[13.5px] text-muted-foreground">Choose the type of session you want to create.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => onChoose('classroom')}
          className="group relative overflow-hidden rounded-3xl border-2 border-border/60 bg-card p-7 text-left transition-all hover:-translate-y-1 hover:border-teal-500/50 hover:shadow-[0_12px_40px_-15px_oklch(0.45_0.15_165/0.3)]"
        >
          <div className="absolute -top-10 -right-10 size-32 rounded-full bg-teal-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="relative">
            <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300">
              <Video className="size-7" />
            </div>
            <h2 className="mt-4 text-[20px] font-semibold tracking-tight">Create a Classroom</h2>
            <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
              For structured educational sessions — Grand Rounds, Webinars, Clinical Teaching, or Simulation.
              Full AI-powered workflow with slides, prereads, promo, and Q&A.
            </p>
            <ul className="mt-4 space-y-1.5 text-[12px] text-muted-foreground">
              {['AI Presentation Studio', 'Learner preparation & analytics', 'Invitation flyers & teasers', 'Incoming Q&A management'].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-teal-500" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-teal-500 px-4 py-2 text-[13px] font-medium text-white shadow-sm">
              Get started
              <ArrowRight className="size-4" />
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onChoose('boardroom')}
          className="group relative overflow-hidden rounded-3xl border-2 border-border/60 bg-card p-7 text-left transition-all hover:-translate-y-1 hover:border-violet-500/50 hover:shadow-[0_12px_40px_-15px_oklch(0.45_0.1_290/0.3)]"
        >
          <div className="absolute -top-10 -right-10 size-32 rounded-full bg-violet-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="relative">
            <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-violet-500/15 to-indigo-500/10 text-violet-700 dark:text-violet-300">
              <Users2 className="size-7" />
            </div>
            <h2 className="mt-4 text-[20px] font-semibold tracking-tight">Create a Board Room</h2>
            <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
              For meetings, case discussions, and peer consultations. Quick setup, fewer steps — just invite participants and start.
            </p>
            <ul className="mt-4 space-y-1.5 text-[12px] text-muted-foreground">
              {['Quick setup — no AI workflow required', 'Invite specific participants', 'Session auto-deletes after 30 days', 'Record, share & export minutes'].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-violet-500" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-[13px] font-medium text-white shadow-sm">
              Get started
              <ArrowRight className="size-4" />
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}

// ─── Classroom form ────────────────────────────────────────────────────────────
// Pre-fill payload for editing an existing classroom session (built by
// /classroom/[id]/edit). When present the form runs in "edit" mode and saves via
// updateTeachingSessionAction instead of creating a new session.
export interface ClassroomEditInit {
  sessionId: string
  title: string
  specialty: string
  subSpecialty: string
  cohortId: string
  description: string
  startAtISO: string // stored UTC instant; converted to a local picker string client-side
  durationMinutes: number
  type: SessionTypeLabel
  roles: { role: Role; user: PickableUser }[]
  recurrence: { repeats: boolean; freq: RepeatFreq; every: number; byDays: string[]; endMode: RepeatEnd; count: number; until: string } | null
}

function ClassroomForm({
  router,
  cohorts,
  specialties,
  onBack,
  editing,
}: {
  router: ReturnType<typeof useRouter>
  cohorts: WizardCohort[]
  specialties: WizardSpecialty[]
  onBack: () => void
  editing?: ClassroomEditInit
}) {
  const e0 = editing
  const [submitting, setSubmitting] = useState(false)
  const [title, setTitle] = useState(e0?.title ?? '')
  // Specialty taxonomy is DB-backed; inline "+ new" appends here so a freshly
  // added option is selectable immediately without a page refresh.
  const [specialtyList, setSpecialtyList] = useState<WizardSpecialty[]>(specialties)
  const [specialty, setSpecialty] = useState(e0?.specialty ?? '') // name; '' = none (optional)
  const [subSpecialty, setSubSpecialty] = useState(e0?.subSpecialty ?? '')
  const [cohort, setCohort] = useState(e0?.cohortId ?? '')
  const [description, setDescription] = useState(e0?.description ?? '')
  // New sessions default to the next slot (local). Edit sessions start empty and
  // are filled from the stored UTC instant after mount (effect below), so the
  // UTC→local conversion runs in the BROWSER's timezone — matching the save path
  // (`new Date(startAt).toISOString()`) — instead of the server's. Doing it on
  // the server (a UTC host) shifted the time by the offset on every edit.
  const [startAt, setStartAt] = useState(e0 ? '' : defaultStart())
  // Snapshot "now" at mount so the picker's past-floor doesn't jitter per render.
  const [minStart] = useState(nowLocalInput)
  useEffect(() => {
    if (e0?.startAtISO) setStartAt(toLocalInput(new Date(e0.startAtISO)))
  }, [e0?.startAtISO])
  // Resolve the timezone client-side (after mount) to avoid an SSR/CSR mismatch.
  const [tzLabel, setTzLabel] = useState('')
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTzLabel(localTimezoneLabel()) }, [])
  const [duration, setDuration] = useState(e0 ? String(e0.durationMinutes) : '60')
  const [type, setType] = useState<SessionTypeLabel>(e0?.type ?? 'Webinar')
  const [roles, setRoles] = useState<{ role: Role; user: PickableUser | null }[]>(
    e0 && e0.roles.length > 0 ? e0.roles : [{ role: 'Presenter', user: null }],
  )

  // Recurrence (optional). Mirrors the /calendar/new scheduler's repeat options.
  const [repeats, setRepeats] = useState(e0?.recurrence?.repeats ?? false)
  const [freq, setFreq] = useState<RepeatFreq>(e0?.recurrence?.freq ?? 'WEEKLY')
  const [every, setEvery] = useState(e0?.recurrence?.every ?? 1)
  const [byDays, setByDays] = useState<Set<string>>(new Set(e0?.recurrence?.byDays ?? ['MO']))
  const [endMode, setEndMode] = useState<RepeatEnd>(e0?.recurrence?.endMode ?? 'count')
  const [occCount, setOccCount] = useState(e0?.recurrence?.count ?? 8)
  const [untilDate, setUntilDate] = useState(e0?.recurrence?.until ?? '')

  const selectedSpec = specialtyList.find((s) => s.name === specialty) ?? null
  const subSpecs = selectedSpec?.subSpecialties ?? []
  // Strict UI guard: any start at/under "now" disables Create (no grace) so a
  // back-dated session can never be submitted. The server keeps a 5-min grace
  // purely for clock skew on legitimately near-now starts.
  const startInPast = useMemo(
    () => startAt !== '' && new Date(startAt).getTime() <= Date.now(),
    [startAt]
  )
  const hasPresenter = roles.some((r) => r.role === 'Presenter' && r.user !== null)
  const [presenterError, setPresenterError] = useState(false)
  const valid = title.trim().length >= 3 && !startInPast && hasPresenter

  // ── Inline taxonomy creation (persists via server action, then local-append) ──
  const createSpecialty = async (name: string): Promise<WizardSubSpecialty | null> => {
    const res = await createSpecialtyAction(name)
    if (!res.ok) { toast.error(res.error); return null }
    setSpecialtyList((list) =>
      list.some((s) => s.id === res.data.id) ? list : [...list, { ...res.data, subSpecialties: [] }],
    )
    setSubSpecialty('')
    return res.data
  }

  const createSubSpecialty = async (name: string): Promise<WizardSubSpecialty | null> => {
    if (!selectedSpec) { toast.error('Pick a specialty first.'); return null }
    const res = await createSubSpecialtyAction(selectedSpec.id, name)
    if (!res.ok) { toast.error(res.error); return null }
    const row = { id: res.data.id, name: res.data.name }
    setSpecialtyList((list) =>
      list.map((s) =>
        s.id === selectedSpec.id
          ? { ...s, subSpecialties: s.subSpecialties.some((x) => x.id === row.id) ? s.subSpecialties : [...s.subSpecialties, row] }
          : s,
      ),
    )
    return row
  }

  const freqLabel = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' }[freq]
  const recurrenceSummary = `Every ${every > 1 ? `${every} ${freqLabel}s` : freqLabel}${
    endMode === 'count' ? ` · ${occCount}×` : endMode === 'date' && untilDate ? ` · until ${untilDate}` : ' · no end'
  }`
  const toggleByDay = (key: string) => {
    const n = new Set(byDays)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    setByDays(n)
  }

  // Cap role assignments at MAX_PER_ROLE of each type (so it can't grow to 100).
  const roleCount = (role: Role) => roles.filter((r) => r.role === role).length
  // Extra roles (beyond the locked Presenter) can only be Moderator or Panelist.
  const EXTRA_ROLES = ROLES.filter((r) => r !== 'Presenter') as Role[]
  const rolesFull = EXTRA_ROLES.every((role) => roleCount(role) >= MAX_PER_ROLE)
  const addRole = () => {
    const next = EXTRA_ROLES.find((role) => roleCount(role) < MAX_PER_ROLE)
    if (!next) { toast.error(`Up to ${MAX_PER_ROLE} of each role.`); return }
    setRoles((r) => [...r, { role: next, user: null }])
  }
  const updateRole = (i: number, patch: Partial<{ role: Role; user: PickableUser | null }>) => {
    if (patch.role && patch.role !== roles[i].role && roleCount(patch.role) >= MAX_PER_ROLE) {
      toast.error(`Up to ${MAX_PER_ROLE} ${patch.role}s.`)
      return
    }
    setRoles((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  }
  const removeRole = (i: number) => setRoles((r) => r.filter((_, idx) => idx !== i))

  const submit = async (asDraft = false) => {
    if (!asDraft && !hasPresenter) { setPresenterError(true); return }
    if (!valid && !asDraft) return
    setPresenterError(false)
    if (asDraft) {
      router.push('/dashboard')
      return
    }
    const startMs = new Date(startAt).getTime()
    if (Number.isNaN(startMs)) { toast.error('Pick a valid date & time.'); return }
    if (isStartInPast(startAt)) {
      toast.error('Start time has already passed — pick a future time.')
      return
    }
    setSubmitting(true)
    try {
      const startISO = new Date(startMs).toISOString()
      const recurrence = buildWizardRecurrence(startISO, {
        repeats, freq, every, byDays, endMode, count: occCount, until: untilDate,
      })
      const payload = {
        title: title.trim(),
        scheduledStart: startISO,
        durationMinutes: Number(duration),
        sessionType: mapSessionType(type),
        learnerLevel: subSpecialty || specialty,
        description: description.trim() || undefined,
        cohortId: cohort && !isRoleAudience(cohort) ? cohort : undefined,
        targetRole: isRoleAudience(cohort) ? ROLE_AUDIENCE_VALUES[cohort] : undefined,
        specialty,
        subSpecialty: subSpecialty || undefined,
        roles: roles
          .filter((r) => r.user)
          .map((r) => ({ role: r.role, userId: r.user!.id, name: r.user!.name })),
        recurrenceRule: recurrence.rule,
        recurrenceUntil: recurrence.until,
      }
      const result = e0
        ? await updateTeachingSessionAction(e0.sessionId, payload)
        : await createTeachingSessionAction(payload)
      if (result.ok) {
        if (e0) {
          // After an edit, return to wherever the user came from (same as
          // Cancel) — NOT the pre-flight page — and refresh so it reflects the
          // change.
          toast.success('Changes saved.')
          router.refresh()
          onBack()
        } else {
          // After create, into the prep workflow.
          router.push(`/session/${result.sessionId}/pre`)
          router.refresh()
        }
      } else {
        toast.error(result.error)
        setSubmitting(false)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create session.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">{e0 ? 'Edit Classroom' : 'Create a Classroom'}</h1>
          <p className="text-[13.5px] text-muted-foreground">{e0 ? 'Update the session details. Changes apply to this classroom right away.' : 'Set the basics. Slides, learners, and promos come in the next steps.'}</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void submit(false) }} className="rounded-3xl border border-border/60 bg-card p-7 shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
        <Field label="Session title" required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diabetic Retinopathy — Staging & Management" className="vfx-input" />
        </Field>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Specialty">
            <EditableSelect
              value={specialty}
              onChange={(name) => { setSpecialty(name); setSubSpecialty('') }}
              options={specialtyList}
              placeholderOption="Select specialty (optional)"
              addLabel="Add new specialty"
              onCreate={createSpecialty}
            />
          </Field>
          <Field label="Sub-specialty">
            <EditableSelect
              value={subSpecialty}
              onChange={setSubSpecialty}
              options={subSpecs}
              placeholderOption={selectedSpec ? 'All sub-specialties' : 'Select a specialty first'}
              addLabel="Add new sub-specialty"
              onCreate={createSubSpecialty}
              disabled={!selectedSpec}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Cohort (optional)">
            <div className="relative">
              <select value={cohort} onChange={(e) => setCohort(e.target.value)} className="vfx-input appearance-none pr-9">
                <option value="">Please select</option>
                {ROLE_AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronIcon />
            </div>
          </Field>
          <Field label="Duration (minutes)" required>
            <DurationPicker value={duration} onChange={setDuration} presets={['30', '60', '90']} />
          </Field>
        </div>

        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Brief summary of what learners will get out of this session" className="vfx-input resize-none" />
        </Field>

        <div className="mb-5">
          <DateTimePicker
            label="Date & time"
            required
            value={startAt}
            onChange={setStartAt}
            min={minStart}
            disablePast
          />
          {startInPast ? (
            <p className="mt-1.5 text-[12px] font-medium text-rose-600">
              Start time is in the past — pick a future date &amp; time.
            </p>
          ) : tzLabel ? (
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              Time is in your timezone — {tzLabel}. Invitees see it converted to their own local time.
            </p>
          ) : null}
        </div>

        {/* ── Recurrence (optional) — same options as the full /calendar/new scheduler ── */}
        <div className={cn('mb-5 rounded-2xl border transition-colors', repeats ? 'border-teal-500/40 bg-teal-500/5' : 'border-border/60')}>
          <label className="flex cursor-pointer items-center gap-2.5 px-4 py-3 text-[13px] font-semibold text-foreground/85">
            <input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} className="size-4 accent-teal-600" />
            <Repeat className={cn('size-4', repeats ? 'text-teal-600' : 'text-muted-foreground')} />
            Repeat this session
            {repeats && (
              <span className="ml-1 rounded-full bg-teal-500/15 px-2.5 py-0.5 text-[11px] font-bold text-teal-700 dark:text-teal-300">
                {recurrenceSummary}
              </span>
            )}
          </label>

          {repeats && (
            <div className="space-y-4 border-t border-border/60 px-4 py-4">
              {/* Every N · frequency */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground">Every</span>
                <input
                  type="number" min={1} max={52} value={every}
                  onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 rounded-xl border border-border/60 bg-background px-2.5 py-1.5 text-center text-[13px] font-semibold outline-none focus:border-teal-500"
                />
                <div className="relative">
                  <select
                    value={freq} onChange={(e) => setFreq(e.target.value as RepeatFreq)}
                    className="appearance-none rounded-xl border border-border/60 bg-background px-3 py-1.5 pr-9 text-[13px] font-semibold outline-none focus:border-teal-500"
                  >
                    <option value="DAILY">Day</option>
                    <option value="WEEKLY">Week</option>
                    <option value="MONTHLY">Month</option>
                  </select>
                  <ChevronIcon />
                </div>
              </div>

              {/* Weekly day picker */}
              {freq === 'WEEKLY' && (
                <div className="space-y-1.5">
                  <div className="text-[11.5px] font-semibold text-muted-foreground">On</div>
                  <div className="flex flex-wrap gap-1.5">
                    {REPEAT_WEEKDAYS.map((w) => {
                      const active = byDays.has(w.key)
                      return (
                        <button
                          key={w.key} type="button" onClick={() => toggleByDay(w.key)}
                          className={cn('size-9 rounded-xl border text-[12px] font-bold transition-all',
                            active ? 'border-teal-500/50 bg-teal-500/10 text-teal-700 dark:text-teal-300' : 'border-border/60 text-muted-foreground hover:border-teal-500/40')}
                        >
                          {w.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* End condition */}
              <div className="space-y-1.5">
                <div className="text-[11.5px] font-semibold text-muted-foreground">Ends</div>
                <div className="space-y-2 rounded-xl border border-border/60 bg-background/60 p-3">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input type="radio" name="wiz-endmode" checked={endMode === 'count'} onChange={() => setEndMode('count')} className="size-4 accent-teal-600" />
                    <span className="w-12 text-[13px] font-medium">After</span>
                    <input
                      type="number" min={1} max={365} value={occCount} disabled={endMode !== 'count'}
                      onChange={(e) => setOccCount(Math.max(1, Number(e.target.value) || 1))}
                      className="w-16 rounded-lg border border-border/60 bg-background px-2 py-1 text-center text-[13px] font-semibold outline-none disabled:opacity-40"
                    />
                    <span className="text-[13px] text-muted-foreground">occurrence{occCount !== 1 ? 's' : ''}</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input type="radio" name="wiz-endmode" checked={endMode === 'date'} onChange={() => setEndMode('date')} className="size-4 accent-teal-600" />
                    <span className="text-[13px] font-medium">By a date</span>
                  </label>
                  {endMode === 'date' && (
                    // Uses the same styled DateTimePicker as the start field (no
                    // native browser calendar) — keeps the calendar UI consistent.
                    // Time is irrelevant for an end-date cutoff, so we read/write
                    // only the date portion.
                    <div className="pl-6">
                      <DateTimePicker
                        label="End date"
                        dateOnly
                        value={untilDate ? `${untilDate}T23:59` : ''}
                        onChange={(v) => setUntilDate(v.slice(0, 10))}
                        min={startAt}
                      />
                    </div>
                  )}
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input type="radio" name="wiz-endmode" checked={endMode === 'never'} onChange={() => setEndMode('never')} className="size-4 accent-teal-600" />
                    <span className="text-[13px] font-medium">Never ends</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <Field label="Session type" required>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {CLASSROOM_TYPES.map((opt) => {
              const active = type === opt.value
              return (
                <button key={opt.value} type="button" onClick={() => setType(opt.value)} className={cn('flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all', active ? 'border-teal-500/50 bg-teal-500/8 ring-1 ring-teal-500/20' : 'border-border/60 bg-background/60 hover:border-foreground/15')}>
                  <div className={cn('grid size-10 shrink-0 place-items-center rounded-xl', active ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300' : 'bg-foreground/5 text-muted-foreground')}>
                    {opt.icon}
                  </div>
                  <div>
                    <div className={cn('text-[13.5px] font-semibold', active && 'text-teal-700 dark:text-teal-300')}>{opt.value}</div>
                    <div className="text-[11.5px] text-muted-foreground">{opt.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </Field>

        {/* Role assignments */}
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-foreground/85">
            Role assignments
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">Presenter required</span>
          </div>
          {presenterError && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[12px] font-medium text-rose-600 dark:text-rose-400">
              <span className="shrink-0">⚠</span> You must assign a Presenter before creating the session.
            </div>
          )}
          <div className="space-y-2.5">
            {roles.map((r, i) => (
              <div key={i} className={cn('flex items-center gap-2.5 rounded-2xl border p-2.5', ROLE_COLORS[r.role], i === 0 && presenterError && !r.user && 'border-rose-500/60 bg-rose-500/5')}>
                <div className="relative">
                  {/* First row is always Presenter — locked */}
                  {i === 0 ? (
                    <div className={cn('rounded-xl border px-2.5 py-1.5 text-[12px] font-semibold', ROLE_COLORS['Presenter'])}>
                      Presenter
                    </div>
                  ) : (
                    <>
                      <select value={r.role} onChange={(e) => updateRole(i, { role: e.target.value as Role })} className={cn('appearance-none rounded-xl border px-2.5 py-1.5 pr-7 text-[12px] font-semibold outline-none transition-colors', ROLE_COLORS[r.role])}>
                        {ROLES.filter((role) => role !== 'Presenter' || roleCount('Presenter') < MAX_PER_ROLE).map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                      <ChevronIcon small />
                    </>
                  )}
                </div>
                <div className="flex-1">
                  <UserPicker
                    single
                    purpose="invite"
                    selected={r.user ? [r.user] : []}
                    onChange={(next) => { updateRole(i, { user: next[0] ?? null }); if (i === 0) setPresenterError(false) }}
                    placeholder={i === 0 ? 'Search and assign a Presenter (required)' : 'Search users by name or email'}
                  />
                </div>
                {i === 0 && (
                  <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">Required</span>
                )}
                {i > 0 && (
                  <button type="button" onClick={() => removeRole(i)} className="text-current/50 hover:text-current">
                    <span className="text-[16px] leading-none">×</span>
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRole} disabled={rolesFull} className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-border/60 px-3.5 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-teal-500/40 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-teal-300">
              <Plus className="size-3.5" />
              {rolesFull ? `Max ${MAX_PER_ROLE} of each role reached` : 'Add another role'}
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          {e0 ? (
            <button type="button" onClick={onBack} disabled={submitting} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50">
              Cancel
            </button>
          ) : (
            <button type="button" onClick={() => void submit(true)} disabled={submitting} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50">
              <Save className="size-4" />
              Save draft
            </button>
          )}
          <button type="submit" disabled={!valid || submitting} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-700 px-5 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-100 disabled:opacity-40 disabled:hover:scale-100">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {e0 ? 'Save changes' : 'Create classroom'}
          </button>
        </div>
      </form>

      <style jsx>{`
        :global(.vfx-input) { width:100%; height:2.5rem; padding:0.5rem 0.875rem; border-radius:0.75rem; border:1px solid var(--border); background:var(--background); color:var(--foreground); font-size:13.5px; outline:none; transition:border-color 120ms ease, box-shadow 120ms ease; }
        :global(.vfx-input:focus) { border-color:oklch(0.55 0.12 165); box-shadow:0 0 0 3px oklch(0.85 0.06 165 / 0.35); }
        :global(textarea.vfx-input) { height:auto; padding:0.75rem 0.875rem; line-height:1.45; }
      `}</style>
    </div>
  )
}

// ─── Board Room form ───────────────────────────────────────────────────────────
function BoardRoomForm({ router, onBack }: { router: ReturnType<typeof useRouter>; onBack: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState('30')
  const [startAt, setStartAt] = useState(defaultStart())
  const [minStart] = useState(nowLocalInput)
  // Board-room participants — picked from the real user directory (flat list, no
  // Presenter/Moderator/Panelist roles). Mirrors the classroom role picker's
  // search UX; each becomes a SessionInvite + an in-app invite alert.
  const [participants, setParticipants] = useState<PickableUser[]>([])

  const startInPast = useMemo(
    () => startAt !== '' && new Date(startAt).getTime() <= Date.now(),
    [startAt]
  )
  const valid = subject.trim().length >= 3 && !startInPast

  const submit = async () => {
    if (!valid) return
    if (Number.isNaN(new Date(startAt).getTime())) { toast.error('Pick a valid date & time.'); return }
    if (isStartInPast(startAt)) {
      toast.error('Start time has already passed — pick a future time.')
      return
    }
    setSubmitting(true)
    try {
      const result = await createTeachingSessionAction({
        title: subject.trim(),
        scheduledStart: new Date(startAt).toISOString(),
        durationMinutes: Number(duration),
        sessionType: SessionType.CASE_CONFERENCE,
        description: description.trim() || undefined,
        participantUserIds: participants.map((p) => p.id),
        isBoardRoom: true,
      })
      if (result.ok) {
        // Board rooms have no pre-conference. Land back on the dashboard, where
        // the host (and every invited participant) joins directly via the card.
        toast.success('Board room scheduled. Invitees can join from their dashboard.')
        router.push('/dashboard')
        router.refresh()
      } else {
        toast.error(result.error)
        setSubmitting(false)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create board room.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <button type="button" onClick={onBack} className="grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
          <ArrowLeft className="size-4" />
        </button>
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Create a Board Room</h1>
          <p className="text-[13.5px] text-muted-foreground">Quick setup for meetings and peer discussions. Auto-deletes after 30 days.</p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-violet-500/30 bg-violet-50/60 px-4 py-3 text-[12.5px] text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
        <Users2 className="size-4 shrink-0" />
        Board rooms auto-delete 30 days after creation. Recordings and notes can be exported before then.
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="rounded-3xl border border-border/60 bg-card p-7 shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
        <Field label="Subject" required>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. IOL selection case discussion" className="vfx-input" />
        </Field>

        <Field label="Description (optional)">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What will you cover in this meeting?" className="vfx-input resize-none" />
        </Field>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <DateTimePicker
              label="Date & time"
              required
              value={startAt}
              onChange={setStartAt}
              min={minStart}
              disablePast
            />
            {startInPast && (
              <p className="mt-1.5 text-[12px] font-medium text-rose-600">
                Start time is in the past — pick a future date &amp; time.
              </p>
            )}
          </div>
          <Field label="Duration (minutes)" required>
            <DurationPicker value={duration} onChange={setDuration} presets={['30', '60', '90']} />
          </Field>
        </div>

        <Field label="Participants">
          <UserPicker
            purpose="invite"
            selected={participants}
            onChange={setParticipants}
            placeholder="Search users by name or email"
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            Invited participants get an alert and see this board room in their upcoming sessions — they join directly, no preparation needed.
          </p>
        </Field>

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button type="submit" disabled={!valid || submitting} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-violet-600 px-5 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-100 disabled:opacity-40 disabled:hover:scale-100">
            <Users2 className="size-4" />
            Create Board Room
          </button>
        </div>
      </form>

      <style jsx>{`
        :global(.vfx-input) { width:100%; height:2.5rem; padding:0.5rem 0.875rem; border-radius:0.75rem; border:1px solid var(--border); background:var(--background); color:var(--foreground); font-size:13.5px; outline:none; transition:border-color 120ms ease, box-shadow 120ms ease; }
        :global(.vfx-input:focus) { border-color:oklch(0.55 0.12 165); box-shadow:0 0 0 3px oklch(0.85 0.06 165 / 0.35); }
        :global(textarea.vfx-input) { height:auto; padding:0.75rem 0.875rem; line-height:1.45; }
      `}</style>
    </div>
  )
}

const MAX_DURATION = 240

// Duration presets + a manual entry capped at 240 minutes (4h). Lets a host pick
// a 2-hour (or any) session without being limited to the preset chips.
function DurationPicker({ value, onChange, presets }: { value: string; onChange: (v: string) => void; presets: string[] }) {
  return (
    // Single line (fits the half-width grid column): preset chips + a compact
    // manual entry capped at 240 minutes.
    <div className="flex items-center gap-1.5">
      {presets.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={cn('h-10 shrink-0 rounded-xl border px-2.5 text-[12.5px] font-medium transition-all',
            value === d ? 'border-teal-500/50 bg-teal-500/8 text-teal-700 dark:text-teal-300' : 'border-border/60 bg-background/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}
        >
          {d}m
        </button>
      ))}
      <input
        type="number"
        min={15}
        max={MAX_DURATION}
        value={value}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') { onChange(''); return }
          onChange(String(Math.max(1, Math.min(MAX_DURATION, Number(raw) || 0))))
        }}
        onBlur={(e) => { if (!e.target.value || Number(e.target.value) < 15) onChange('60') }}
        className="h-10 w-16 shrink-0 rounded-xl border border-border/60 bg-background px-2 text-center text-[12.5px] outline-none focus:border-teal-500"
        title={`Custom duration in minutes (max ${MAX_DURATION})`}
        aria-label={`Custom duration in minutes (max ${MAX_DURATION})`}
      />
      <span className="shrink-0 text-[11.5px] text-muted-foreground">min</span>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="mb-5 block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-foreground/85">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}

const ADD_SENTINEL = '__add_new__'

// Styled <select> with an inline "+ Add new…" affordance. Picking the add
// option swaps the control for a text input; confirming calls `onCreate`, which
// persists the value (server action) and returns the saved row so the parent
// can append + select it. Keeps the existing vfx-input look.
function EditableSelect({
  value,
  onChange,
  options,
  placeholderOption,
  addLabel,
  onCreate,
  disabled,
}: {
  value: string
  onChange: (name: string) => void
  options: { id: string; name: string }[]
  placeholderOption: string
  addLabel: string
  onCreate: (name: string) => Promise<{ id: string; name: string } | null>
  disabled?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const cancel = () => { setAdding(false); setDraft('') }
  const confirm = async () => {
    const name = draft.trim()
    if (name.length < 2 || saving) return
    setSaving(true)
    try {
      const row = await onCreate(name)
      if (row) { onChange(row.name); setAdding(false); setDraft('') }
    } finally {
      setSaving(false)
    }
  }

  if (adding) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void confirm() }
            else if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          placeholder={addLabel}
          className="vfx-input flex-1"
        />
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={saving || draft.trim().length < 2}
          aria-label="Save"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-600 text-white transition-colors hover:bg-teal-700 disabled:opacity-40"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel"
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/60 text-muted-foreground transition-colors hover:bg-foreground/5"
        >
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === ADD_SENTINEL) { setDraft(''); setAdding(true); return }
          onChange(e.target.value)
        }}
        className="vfx-input appearance-none pr-9 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">{placeholderOption}</option>
        {options.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
        {!disabled && <option value={ADD_SENTINEL}>+ {addLabel}…</option>}
      </select>
      <ChevronIcon />
    </div>
  )
}

function ChevronIcon({ small }: { small?: boolean }) {
  return (
    <svg className={cn('pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground', small ? 'size-3' : 'size-4')} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  )
}
