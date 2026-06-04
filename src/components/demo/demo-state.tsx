'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type DemoStage = 'PRE' | 'LIVE' | 'POST'
export type DemoSessionType = 'Webinar' | 'Clinical Teaching' | 'Grand Rounds' | 'Simulation Session'
export type DemoStepKey = 'studio' | 'learners' | 'promo' | 'analytics' | 'questions' | 'ready'

export interface DemoSession {
  id: string
  title: string
  specialty: string
  description: string
  date: string
  time: string
  duration: string
  type: DemoSessionType
  stage: DemoStage
  steps: Record<DemoStepKey, boolean>
  /** Has the faculty uploaded source material yet (gate for AI generation) */
  hasSources: boolean
  sourceFiles: { name: string; size: string; kind: 'pdf' | 'pptx' | 'docx' | 'notes' }[]
  prereadFiles: { name: string; size: string; kind: 'pdf' | 'video' | 'docx' | 'notes' }[]
  lockUntilPreread: boolean
  collectAnalytics: boolean
  promoSent: boolean
  promoApproved: string[]
}

interface DemoState {
  sessions: DemoSession[]
  resetDemo: () => void
  addSession: (s: Omit<DemoSession, 'id' | 'stage' | 'steps' | 'hasSources' | 'sourceFiles' | 'prereadFiles' | 'lockUntilPreread' | 'collectAnalytics' | 'promoSent' | 'promoApproved'>) => string
  getSession: (id: string) => DemoSession | undefined
  updateSession: (id: string, patch: Partial<DemoSession>) => void
  markStep: (id: string, step: DemoStepKey, done: boolean) => void
  uploadSources: (id: string, files: DemoSession['sourceFiles']) => void
  uploadPrereads: (id: string, files: DemoSession['prereadFiles']) => void
}

const KEY = 'vaidix-demo-state-v2'

const SEED_SESSIONS: DemoSession[] = [
  {
    id: 'ses-dr',
    title: 'Diabetic Retinopathy — Staging & Management',
    specialty: 'Vitreoretina',
    description: 'A comprehensive case-based session on DR staging, OCT interpretation and current treatment guidelines.',
    date: '2026-05-28',
    time: '17:30',
    duration: '60',
    type: 'Grand Rounds',
    stage: 'PRE',
    steps: { studio: false, learners: false, promo: false, analytics: false, questions: false, ready: false },
    hasSources: false,
    sourceFiles: [],
    prereadFiles: [],
    lockUntilPreread: true,
    collectAnalytics: true,
    promoSent: false,
    promoApproved: [],
  },
  {
    id: 'ses-au',
    title: 'Anterior Uveitis — Differential Diagnosis',
    specialty: 'Uvea',
    description: 'Bedside approach to ciliary flush, hypopyon, and granulomatous vs non-granulomatous patterns.',
    date: '2026-05-30',
    time: '15:00',
    duration: '45',
    type: 'Clinical Teaching',
    stage: 'PRE',
    steps: { studio: true, learners: true, promo: false, analytics: false, questions: false, ready: false },
    hasSources: true,
    sourceFiles: [{ name: 'SUN Working Group — Uveitis nomenclature.pdf', size: '2.4 MB', kind: 'pdf' }],
    prereadFiles: [],
    lockUntilPreread: true,
    collectAnalytics: true,
    promoSent: false,
    promoApproved: [],
  },
  {
    id: 'ses-cat',
    title: 'Cataract Surgical Planning — IOL Power Calculations',
    specialty: 'Cataract & IOL',
    description: 'Walkthrough of biometry, formulas (Barrett, Hill RBF), and the trade-offs in toric IOL selection.',
    date: '2026-06-02',
    time: '11:00',
    duration: '90',
    type: 'Webinar',
    stage: 'PRE',
    steps: { studio: false, learners: false, promo: false, analytics: false, questions: false, ready: false },
    hasSources: false,
    sourceFiles: [],
    prereadFiles: [],
    lockUntilPreread: false,
    collectAnalytics: true,
    promoSent: false,
    promoApproved: [],
  },
  {
    id: 'ses-gl',
    title: 'Glaucoma Suspect — When to Treat',
    specialty: 'Glaucoma',
    description: 'Multi-disciplinary approach to ocular hypertension, disc asymmetry, and visual-field defects in the suspect stage.',
    date: '2026-05-19',
    time: '17:00',
    duration: '60',
    type: 'Grand Rounds',
    stage: 'POST',
    steps: { studio: true, learners: true, promo: true, analytics: true, questions: true, ready: true },
    hasSources: true,
    sourceFiles: [
      { name: 'EGS Guidelines 2022 — Glaucoma Management.pdf', size: '4.2 MB', kind: 'pdf' },
      { name: 'Glaucoma-suspect-cases.pptx', size: '9.3 MB', kind: 'pptx' },
    ],
    prereadFiles: [{ name: 'OCT-RNFL interpretation primer.pdf', size: '1.1 MB', kind: 'pdf' }],
    lockUntilPreread: true,
    collectAnalytics: true,
    promoSent: true,
    promoApproved: ['flyer', 'whatsapp'],
  },
  {
    id: 'ses-cor',
    title: 'Corneal Topography — Reading Patterns',
    specialty: 'Cornea',
    description: 'Systematic approach to Placido-disc topography, keratoconus screening, and post-LASIK pattern recognition.',
    date: '2026-05-14',
    time: '16:00',
    duration: '45',
    type: 'Clinical Teaching',
    stage: 'POST',
    steps: { studio: true, learners: true, promo: true, analytics: true, questions: true, ready: true },
    hasSources: true,
    sourceFiles: [{ name: 'Topography atlas — Corneal patterns.pdf', size: '7.8 MB', kind: 'pdf' }],
    prereadFiles: [],
    lockUntilPreread: false,
    collectAnalytics: true,
    promoSent: true,
    promoApproved: ['flyer', 'whatsapp', 'instagram'],
  },
  {
    id: 'ses-img',
    title: 'Retinal Imaging — OCT, FFA & Wide-field',
    specialty: 'Imaging',
    description: 'How to read multimodal imaging in everyday clinic — pattern recognition over rote memorisation.',
    date: '2026-05-21',
    time: '18:00',
    duration: '60',
    type: 'Simulation Session',
    stage: 'LIVE',
    steps: { studio: true, learners: true, promo: true, analytics: true, questions: true, ready: true },
    hasSources: true,
    sourceFiles: [
      { name: 'AAO BCSC Sec 12 — Retinal Imaging.pdf', size: '8.1 MB', kind: 'pdf' },
      { name: 'OCT-A demo cases.pptx', size: '14.6 MB', kind: 'pptx' },
    ],
    prereadFiles: [{ name: 'Quick primer — OCT layers.pdf', size: '0.9 MB', kind: 'pdf' }],
    lockUntilPreread: true,
    collectAnalytics: true,
    promoSent: true,
    promoApproved: ['flyer', 'whatsapp', 'instagram'],
  },
]

function load(): DemoSession[] {
  if (typeof window === 'undefined') return SEED_SESSIONS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return SEED_SESSIONS
    const parsed = JSON.parse(raw) as DemoSession[]
    if (!Array.isArray(parsed) || parsed.length === 0) return SEED_SESSIONS
    // Migrate older saves that may be missing the analytics step
    return parsed.map((s) => ({
      ...s,
      steps: {
        studio: s.steps.studio ?? false,
        learners: s.steps.learners ?? false,
        promo: s.steps.promo ?? false,
        analytics: (s.steps as Record<string, boolean>).analytics ?? false,
        questions: s.steps.questions ?? false,
        ready: s.steps.ready ?? false,
      },
    }))
  } catch {
    return SEED_SESSIONS
  }
}

function save(sessions: DemoSession[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions))
  } catch {
    /* quota exceeded — fine for a demo */
  }
}

const Ctx = createContext<DemoState | null>(null)

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<DemoSession[]>(SEED_SESSIONS)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate post-hydration load of client-only localStorage state behind a `hydrated` mount guard to avoid SSR mismatch
    setSessions(load())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) save(sessions)
  }, [sessions, hydrated])

  const resetDemo = useCallback(() => {
    setSessions(SEED_SESSIONS)
  }, [])

  const addSession = useCallback<DemoState['addSession']>((s) => {
    const id = `ses-${Math.random().toString(36).slice(2, 8)}`
    setSessions((prev) => [
      {
        id,
        ...s,
        stage: 'PRE',
        steps: { studio: false, learners: false, promo: false, analytics: false, questions: false, ready: false },
        hasSources: false,
        sourceFiles: [],
        prereadFiles: [],
        lockUntilPreread: true,
        collectAnalytics: true,
        promoSent: false,
        promoApproved: [],
      },
      ...prev,
    ])
    return id
  }, [])

  const getSession = useCallback((id: string) => sessions.find((x) => x.id === id), [sessions])

  const updateSession = useCallback<DemoState['updateSession']>((id, patch) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const markStep = useCallback<DemoState['markStep']>((id, step, done) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, steps: { ...s.steps, [step]: done } } : s)))
  }, [])

  const uploadSources = useCallback<DemoState['uploadSources']>((id, files) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, sourceFiles: [...s.sourceFiles, ...files], hasSources: true } : s
      )
    )
  }, [])

  const uploadPrereads = useCallback<DemoState['uploadPrereads']>((id, files) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, prereadFiles: [...s.prereadFiles, ...files] } : s
      )
    )
  }, [])

  const value = useMemo<DemoState>(
    () => ({ sessions, resetDemo, addSession, getSession, updateSession, markStep, uploadSources, uploadPrereads }),
    [sessions, resetDemo, addSession, getSession, updateSession, markStep, uploadSources, uploadPrereads]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDemoState(): DemoState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDemoState must be used inside DemoStateProvider')
  return v
}

export function useDemoSession(id: string): DemoSession | undefined {
  const { getSession } = useDemoState()
  return getSession(id)
}

/** Stage labels & ordering for the 6-step Pre-Conference workflow. */
export const PREP_STEPS: { key: DemoStepKey; label: string; sub: string; href: (sid: string) => string }[] = [
  { key: 'studio', label: 'My Presentation', sub: 'Upload or create slides with AI', href: (sid) => `/demo/sessions/${sid}/studio` },
  { key: 'learners', label: 'Prepare Learners', sub: 'Prereads, mind maps & quiz', href: (sid) => `/demo/sessions/${sid}/learners` },
  { key: 'promo', label: 'Invitations & Teasers', sub: 'Flyers, WhatsApp & Instagram posts', href: (sid) => `/demo/sessions/${sid}/promo` },
  { key: 'analytics', label: 'Responses & Analytics', sub: 'Quiz results, engagement & leaderboard', href: (sid) => `/demo/sessions/${sid}/analytics` },
  { key: 'questions', label: 'Incoming Questions', sub: 'Review what learners are asking', href: (sid) => `/demo/sessions/${sid}/questions` },
  { key: 'ready', label: 'Session Ready', sub: 'Final checks & go-live', href: (sid) => `/demo/sessions/${sid}/ready` },
]

export function stepCompletion(s: DemoSession): { done: number; total: number; pct: number } {
  const total = PREP_STEPS.length
  const done = (Object.keys(s.steps) as DemoStepKey[]).filter((k) => s.steps[k]).length
  return { done, total, pct: Math.round((done / total) * 100) }
}
