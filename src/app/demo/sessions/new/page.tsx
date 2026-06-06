'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  Microscope,
  Plus,
  Presentation,
  Save,
  Sparkles,
  Users2,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDemoState, type DemoSessionType } from '@/components/demo/demo-state'

type Mode = 'choose' | 'classroom' | 'boardroom'

const SPECIALTIES = [
  'Vitreoretina',
  'Cornea',
  'Cataract & IOL',
  'Glaucoma',
  'Uvea',
  'Paediatric Ophthalmology',
  'Oculoplasty',
  'Imaging',
  'Refractive Surgery',
]

const SUB_SPECIALTIES: Record<string, string[]> = {
  Vitreoretina: ['Medical Retina', 'Vitreoretinal Surgery', 'Diabetic Retinopathy', 'Macular Diseases'],
  Cornea: ['Corneal Dystrophies', 'Keratoconus', 'Transplantation', 'Ocular Surface'],
  'Cataract & IOL': ['Phacoemulsification', 'Premium IOLs', 'Toric IOLs', 'Complex Cataract'],
  Glaucoma: ['Primary Open Angle', 'Angle Closure', 'Surgical Glaucoma', 'Pediatric Glaucoma'],
  Uvea: ['Anterior Uveitis', 'Posterior Uveitis', 'Panuveitis', 'Ocular Oncology'],
  'Paediatric Ophthalmology': ['Strabismus', 'Amblyopia', 'Pediatric Cataract', 'ROP'],
  Oculoplasty: ['Eyelid Surgery', 'Orbital Diseases', 'Lacrimal System', 'Aesthetic Oculoplasty'],
  Imaging: ['OCT', 'FFA', 'OCT-A', 'Wide-field Imaging'],
  'Refractive Surgery': ['LASIK', 'SMILE', 'ICL', 'Surface Ablation'],
}

const COHORTS = ['DNB 2024', 'DNB 2023', 'Fellowship Batch A', 'Fellowship Batch B', 'Postgraduate', 'All Learners']

const CLASSROOM_TYPES: { value: DemoSessionType; description: string; icon: React.ReactNode }[] = [
  { value: 'Webinar', description: 'Lecture-style, online audience', icon: <Presentation className="size-5" /> },
  { value: 'Clinical Teaching', description: 'Bedside or case-based teaching', icon: <BookOpen className="size-5" /> },
  { value: 'Grand Rounds', description: 'Departmental case review', icon: <ClipboardCheck className="size-5" /> },
  { value: 'Simulation Session', description: 'Wet lab or virtual sim', icon: <Microscope className="size-5" /> },
]

const ROLES = ['Presenter', 'Moderator', 'Panelist'] as const
type Role = (typeof ROLES)[number]

const ROLE_COLORS: Record<Role, string> = {
  Presenter: 'border-teal-500/50 bg-teal-500/8 text-teal-700 dark:text-teal-300',
  Moderator: 'border-amber-500/50 bg-amber-500/8 text-amber-700 dark:text-amber-300',
  Panelist: 'border-indigo-500/50 bg-indigo-500/8 text-indigo-700 dark:text-indigo-300',
}

function defaultDate(offsetDays = 3): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export default function CreateSessionPage() {
  const router = useRouter()
  const { addSession } = useDemoState()
  const [mode, setMode] = useState<Mode>('choose')

  if (mode === 'choose') return <ChoiceScreen onChoose={setMode} />
  if (mode === 'classroom') return <ClassroomForm router={router} addSession={addSession} onBack={() => setMode('choose')} />
  return <BoardRoomForm router={router} onBack={() => setMode('choose')} />
}

// ─── Choice screen ────────────────────────────────────────────────────────────
function ChoiceScreen({ onChoose }: { onChoose: (mode: Mode) => void }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/demo"
          className="grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
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
function ClassroomForm({
  router,
  addSession,
  onBack,
}: {
  router: ReturnType<typeof useRouter>
  addSession: ReturnType<typeof useDemoState>['addSession']
  onBack: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [title, setTitle] = useState('')
  const [specialty, setSpecialty] = useState(SPECIALTIES[0])
  const [subSpecialty, setSubSpecialty] = useState('')
  const [cohort, setCohort] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(defaultDate())
  const [time, setTime] = useState('17:00')
  const [duration, setDuration] = useState('60')
  const [type, setType] = useState<DemoSessionType>('Webinar')
  const [roles, setRoles] = useState<{ role: Role; name: string }[]>([{ role: 'Presenter', name: 'Dr. Avinash Pathengay' }])

  const subSpecs = SUB_SPECIALTIES[specialty] ?? []
  const valid = title.trim().length >= 3 && description.trim().length > 0

  const addRole = () => setRoles((r) => [...r, { role: 'Panelist', name: '' }])
  const updateRole = (i: number, patch: Partial<{ role: Role; name: string }>) =>
    setRoles((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  const removeRole = (i: number) => setRoles((r) => r.filter((_, idx) => idx !== i))

  const submit = (asDraft = false) => {
    if (!valid && !asDraft) return
    setSubmitting(true)
    const id = addSession({
      title: title.trim() || 'Untitled session',
      specialty,
      description: description.trim() || 'No description yet.',
      date,
      time,
      duration,
      type,
    })
    setTimeout(() => router.push(asDraft ? '/demo' : `/demo/sessions/${id}/prepare`), 250)
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
          <h1 className="text-[24px] font-semibold tracking-tight">Create a Classroom</h1>
          <p className="text-[13.5px] text-muted-foreground">Set the basics. Slides, learners, and promos come in the next steps.</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(false) }} className="rounded-3xl border border-border/60 bg-card p-7 shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
        <Field label="Session title" required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diabetic Retinopathy — Staging & Management" className="vfx-input" />
        </Field>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Specialty" required>
            <div className="relative">
              <select value={specialty} onChange={(e) => { setSpecialty(e.target.value); setSubSpecialty('') }} className="vfx-input appearance-none pr-9">
                {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronIcon />
            </div>
          </Field>
          <Field label="Sub-specialty">
            <div className="relative">
              <select value={subSpecialty} onChange={(e) => setSubSpecialty(e.target.value)} className="vfx-input appearance-none pr-9">
                <option value="">All sub-specialties</option>
                {subSpecs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronIcon />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Cohort (optional)">
            <div className="relative">
              <select value={cohort} onChange={(e) => setCohort(e.target.value)} className="vfx-input appearance-none pr-9">
                <option value="">All learners</option>
                {COHORTS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronIcon />
            </div>
          </Field>
          <Field label="Duration (minutes)" required>
            <div className="flex gap-2">
              {['30', '45', '60', '90'].map((d) => (
                <button key={d} type="button" onClick={() => setDuration(d)} className={cn('h-10 flex-1 rounded-xl border text-[13px] font-medium transition-all', duration === d ? 'border-teal-500/50 bg-teal-500/8 text-teal-700 dark:text-teal-300' : 'border-border/60 bg-background/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}>
                  {d} min
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Description" required>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Brief summary of what learners will get out of this session" className="vfx-input resize-none" />
        </Field>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field label="Date" required>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="vfx-input" />
          </Field>
          <Field label="Time" required>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="vfx-input" />
          </Field>
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
          <div className="mb-2 text-[12.5px] font-semibold text-foreground/85">
            Role assignments
            <span className="ml-1 text-rose-500">*</span>
          </div>
          <div className="space-y-2.5">
            {roles.map((r, i) => (
              <div key={i} className={cn('flex items-center gap-2.5 rounded-2xl border p-2.5', ROLE_COLORS[r.role])}>
                <div className="relative">
                  <select value={r.role} onChange={(e) => updateRole(i, { role: e.target.value as Role })} className={cn('appearance-none rounded-xl border px-2.5 py-1.5 pr-7 text-[12px] font-semibold outline-none transition-colors', ROLE_COLORS[r.role])}>
                    {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                  <ChevronIcon small />
                </div>
                <input value={r.name} onChange={(e) => updateRole(i, { name: e.target.value })} placeholder="Faculty name or email" className="h-9 flex-1 rounded-xl border border-current/20 bg-white/50 px-3 text-[12.5px] outline-none placeholder:text-current/40 dark:bg-black/20" />
                {i > 0 && (
                  <button type="button" onClick={() => removeRole(i)} className="text-current/50 hover:text-current">
                    <span className="text-[16px] leading-none">×</span>
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRole} className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-border/60 px-3.5 py-2 text-[12.5px] font-medium text-muted-foreground hover:border-teal-500/40 hover:text-teal-700 dark:hover:text-teal-300">
              <Plus className="size-3.5" />
              Add another role
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button type="button" onClick={() => submit(true)} disabled={submitting} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-5 text-[13.5px] font-medium text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50">
            <Save className="size-4" />
            Save draft
          </button>
          <button type="submit" disabled={!valid || submitting} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-700 px-5 text-[13.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-100 disabled:opacity-40 disabled:hover:scale-100">
            <Sparkles className="size-4" />
            Create classroom
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
  const [date, setDate] = useState(defaultDate())
  const [time, setTime] = useState('10:00')
  const [participants, setParticipants] = useState('')

  const valid = subject.trim().length >= 3

  const submit = () => {
    if (!valid) return
    setSubmitting(true)
    setTimeout(() => router.push('/demo'), 350)
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

      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="rounded-3xl border border-border/60 bg-card p-7 shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
        <Field label="Subject" required>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. IOL selection case discussion" className="vfx-input" />
        </Field>

        <Field label="Description (optional)">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What will you cover in this meeting?" className="vfx-input resize-none" />
        </Field>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <Field label="Date" required>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="vfx-input" />
          </Field>
          <Field label="Time" required>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="vfx-input" />
          </Field>
          <Field label="Duration" required>
            <div className="flex gap-2">
              {['30', '45', '60'].map((d) => (
                <button key={d} type="button" onClick={() => setDuration(d)} className={cn('h-10 flex-1 rounded-xl border text-[12.5px] font-medium transition-all', duration === d ? 'border-violet-500/50 bg-violet-500/8 text-violet-700 dark:text-violet-300' : 'border-border/60 bg-background/60 text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}>
                  {d}m
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Participants (emails or names, comma-separated)">
          <textarea value={participants} onChange={(e) => setParticipants(e.target.value)} rows={2} placeholder="dr.kumar@lvpei.org, dr.reddy@aiims.edu, …" className="vfx-input resize-none" />
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

function ChevronIcon({ small }: { small?: boolean }) {
  return (
    <svg className={cn('pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground', small ? 'size-3' : 'size-4')} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  )
}
