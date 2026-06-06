'use client'

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, CheckCircle2, ExternalLink, Play, Loader2,
  Sparkles, AlertCircle, Clock, User,
  Calendar, Plus, Check, Layers, Settings2, X, Upload, Trash2,
  Wand2, Pencil, ArrowLeft, Megaphone,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { validateStudyPackFile, STUDY_PACK_ACCEPT } from '@/lib/upload-accept'
import { PreQuestionsBoard } from '@/components/classroom/pre-questions-board'
import { PreQuestionsDashboard } from '@/components/classroom/pre-questions-dashboard'
import { PollsManager } from '@/components/classroom/polls-manager'
import { PollsVoter } from '@/components/classroom/polls-voter'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StudyPackItem {
  kind: 'reading' | 'video'
  linkId: string
  documentId: string
  title: string
  description: string | null
  mimeType: string
  rank: number | null
  signedUrl: string
  viewedByMe: boolean
  viewedAt: string | null
  durationSec: number | null
}

interface PreCaseItem {
  preCaseId: string
  caseTemplateId: string
  title: string
  condition: string
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
  bloomsLevel: number
  estimatedMinutes: number
  rank: number
  required: boolean
  myCaseId: string | null
  myCaseStatus: 'ACTIVE' | 'COMPLETED' | 'PAUSED' | 'ARCHIVED' | null
  myConversationStatus: 'ACTIVE' | 'COMPLETED' | 'ABANDONED' | null
}

interface StudyPackResponse {
  sessionId: string
  readings: StudyPackItem[]
  videos: StudyPackItem[]
  preCases: PreCaseItem[]
  /** AI-generated from the session transcript (SjtCase). Empty until recorded. */
  quiz: QuizQuestion[]
  /** AI-generated from the session transcript (PostSessionQa). */
  flashcards: { front: string; back: string }[]
}

interface ApiOk<T> { ok: true; data: T }
interface ApiErr { ok: false; error: { code: string; message: string } }

interface StudyPackCandidate {
  linkId: string
  documentId: string
  title: string
  description: string | null
  kind: string
  mimeType: string
  isPreSession: boolean
  preSessionRank: number | null
  uploadedByName: string
  uploadedAt: string
}

interface ObjectiveItem {
  id: string
  text: string
  blooms: number
  epaTag?: string | null
}

interface PrereqItem {
  id: string
  text: string
  required: boolean
}

interface SuggestedObjective {
  text: string
  blooms: number
  rationale: string
}

const BLOOMS: Record<number, { label: string; cls: string }> = {
  1: { label: 'Remember',   cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  2: { label: 'Understand', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  3: { label: 'Apply',      cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  4: { label: 'Analyze',    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  5: { label: 'Evaluate',   cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  6: { label: 'Create',     cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
}

interface Props {
  sessionId: string
  sessionTitle: string
  hostName: string
  scheduledStart: string
  sessionType: string
  isHost?: boolean
  currentUserId: string
  questionCount?: number
  objectiveCount?: number
  objectives?: ObjectiveItem[]
  prereqs?: PrereqItem[]
  promoShareUrl?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatCountdown(iso: string) {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Starting now'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (days > 1) return `${days} days to go`
  if (days === 1) return 'Tomorrow'
  if (hours > 0) return `${hours}h ${mins}m to go`
  return 'Very soon'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

const DIFFICULTY_CONFIG = {
  BEGINNER:     { label: 'Beginner',     cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  INTERMEDIATE: { label: 'Intermediate', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  ADVANCED:     { label: 'Advanced',     cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
}

// ─── AI-generated quiz / flashcards (sourced from the session transcript) ─────

interface QuizQuestion { q: string; options: string[]; correct: number; explanation: string }

// ─── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const r = 38
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct / 100)

  const color = pct >= 80 ? 'text-emerald-500' : pct >= 40 ? 'text-primary' : 'text-amber-500'
  const label = pct >= 80 ? 'Great work!' : pct >= 40 ? 'Good progress' : 'Getting started'

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="relative flex items-center justify-center">
        <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" strokeWidth="7" className="stroke-muted/40" />
          <motion.circle
            cx="48" cy="48" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
            className={color}
            style={{ stroke: 'currentColor' }}
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
          />
        </svg>
        <div className="absolute text-center">
          <p className="text-2xl font-black leading-none">{pct}%</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">done</p>
        </div>
      </div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
    </div>
  )
}

// ─── Status Pill ──────────────────────────────────────────────────────────────

function StatusPill({ viewed }: { viewed: boolean }) {
  return viewed ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      <CheckCircle2 className="size-3" /> Done
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
      Open
    </span>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function StudyPackList({ sessionId, sessionTitle, hostName, scheduledStart, isHost = false, currentUserId, questionCount = 0, objectives = [], prereqs = [], promoShareUrl = null }: Props) {
  const router = useRouter()
  const [data, setData] = useState<StudyPackResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await jsonFetch<StudyPackResponse>(`/api/classroom/sessions/${sessionId}/study-pack`)
      setData(d)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])

  const recordView = useCallback(async (kind: 'reading' | 'video', linkId: string, completed = false, durationSec?: number) => {
    setData((prev) => {
      if (!prev) return prev
      const apply = (arr: StudyPackItem[]) => arr.map((it) => it.linkId === linkId ? { ...it, viewedByMe: true } : it)
      return { ...prev, readings: apply(prev.readings), videos: apply(prev.videos) }
    })
    try {
      await jsonFetch(`/api/classroom/sessions/${sessionId}/study-pack/views`, {
        method: 'POST',
        body: JSON.stringify({ documentLinkId: linkId, completed, durationSec }),
      })
    } catch (e) {
      toast.error(`Could not record view: ${(e as Error).message}`)
      await refresh()
    }
  }, [sessionId, refresh])

  const startPreCase = useCallback(async (preCaseId: string) => {
    setBusyId(preCaseId)
    try {
      const result = await jsonFetch<{ caseId: string; conversationId: string; reused: boolean }>(
        `/api/classroom/sessions/${sessionId}/pre-cases/${preCaseId}/start`,
        { method: 'POST', body: '{}' }
      )
      await jsonFetch(`/api/classroom/sessions/${sessionId}/study-pack/views`, {
        method: 'POST',
        body: JSON.stringify({ preCaseId }),
      }).catch(() => {})
      router.push(`/cases/${result.caseId}`)
    } catch (e) {
      toast.error(`Could not start case: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }, [sessionId, router])

  const totals = useMemo(() => {
    if (!data) return { readings: 0, videos: 0, preCases: 0, done: 0, total: 0 }
    const done =
      data.readings.filter(r => r.viewedByMe).length +
      data.videos.filter(v => v.viewedByMe).length +
      data.preCases.filter(c => c.myCaseStatus === 'COMPLETED').length
    return {
      readings: data.readings.length,
      videos: data.videos.length,
      preCases: data.preCases.length,
      done,
      total: data.readings.length + data.videos.length + data.preCases.length,
    }
  }, [data])

  const pct = totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100)
  const countdown = useMemo(() => formatCountdown(scheduledStart), [scheduledStart])

 // ── Loading ──
  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        <p className="text-sm">Loading study pack…</p>
      </div>
    )
  }

 // ── Error ──
  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
          <AlertCircle className="size-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">Couldn&apos;t load study pack</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={refresh}>Retry</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ── Faculty Prep Panel — host only ── */}
      {isHost && <FacultyPrepPanel sessionId={sessionId} sessionTitle={sessionTitle} questionCount={questionCount} />}

      {/* ── Student Study Hub — resident view ── */}
      {!isHost && data && (
        <StudentStudyHub
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          hostName={hostName}
          scheduledStart={scheduledStart}
          data={data}
          totals={totals}
          pct={pct}
          countdown={countdown}
          recordView={recordView}
          startPreCase={startPreCase}
          busyId={busyId}
          questionCount={questionCount}
          objectives={objectives}
          prereqs={prereqs}
          currentUserId={currentUserId}
          promoShareUrl={promoShareUrl}
        />
      )}
    </div>
  )
}

// ─── Faculty Prep Panel (tabbed) ─────────────────────────────────────────────

type PrepTab = 'materials' | 'objectives' | 'prerequisites' | 'questions' | 'polls'

/** Doubt prompts the presenter publishes to frame what residents ask before
 * the session. Stored on `session.metadata.doubtPrompts`. Resident's Ask &
 * Vote board surfaces these as starter chips above the compose box. */
interface DoubtPrompt {
  id: string
  text: string
}

function FacultyPrepPanel({ sessionId, sessionTitle, questionCount }: { sessionId: string; sessionTitle: string; questionCount: number }) {
  const [activeTab, setActiveTab] = useState<PrepTab>('materials')

 // ── Materials ──
  const [candidates, setCandidates] = useState<StudyPackCandidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(true)
  const [docBusy, setDocBusy] = useState<string | null>(null)

 // Inline upload
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [saveToLibrary, setSaveToLibrary] = useState(true)
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'linking' | 'done'>('idle')
  const fileRef = useRef<HTMLInputElement>(null)

 // ── Objectives ──
  const [objectives, setObjectives] = useState<ObjectiveItem[]>([])
  const [objText, setObjText] = useState('')
  const [objBusy, setObjBusy] = useState(false)
 // Inline-edit state for an existing objective. Only one row can be edited
 // at a time; pressing Save commits to the same saveObjectives path that
 // Add / Remove use, so there's no parallel write path.
  const [editingObjId, setEditingObjId] = useState<string | null>(null)
  const [editingObjText, setEditingObjText] = useState('')

 // ── Prerequisites ──
  const [prereqs, setPrereqs] = useState<PrereqItem[]>([])
  const [prereqText, setPrereqText] = useState('')
  const [prereqRequired, setPrereqRequired] = useState(true)
  const [prereqBusy, setPrereqBusy] = useState(false)

 // ── Q&A tab — doubt prompts (presenter-published framing questions) ──
 // Persisted via the existing PATCH /prep endpoint into session.metadata.
 // Live question count is polled from GET /pre-questions so the tab badge
 // (and the sidebar Prep Check card) reflect new submissions without a
 // page reload.
  const [doubtPrompts, setDoubtPrompts] = useState<DoubtPrompt[]>([])
  const [doubtPromptText, setDoubtPromptText] = useState('')
  const [doubtBusy, setDoubtBusy] = useState(false)
  const [doubtSuggestBusy, setDoubtSuggestBusy] = useState(false)
  const [liveQuestionCount, setLiveQuestionCount] = useState(questionCount)

 // ── AI Objective Suggestions ──
 // Surfaces above the objectives input as accept/dismiss chips. Auto-loads
 // when study material is present AND objectives are still thin (< 3). The
 // speaker stays in control: nothing is persisted until they tap a chip.
  const [suggestions, setSuggestions] = useState<SuggestedObjective[]>([])
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestTried, setSuggestTried] = useState(false)
 // Countdown until Retry becomes enabled again. Driven by server-supplied
 // retryAfterSeconds on AI_UNAVAILABLE errors so we don't bounce the user
 // back into an immediate 503.
  const [retryCountdown, setRetryCountdown] = useState(0)

 // ── Promo & Share ──
 // Banner appears when objectives ≥ 3. The speaker generates the three
 // promo assets (Gemini-driven copy) and mints a public /p/[token] link in
 // one click. State is local — page reload re-evaluates from the server.
  const [promoBusy, setPromoBusy] = useState<'idle' | 'generating' | 'sharing'>('idle')
  const [promoAssetCount, setPromoAssetCount] = useState(0)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
 // Re-entry guard: useState's value is captured at click-time in the
 // closure, so two rapid clicks both see `promoBusy === 'idle'` and slip
 // past the state-based guard. Refs update synchronously, so the second
 // closure sees the ref already-set and returns early.
  const publishingRef = useRef(false)
  const shareUrlRef = useRef<string | null>(null)
  useEffect(() => { shareUrlRef.current = shareUrl }, [shareUrl])

 // ── Load candidates ──
  const loadCandidates = useCallback(async () => {
    setLoadingCandidates(true)
    try {
      const d = await jsonFetch<{ sessionId: string; items: StudyPackCandidate[] }>(
        `/api/classroom/sessions/${sessionId}/study-pack/documents`
      )
      setCandidates(d.items)
    } catch { /* non-critical */ }
    finally { setLoadingCandidates(false) }
  }, [sessionId])

 // ── Load session (objectives + prereqItems) ──
  useEffect(() => {
    void loadCandidates()
    async function loadSession() {
      try {
        const d = await jsonFetch<{ session: { objectives: unknown; metadata: unknown } }>(
          `/api/classroom/sessions/${sessionId}`
        )
        const objs = Array.isArray(d.session.objectives) ? (d.session.objectives as ObjectiveItem[]) : []
        setObjectives(objs)
        const meta = ((d.session.metadata ?? {}) as Record<string, unknown>)
        const pqs = Array.isArray(meta.prereqItems) ? (meta.prereqItems as PrereqItem[]) : []
        setPrereqs(pqs)
        const dps = Array.isArray(meta.doubtPrompts) ? (meta.doubtPrompts as DoubtPrompt[]) : []
        setDoubtPrompts(dps)
      } catch { /* non-critical */ }
    }
    void loadSession()
 // Surface any existing promo share so a reload doesn't appear to wipe
 // the speaker's already-published link. Silent on failure — if there's
 // no live share, the banner CTA is the right resting state. Setting the
 // ref synchronously here closes the race where a user could click the
 // banner CTA before this effect resolves and trigger a duplicate share.
    async function loadCurrentPromoShare() {
      try {
        const d = await jsonFetch<{ share: { url: string; expiresAt: string } | null }>(
          `/api/promo/share?sessionId=${encodeURIComponent(sessionId)}`
        )
        if (d.share?.url) {
          setShareUrl(d.share.url)
          shareUrlRef.current = d.share.url
          publishingRef.current = true
        }
      } catch { /* non-critical */ }
    }
    void loadCurrentPromoShare()
  }, [sessionId, loadCandidates])

  const inPack = candidates.filter(c => c.isPreSession)
  const available = candidates.filter(c => !c.isPreSession)

 // ── Document helpers ──
  async function addDoc(documentId: string) {
    setDocBusy(documentId)
    setCandidates(prev => prev.map(c => c.documentId === documentId ? { ...c, isPreSession: true } : c))
    try {
      await jsonFetch(`/api/classroom/sessions/${sessionId}/study-pack/documents`, {
        method: 'POST', body: JSON.stringify({ documentId }),
      })
    } catch (e) {
      toast.error(`Couldn't add: ${(e as Error).message}`)
      setCandidates(prev => prev.map(c => c.documentId === documentId ? { ...c, isPreSession: false } : c))
    } finally { setDocBusy(null) }
  }

  async function removeDoc(linkId: string) {
    setDocBusy(linkId)
    setCandidates(prev => prev.map(c => c.linkId === linkId ? { ...c, isPreSession: false } : c))
    try {
      await jsonFetch(`/api/classroom/sessions/${sessionId}/study-pack/documents/${linkId}`, { method: 'DELETE' })
    } catch (e) {
      toast.error(`Couldn't remove: ${(e as Error).message}`)
      setCandidates(prev => prev.map(c => c.linkId === linkId ? { ...c, isPreSession: true } : c))
    } finally { setDocBusy(null) }
  }

 // ── Inline upload ──
  async function handleUpload() {
    if (!uploadFile || !uploadTitle.trim() || uploadPhase !== 'idle') return
    const check = validateStudyPackFile(uploadFile)
    if (!check.ok) {
      toast.error(check.reason)
      setUploadFile(null)
      return
    }
    setUploadPhase('uploading')
    try {
      const form = new FormData()
      form.append('title', uploadTitle.trim())
      form.append('file', uploadFile)
      const upRes = await fetch('/api/documents/upload', { method: 'POST', body: form })
      const upJson = (await upRes.json()) as { ok: boolean; data?: { document: { id: string } }; error?: { message: string } }
      if (!upJson.ok || !upJson.data) throw new Error(upJson.error?.message ?? 'Upload failed')
      const docId = upJson.data.document.id
      if (saveToLibrary) void fetch(`/api/documents/${docId}/classify`, { method: 'POST' })

      setUploadPhase('linking')
      const csrf = await getCsrf()
      const h = { 'Content-Type': 'application/json', 'x-csrf-token': csrf }
      await fetch(`/api/documents/${docId}/tag-session`, { method: 'POST', headers: h, body: JSON.stringify({ sessionId }) })
      await fetch(`/api/classroom/sessions/${sessionId}/study-pack/documents`, { method: 'POST', headers: h, body: JSON.stringify({ documentId: docId }) })

      setUploadPhase('done')
      toast.success(`"${uploadTitle}" added to study pack`)
      setUploadFile(null); setUploadTitle('')
      await loadCandidates()
      setTimeout(() => setUploadPhase('idle'), 800)
    } catch (e) {
      toast.error((e as Error).message)
      setUploadPhase('idle')
    }
  }

 // ── Objectives helpers ──
  async function saveObjectives(items: ObjectiveItem[]) {
    setObjBusy(true)
    try {
      const csrf = await getCsrf()
      await fetch(`/api/classroom/sessions/${sessionId}/prep`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ objectives: items }),
      })
      setObjectives(items)
    } catch (e) { toast.error(`Couldn't save: ${(e as Error).message}`) }
    finally { setObjBusy(false) }
  }

  function addObjective() {
    if (!objText.trim() || objectives.length >= 10) return
 // Manual objectives default to Bloom's level 2 (Understand). The field is
 // retained in the data model because AI-suggested objectives still carry
 // a meaningful level, and the Gemini promo prompt reads it as one signal.
    const item: ObjectiveItem = { id: crypto.randomUUID(), text: objText.trim(), blooms: 2 }
    setObjText('')
    void saveObjectives([...objectives, item])
  }

  function removeObjective(id: string) {
    if (editingObjId === id) {
      setEditingObjId(null)
      setEditingObjText('')
    }
    void saveObjectives(objectives.filter(o => o.id !== id))
  }

  function startEditObjective(obj: ObjectiveItem) {
    setEditingObjId(obj.id)
    setEditingObjText(obj.text)
  }

  function cancelEditObjective() {
    setEditingObjId(null)
    setEditingObjText('')
  }

  function commitEditObjective() {
    if (!editingObjId) return
    const text = editingObjText.trim()
    if (text.length < 3) {
      toast.error('Objective text is too short')
      return
    }
    const next = objectives.map(o =>
      o.id === editingObjId ? { ...o, text: text.slice(0, 280) } : o
    )
    setEditingObjId(null)
    setEditingObjText('')
    void saveObjectives(next)
  }

 // ── Prereqs helpers ──
  async function savePrereqs(items: PrereqItem[]) {
    setPrereqBusy(true)
    try {
      const csrf = await getCsrf()
      await fetch(`/api/classroom/sessions/${sessionId}/prep`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ prereqItems: items }),
      })
      setPrereqs(items)
    } catch (e) { toast.error(`Couldn't save: ${(e as Error).message}`) }
    finally { setPrereqBusy(false) }
  }

  function addPrereq() {
    if (!prereqText.trim()) return
    const item: PrereqItem = { id: crypto.randomUUID(), text: prereqText.trim(), required: prereqRequired }
    setPrereqText('')
    void savePrereqs([...prereqs, item])
  }

  function removePrereq(id: string) {
    void savePrereqs(prereqs.filter(p => p.id !== id))
  }

 // ── Doubt-prompts helpers ──
 // Persisted by extending the existing PATCH /prep endpoint — stored in
 // session.metadata.doubtPrompts (same JSON column prereqItems live in).
  async function saveDoubtPrompts(items: DoubtPrompt[]) {
    setDoubtBusy(true)
    try {
      const csrf = await getCsrf()
      await fetch(`/api/classroom/sessions/${sessionId}/prep`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ doubtPrompts: items }),
      })
      setDoubtPrompts(items)
    } catch (e) { toast.error(`Couldn't save: ${(e as Error).message}`) }
    finally { setDoubtBusy(false) }
  }

  function addDoubtPrompt() {
    const text = doubtPromptText.trim()
    if (!text || doubtPrompts.length >= 3) return
    const item: DoubtPrompt = { id: crypto.randomUUID(), text: text.slice(0, 200) }
    setDoubtPromptText('')
    void saveDoubtPrompts([...doubtPrompts, item])
  }

  function removeDoubtPrompt(id: string) {
    void saveDoubtPrompts(doubtPrompts.filter(p => p.id !== id))
  }

  async function suggestDoubtPrompts() {
    if (doubtSuggestBusy) return
    setDoubtSuggestBusy(true)
    try {
      const csrf = await getCsrf()
      const res = await fetch(`/api/classroom/sessions/${sessionId}/pre-questions/prompts/suggest`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
      })
      const j = (await res.json()) as ApiOk<{ suggestions: string[] }> | ApiErr
      if (!res.ok || !j.ok) {
        toast.error(!j.ok ? j.error.message : `HTTP ${res.status}`)
        return
      }
 // Append the suggestions to whatever the speaker already has, capped at 3.
      const fresh = j.data.suggestions
        .map((text): DoubtPrompt => ({ id: crypto.randomUUID(), text: text.slice(0, 200) }))
        .filter(s => s.text.length >= 8)
      if (fresh.length === 0) {
        toast.message('AI couldn\'t draft prompts from this context yet — try adding more objectives or study material.')
        return
      }
      const slots = Math.max(0, 3 - doubtPrompts.length)
      if (slots === 0) {
        toast.message('You already have 3 prompts — remove one to add a suggestion.')
        return
      }
      const merged = [...doubtPrompts, ...fresh.slice(0, slots)]
      void saveDoubtPrompts(merged)
      toast.success(`${Math.min(fresh.length, slots)} prompt${Math.min(fresh.length, slots) === 1 ? '' : 's'} added — review and edit before publishing.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDoubtSuggestBusy(false)
    }
  }

 // ── AI suggestion helpers ──
  async function fetchSuggestions(opts?: { silent?: boolean }) {
    if (suggestBusy) return
    setSuggestBusy(true)
    setSuggestError(null)
    try {
      const csrf = await getCsrf()
      const res = await fetch(`/api/classroom/sessions/${sessionId}/objectives/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      })
      const j = (await res.json()) as ApiOk<{ suggestions: SuggestedObjective[]; materialCount: number; truncated: boolean }> | (ApiErr & { error: { details?: { retryAfterSeconds?: number } } })
      if (!res.ok || !j.ok) {
        const msg = !j.ok ? j.error.message : `HTTP ${res.status}`
        setSuggestError(msg)
 // Server hints us when to allow Retry again (e.g. 30s on a 503).
        const retryAfter = (!j.ok && j.error.details?.retryAfterSeconds) || 0
        if (retryAfter > 0) setRetryCountdown(retryAfter)
        if (!opts?.silent) toast.error(msg)
        return
      }
      setSuggestions(j.data.suggestions)
      setRetryCountdown(0)
      if (!opts?.silent && j.data.suggestions.length === 0) {
        toast.message('AI couldn’t draft new objectives from this material yet.')
      }
    } catch (e) {
      const msg = (e as Error).message
      setSuggestError(msg)
      if (!opts?.silent) toast.error(msg)
    } finally {
      setSuggestBusy(false)
      setSuggestTried(true)
    }
  }

  function acceptSuggestion(s: SuggestedObjective) {
    if (objectives.length >= 10) return
    const item: ObjectiveItem = { id: crypto.randomUUID(), text: s.text, blooms: s.blooms }
    setSuggestions(prev => prev.filter(x => x.text !== s.text))
    void saveObjectives([...objectives, item])
  }

  function dismissSuggestion(idx: number) {
    setSuggestions(prev => prev.filter((_, i) => i !== idx))
  }

 // Auto-load suggestions once when material is available AND objectives are
 // still thin. The speaker can refresh manually after that. Quiet failure
 // we don't want a toast spamming if Gemini is offline.
  useEffect(() => {
    if (activeTab !== 'objectives') return
    if (suggestTried || suggestBusy) return
    if (inPack.length === 0 || objectives.length >= 3) return
    void fetchSuggestions({ silent: true })
 // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, inPack.length, objectives.length, suggestTried])

 // Tick down the AI-retry timer once per second so the Retry button can
 // re-enable on schedule. Pauses naturally at 0.
  useEffect(() => {
    if (retryCountdown <= 0) return
    const t = setTimeout(() => setRetryCountdown(s => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(t)
  }, [retryCountdown])

 // Poll the pre-question count so the Q&A tab badge + sidebar reflect new
 // resident submissions without a manual reload. Fast (3s) on the Q&A tab
 // since the speaker is actively monitoring, slow (30s) elsewhere.
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const d = await jsonFetch<{ items: Array<{ parentId: string | null }> }>(
          `/api/classroom/sessions/${sessionId}/pre-questions`
        )
        if (cancelled) return
        const topLevel = d.items.filter(q => !q.parentId).length
        setLiveQuestionCount(topLevel)
      } catch { /* non-critical */ }
    }
    void poll()
    // 3s was needlessly aggressive (a top CPU/network offender). Live question
    // counts don't change that fast; 12s on the active tab is plenty responsive.
    const interval = activeTab === 'questions' ? 12_000 : 30_000
    const t = setInterval(poll, interval)
    return () => { cancelled = true; clearInterval(t) }
  }, [sessionId, activeTab])

 // ── Promo helpers ──
  async function generatePromo() {
    if (promoBusy !== 'idle') return
    setPromoBusy('generating')
    try {
      const csrf = await getCsrf()
      const res = await fetch('/api/promo/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ sessionId }),
      })
      const j = (await res.json()) as ApiOk<{ documents: Array<{ template: string; documentId: string }> }> | ApiErr
      if (!res.ok || !j.ok) {
        const msg = !j.ok ? j.error.message : `HTTP ${res.status}`
        toast.error(msg)
        return
      }
      setPromoAssetCount(j.data.documents.length)
      toast.success(`Generated ${j.data.documents.length} promo asset${j.data.documents.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPromoBusy('idle')
    }
  }

  async function publishShare() {
 // Ref-based guard: ignores both rapid re-clicks AND clicks after a share
 // has already been published this session. Both situations were creating
 // duplicate PromoShare rows + duplicate Document rows under load.
    if (publishingRef.current || shareUrlRef.current) return
    publishingRef.current = true
    setPromoBusy('sharing')
    let ok = false
    try {
      const csrf = await getCsrf()
      const res = await fetch('/api/promo/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ sessionId }),
      })
      const j = (await res.json()) as ApiOk<{ url: string; expiresAt: string }> | ApiErr
      if (!res.ok || !j.ok) {
        const msg = !j.ok ? j.error.message : `HTTP ${res.status}`
        if (!j.ok && j.error.code === 'NO_ASSETS') {
          toast.message('No promo assets yet — generating first…')
          await generatePromo()
          const r2 = await fetch('/api/promo/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
            body: JSON.stringify({ sessionId }),
          })
          const j2 = (await r2.json()) as ApiOk<{ url: string; expiresAt: string }> | ApiErr
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
        toast.error(msg)
        return
      }
      setShareUrl(j.data.url)
      shareUrlRef.current = j.data.url
      ok = true
      toast.success('Share link ready')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPromoBusy('idle')
 // Only release the ref-guard on FAILURE so the user can retry. On
 // success the guard stays set; the success banner replaces the CTA.
      if (!ok) publishingRef.current = false
    }
  }

  function copyShareUrl() {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(
      () => {
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 1800)
      },
      () => toast.error('Could not copy')
    )
  }

 // Banner becomes visible the moment objectives reach 3 and no share has
 // been published yet. Speaker can dismiss for the session.
  const showPromoBanner = objectives.length >= 3 && !shareUrl && !bannerDismissed

  const tabCounts: Record<PrepTab, number> = {
    materials: inPack.length,
    objectives: objectives.length,
    prerequisites: prereqs.length,
    questions: liveQuestionCount,
    polls: 0, // populated via internal PollsManager state — header badge is informational
  }

  const TAB_LABELS: Record<PrepTab, string> = {
    materials: 'Materials',
    objectives: 'Objectives',
    prerequisites: 'Prerequisites',
    questions: 'Q&A',
    polls: 'Polls',
  }

  const readyCount = [objectives.length > 0, inPack.length > 0, prereqs.length > 0].filter(Boolean).length

  return (
    <div className="mx-auto max-w-5xl px-4 pt-5 pb-3">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden rounded-3xl shadow-2xl shadow-teal-900/10 ring-1 ring-black/[0.06] dark:ring-white/[0.06]"
      >
        {/* ── Dark gradient hero header ── */}
        <div
          className="relative overflow-hidden px-6 py-5"
          style={{ background: 'linear-gradient(135deg, #042F2E 0%, #0F2D3F 50%, #1E1B4B 100%)' }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
          <div className="pointer-events-none absolute -left-12 top-0 size-52 rounded-full blur-[70px]"
            style={{ background: 'rgba(20,184,166,0.3)' }} />
          <div className="pointer-events-none absolute right-0 bottom-0 size-40 rounded-full blur-[60px]"
            style={{ background: 'rgba(99,102,241,0.2)' }} />

          <div className="relative flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-teal-400/30"
                style={{ background: 'rgba(20,184,166,0.15)' }}>
                <Settings2 className="size-5 text-teal-300" />
              </div>
              <div>
                <span className="mb-1.5 inline-flex rounded-full border border-teal-400/25 bg-teal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-teal-300">
                  Session Prep Manager
                </span>
                <p className="text-[15px] font-black leading-tight tracking-tight text-white line-clamp-2">{sessionTitle}</p>
              </div>
            </div>

            {/* Readiness dots */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-1.5">
                {[objectives.length > 0, inPack.length > 0, prereqs.length > 0].map((done, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: i * 0.08, type: 'spring', stiffness: 400, damping: 20 }}
                    className={cn(
                      'size-2.5 rounded-full ring-1 transition-all duration-500',
                      done
                        ? 'bg-emerald-400 ring-emerald-300/50 shadow-sm shadow-emerald-400/50'
                        : 'bg-white/15 ring-white/10'
                    )}
                  />
                ))}
              </div>
              <span className="text-[10px] font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {readyCount}/3 ready
              </span>
            </div>
          </div>
        </div>

        {/* ── Promo & Share banner ── */}
        <AnimatePresence>
          {showPromoBanner && (
            <motion.div
              data-testid="promo-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden border-b border-amber-300/40 bg-gradient-to-r from-amber-50 via-amber-50/70 to-rose-50/60 dark:border-amber-700/30 dark:from-amber-900/15 dark:via-amber-900/10 dark:to-rose-900/10"
            >
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-sm">
                  <Sparkles className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-amber-900 dark:text-amber-200">Looks ready — share this session</p>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/70">
                    Generate flyer + WhatsApp + Instagram from your objectives and mint a public link in one click.
                  </p>
                </div>
                <button
                  data-testid="promo-generate-share"
                  onClick={() => void publishShare()}
                  disabled={promoBusy !== 'idle'}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
                >
                  {promoBusy === 'sharing'
                    ? <><Loader2 className="size-3.5 animate-spin" /> Publishing…</>
                    : promoBusy === 'generating'
                    ? <><Loader2 className="size-3.5 animate-spin" /> Generating…</>
                    : <><Wand2 className="size-3.5" /> Generate &amp; share</>}
                </button>
                <button
                  onClick={() => setBannerDismissed(true)}
                  className="shrink-0 rounded-lg p-1.5 text-amber-700/70 transition hover:bg-amber-200/50 dark:text-amber-300/60"
                  title="Dismiss"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </motion.div>
          )}
          {shareUrl && (
            <motion.div
              data-testid="promo-share-success"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden border-b border-emerald-300/40 bg-gradient-to-r from-emerald-50 to-teal-50/60 dark:border-emerald-800/40 dark:from-emerald-900/15 dark:to-teal-900/10"
            >
              <div className="flex items-center gap-3 px-5 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
                  <CheckCircle2 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-emerald-900 dark:text-emerald-200">Share link ready</p>
                  <p className="truncate text-[11px] font-mono text-emerald-800/80 dark:text-emerald-300/80">{shareUrl}</p>
                </div>
                <button
                  onClick={copyShareUrl}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-emerald-700"
                >
                  {shareCopied ? <><Check className="size-3.5" /> Copied</> : <><Layers className="size-3.5" /> Copy link</>}
                </button>
                <a
                  data-testid="promo-share-preview"
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-[12px] font-bold text-emerald-700 transition hover:bg-emerald-50 dark:bg-card"
                >
                  Preview →
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Animated tab bar ── */}
        <div className="flex items-center gap-0.5 border-b border-border/60 bg-card px-4 pt-1">
          {(Object.keys(TAB_LABELS) as PrepTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-semibold transition-colors"
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="prep-tab-line"
                  className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-teal-500"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              <span className={cn('transition-colors', activeTab === tab ? 'text-teal-700 dark:text-teal-400' : 'text-muted-foreground hover:text-foreground')}>
                {TAB_LABELS[tab]}
              </span>
              {tabCounts[tab] > 0 && (
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-bold transition-colors',
                  activeTab === tab
                    ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300'
                    : 'bg-muted text-muted-foreground'
                )}>
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="grid gap-5 bg-card p-5 lg:grid-cols-[1fr_240px]">
          {/* Main tab content */}
          <div className="min-w-0">
            <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >

            {/* ── MATERIALS TAB ── */}
            {activeTab === 'materials' && (
              <div className="space-y-4">
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  accept={STUDY_PACK_ACCEPT}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const check = validateStudyPackFile(f)
                    if (!check.ok) {
                      toast.error(check.reason)
                      e.target.value = ''
                      return
                    }
                    setUploadFile(f)
                    if (!uploadTitle.trim()) setUploadTitle(f.name.replace(/\.[^.]+$/, ''))
                  }}
                />

                {/* ── IN-PACK docs — always first, prominent ── */}
                {!loadingCandidates && inPack.length > 0 && (
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                      ✓ In study pack · {inPack.length}
                    </p>
                    <div className="space-y-1.5">
                      {inPack.map(c => (
                        <motion.div key={c.linkId} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                          className="relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-emerald-300/70 bg-emerald-50 px-3 py-2.5 dark:border-emerald-700/40 dark:bg-emerald-900/15">
                          {/* Green accent bar */}
                          <div className="absolute inset-y-0 left-0 w-[3px] bg-emerald-500 rounded-l-xl" />
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 ml-1">
                            <FileText className="size-3.5 text-emerald-700 dark:text-emerald-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-bold text-emerald-900 dark:text-emerald-200">{c.title}</p>
                            <p className="text-[10px] text-emerald-700/60 dark:text-emerald-400/70">{c.uploadedByName}</p>
                          </div>
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                            <CheckCircle2 className="size-3" /> Visible
                          </span>
                          <button disabled={docBusy === c.linkId} onClick={() => void removeDoc(c.linkId)}
                            className="shrink-0 rounded-lg p-1.5 text-emerald-600/50 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40" title="Remove from pack">
                            {docBusy === c.linkId ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Upload zone — full only when pack empty, compact strip otherwise ── */}
                {uploadFile ? (
                  <div className="space-y-2.5 rounded-2xl border border-border/50 bg-muted/30 px-4 py-3.5 dark:bg-card/40">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
                        <FileText className="size-4 text-teal-600" />
                      </div>
                      <input
                        value={uploadTitle}
                        onChange={e => setUploadTitle(e.target.value)}
                        placeholder="Document title…"
                        className="flex-1 rounded-lg border border-border/60 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 dark:bg-card"
                      />
                      <button onClick={() => { setUploadFile(null); setUploadTitle('') }} className="shrink-0 text-muted-foreground hover:text-foreground">
                        <X className="size-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                        <input type="checkbox" checked={saveToLibrary} onChange={e => setSaveToLibrary(e.target.checked)}
                          className="size-3.5 rounded border-border text-teal-600 focus:ring-teal-500" />
                        Save to Documents library &amp; AI-classify
                      </label>
                      <button onClick={handleUpload} disabled={!uploadTitle.trim() || uploadPhase !== 'idle'}
                        className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50">
                        {uploadPhase === 'uploading' ? <><Loader2 className="size-3 animate-spin" /> Uploading…</>
                          : uploadPhase === 'linking' ? <><Loader2 className="size-3 animate-spin" /> Adding to pack…</>
                          : uploadPhase === 'done' ? <><Check className="size-3" /> Done!</>
                          : <><Upload className="size-3" /> Upload &amp; add to pack</>}
                      </button>
                    </div>
                  </div>
                ) : inPack.length === 0 ? (
                  /* First-time: big inviting drop zone */
                  <button onClick={() => fileRef.current?.click()}
                    className="group relative flex w-full flex-col items-center gap-3 overflow-hidden rounded-2xl py-8 text-center transition-all hover:scale-[1.01]"
                    style={{ background: 'linear-gradient(135deg, rgba(13,148,136,0.07) 0%, rgba(99,102,241,0.07) 100%)' }}>
                    <div className="pointer-events-none absolute inset-0 rounded-2xl border border-dashed border-teal-400/35 transition-colors group-hover:border-teal-400/55" />
                    <div className="flex size-12 items-center justify-center rounded-2xl ring-4 ring-teal-500/10 transition-all group-hover:ring-teal-500/20"
                      style={{ background: 'linear-gradient(135deg, rgba(13,148,136,0.22), rgba(99,102,241,0.14))' }}>
                      <Upload className="size-5 text-teal-500" />
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-foreground">Drop files here or click to browse</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Supports PDF, PPT, DOC, MP4, images &amp; more</p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {['PDF', 'PPT', 'DOC', 'MP4', 'IMG'].map(t => (
                        <span key={t} className="rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[9px] font-bold text-muted-foreground dark:bg-card/70">{t}</span>
                      ))}
                    </div>
                  </button>
                ) : (
                  /* Incremental: compact add-more strip */
                  <button onClick={() => fileRef.current?.click()}
                    className="group flex w-full items-center gap-2.5 rounded-xl border border-dashed border-border/60 px-3 py-2.5 text-left transition-all hover:border-teal-400/50 hover:bg-teal-50/40 dark:hover:bg-teal-900/10">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted transition group-hover:bg-teal-100 dark:group-hover:bg-teal-900/30">
                      <Plus className="size-3.5 text-muted-foreground group-hover:text-teal-600" />
                    </div>
                    <span className="text-[12px] font-semibold text-muted-foreground group-hover:text-teal-700 dark:group-hover:text-teal-400">
                      Add another file…
                    </span>
                  </button>
                )}

                {/* Action cards — always visible */}
                <div className="grid grid-cols-2 gap-2.5">
                  <Link href={`/teacher/documents?session=${sessionId}`}
                    className="group flex items-center gap-2.5 rounded-xl border border-teal-200/50 bg-teal-50/60 px-3 py-2.5 transition-all hover:border-teal-300/70 hover:bg-teal-50 hover:shadow-sm dark:border-teal-800/30 dark:bg-teal-900/10">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15">
                      <Layers className="size-4 text-teal-600 dark:text-teal-400" />
                    </div>
                    <div>
                      <p className="text-[12px] font-bold text-teal-900 dark:text-teal-300">Link from Library</p>
                      <p className="text-[10px] text-teal-600/70 dark:text-teal-400/60">Browse &amp; attach existing docs</p>
                    </div>
                  </Link>
                  <Link href="/teacher/decks/new"
                    className="group flex items-center gap-2.5 rounded-xl border border-violet-200/50 bg-violet-50/60 px-3 py-2.5 transition-all hover:border-violet-300/70 hover:bg-violet-50 hover:shadow-sm dark:border-violet-800/30 dark:bg-violet-900/10">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15">
                      <Sparkles className="size-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div>
                      <p className="text-[12px] font-bold text-violet-900 dark:text-violet-300">Forge Deck</p>
                      <p className="text-[10px] text-violet-600/70 dark:text-violet-400/60">AI-generate slide deck</p>
                    </div>
                  </Link>
                </div>

                {/* ── Tagged to session (not yet in pack) ── */}
                {loadingCandidates ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading…
                  </div>
                ) : (
                  <>
                    {available.length > 0 && (
                      <div>
                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tagged to session · add to pack</p>
                        <div className="space-y-1.5">
                          {available.map(c => (
                            <motion.div key={c.linkId} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                              className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-white/60 px-3 py-2.5 dark:bg-card/60">
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                                <FileText className="size-3.5 text-muted-foreground" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-medium text-muted-foreground">{c.title}</p>
                                <p className="text-[10px] text-muted-foreground/60">{c.uploadedByName}</p>
                              </div>
                              <button disabled={docBusy === c.documentId} onClick={() => void addDoc(c.documentId)}
                                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-40">
                                {docBusy === c.documentId ? <Loader2 className="size-3 animate-spin" /> : <><Plus className="size-3" /> Add</>}
                              </button>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}
                    {candidates.length === 0 && (
                      <div className="rounded-xl border border-dashed border-teal-300/60 py-5 text-center">
                        <p className="text-sm font-medium text-muted-foreground">No documents linked yet</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">Upload above, link from library, or forge slides.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── OBJECTIVES TAB ── */}
            {activeTab === 'objectives' && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] text-muted-foreground">
                    Add learning objectives residents will work towards. Max 10. Blooms level helps surface the cognitive demand.
                  </p>
                  {inPack.length > 0 && (
                    <button
                      onClick={() => void fetchSuggestions()}
                      disabled={suggestBusy || objectives.length >= 10 || retryCountdown > 0}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700 transition hover:bg-violet-100 disabled:opacity-50 dark:border-violet-800/40 dark:bg-violet-900/20 dark:text-violet-300"
                      title={retryCountdown > 0 ? `AI busy — retry in ${retryCountdown}s` : 'Re-run AI suggestions from your study material'}
                    >
                      {suggestBusy
                        ? <><Loader2 className="size-3 animate-spin" /> Thinking…</>
                        : retryCountdown > 0
                        ? <><Clock className="size-3" /> Retry in {retryCountdown}s</>
                        : <><Wand2 className="size-3" /> {suggestTried ? 'Refresh AI ideas' : 'Suggest with AI'}</>}
                    </button>
                  )}
                </div>

                {/* ── AI-suggested objective chips ── */}
                <AnimatePresence>
                  {suggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 to-fuchsia-50/60 p-3.5 dark:border-violet-800/30 dark:from-violet-900/20 dark:to-fuchsia-900/10"
                    >
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-700 dark:text-violet-300">
                        <Sparkles className="size-3" /> AI ideas from your study material
                      </div>
                      <div className="space-y-1.5">
                        {suggestions.map((s, i) => (
                          <motion.div
                            key={`${s.text}-${i}`}
                            layout
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 6 }}
                            className="group flex items-start gap-2 rounded-xl border border-violet-200/60 bg-white/80 px-3 py-2 dark:border-violet-700/30 dark:bg-card/70"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-medium leading-relaxed text-foreground">{s.text}</p>
                              {s.rationale && (
                                <p className="mt-0.5 text-[10px] italic text-muted-foreground line-clamp-1">{s.rationale}</p>
                              )}
                            </div>
                            <span
                              className={cn('mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold', BLOOMS[s.blooms]?.cls ?? 'bg-muted text-muted-foreground')}
                              title={BLOOMS[s.blooms] ? `Bloom’s level ${s.blooms} — ${BLOOMS[s.blooms].label}` : `Bloom’s level ${s.blooms}`}
                            >
                              L{s.blooms}
                            </span>
                            <button
                              onClick={() => acceptSuggestion(s)}
                              disabled={objBusy || objectives.length >= 10}
                              className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2 py-1 text-[10px] font-bold text-white transition hover:bg-violet-700 disabled:opacity-50"
                              title="Accept as objective"
                            >
                              <Plus className="size-3" /> Accept
                            </button>
                            <button
                              onClick={() => dismissSuggestion(i)}
                              className="shrink-0 rounded-lg p-1 text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
                              title="Dismiss this suggestion"
                            >
                              <X className="size-3" />
                            </button>
                          </motion.div>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground/80">
                        Tap Accept to add as an objective. You can still edit before sharing.
                      </p>
                      {/* Compact legend so faculty don't need to know Bloom's
                          taxonomy by heart to read the L1-L6 badges above. */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-violet-200/40 pt-2 text-[9px] text-muted-foreground dark:border-violet-800/30">
                        <span className="font-semibold uppercase tracking-wider text-violet-700/80 dark:text-violet-300/80">
                          Bloom’s
                        </span>
                        {([1, 2, 3, 4, 5, 6] as const).map((lvl) => (
                          <span key={lvl} className="inline-flex items-center gap-1">
                            <span className={cn('rounded-full px-1 py-px text-[8px] font-bold', BLOOMS[lvl].cls)}>
                              L{lvl}
                            </span>
                            <span>{BLOOMS[lvl].label}</span>
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {suggestError && suggestions.length === 0 && (
                  <div className="flex items-start gap-2 rounded-xl border border-dashed border-amber-300/50 bg-amber-50/50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-700/30 dark:bg-amber-900/10 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 size-3 shrink-0" />
                    <span className="flex-1 leading-relaxed">{suggestError}</span>
                    <button
                      onClick={() => void fetchSuggestions()}
                      disabled={suggestBusy || retryCountdown > 0}
                      className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[10px] font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50 dark:bg-card dark:text-amber-200"
                    >
                      {suggestBusy
                        ? 'Retrying…'
                        : retryCountdown > 0
                        ? `Retry in ${retryCountdown}s`
                        : 'Retry'}
                    </button>
                  </div>
                )}

                {/* Add form */}
                <div className="flex items-start gap-2">
                  <input
                    value={objText}
                    onChange={e => setObjText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addObjective() } }}
                    placeholder="e.g. Describe the pathophysiology of macular oedema…"
                    maxLength={280}
                    disabled={objBusy || objectives.length >= 10}
                    className="flex-1 rounded-xl border border-border/60 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 disabled:opacity-50 dark:bg-card"
                  />
                  <button
                    onClick={addObjective}
                    disabled={!objText.trim() || objBusy || objectives.length >= 10}
                    className="shrink-0 flex items-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-[12px] font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
                  >
                    {objBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    Add
                  </button>
                </div>
                {objectives.length >= 10 && (
                  <p className="text-[11px] text-amber-600">Maximum 10 objectives reached.</p>
                )}

                {/* Objective list */}
                {objectives.length > 0 ? (
                  <div className="space-y-2">
                    {objectives.map((obj, i) => {
                      const isEditing = editingObjId === obj.id
                      return (
                        <motion.div key={obj.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                          className="flex items-start gap-3 rounded-xl border border-border/60 bg-white px-3.5 py-3 dark:bg-card">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">{i + 1}</span>
                          {isEditing ? (
                            <div className="flex flex-1 items-start gap-2">
                              <textarea
                                value={editingObjText}
                                onChange={e => setEditingObjText(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEditObjective() }
                                  if (e.key === 'Escape') { e.preventDefault(); cancelEditObjective() }
                                }}
                                rows={2}
                                maxLength={280}
                                autoFocus
                                className="min-w-0 flex-1 resize-none rounded-lg border border-teal-300 bg-white px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 dark:bg-card"
                              />
                              <div className="flex shrink-0 flex-col gap-1">
                                <button
                                  onClick={commitEditObjective}
                                  disabled={objBusy || editingObjText.trim().length < 3}
                                  className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-50"
                                >
                                  <Check className="size-3" /> Save
                                </button>
                                <button
                                  onClick={cancelEditObjective}
                                  className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-white px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground dark:bg-card"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="flex-1 text-[14px] leading-relaxed text-foreground">{obj.text}</p>
                              <button
                                onClick={() => startEditObjective(obj)}
                                disabled={objBusy}
                                title="Edit objective"
                                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                onClick={() => removeObjective(obj.id)}
                                disabled={objBusy}
                                title="Delete objective"
                                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </>
                          )}
                        </motion.div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/60 py-6 text-center">
                    <p className="text-sm font-medium text-muted-foreground">No objectives yet</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">Add objectives above — students see these after the session.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── PREREQUISITES TAB ── */}
            {activeTab === 'prerequisites' && (
              <div className="space-y-4">
                <p className="text-[11px] text-muted-foreground">
                  List what residents should know or complete before attending. Mark each as Required or Optional.
                </p>

                {/* Add form */}
                <div className="space-y-2">
                  <input
                    value={prereqText}
                    onChange={e => setPrereqText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPrereq() } }}
                    placeholder="e.g. Complete basic slit-lamp module…"
                    maxLength={300}
                    disabled={prereqBusy}
                    className="w-full rounded-xl border border-border/60 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400/30 disabled:opacity-50 dark:bg-card"
                  />
                  <div className="flex items-center justify-between gap-3">
                    {/* Required / Optional toggle */}
                    <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-white p-0.5 dark:bg-card">
                      <button
                        onClick={() => setPrereqRequired(true)}
                        className={cn(
                          'rounded-lg px-3 py-1 text-[11px] font-semibold transition',
                          prereqRequired
                            ? 'bg-rose-500 text-white shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Required
                      </button>
                      <button
                        onClick={() => setPrereqRequired(false)}
                        className={cn(
                          'rounded-lg px-3 py-1 text-[11px] font-semibold transition',
                          !prereqRequired
                            ? 'bg-slate-500 text-white shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Optional
                      </button>
                    </div>
                    <button
                      onClick={addPrereq}
                      disabled={!prereqText.trim() || prereqBusy}
                      className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
                    >
                      {prereqBusy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                      Add
                    </button>
                  </div>
                </div>

                {/* Prereq list */}
                {prereqs.length > 0 ? (
                  <div className="space-y-1.5">
                    {prereqs.map(p => (
                      <motion.div key={p.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                        className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-white px-3 py-2.5 dark:bg-card">
                        <div className={cn(
                          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white',
                          p.required ? 'bg-rose-500' : 'bg-slate-400'
                        )}>
                          {p.required ? '!' : '?'}
                        </div>
                        <p className="flex-1 text-[12px] leading-relaxed">{p.text}</p>
                        <span className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold',
                          p.required
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                            : 'bg-muted text-muted-foreground'
                        )}>
                          {p.required ? 'Required' : 'Optional'}
                        </span>
                        <button
                          onClick={() => removePrereq(p.id)}
                          disabled={prereqBusy}
                          className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/60 py-6 text-center">
                    <p className="text-sm font-medium text-muted-foreground">No prerequisites set</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">Add what students should know or complete before this session.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Q&A TAB ── */}
            {activeTab === 'questions' && (
              <div className="space-y-5">
                {/* Frame their thinking — presenter-published doubt prompts */}
                <div className="rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50/70 to-fuchsia-50/40 p-4 dark:border-violet-800/30 dark:from-violet-900/15 dark:to-fuchsia-900/10">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="size-3.5 text-violet-600 dark:text-violet-400" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-violet-700 dark:text-violet-300">Frame their thinking</span>
                    </div>
                    <button
                      data-testid="doubt-suggest"
                      onClick={() => void suggestDoubtPrompts()}
                      disabled={doubtSuggestBusy || doubtPrompts.length >= 3 || (objectives.length === 0 && inPack.length === 0)}
                      title={objectives.length === 0 && inPack.length === 0 ? 'Add objectives or study material first' : 'Let AI draft framing prompts based on your objectives + material'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700 transition hover:bg-violet-100 disabled:opacity-50 dark:border-violet-800/40 dark:bg-card dark:text-violet-300"
                    >
                      {doubtSuggestBusy
                        ? <><Loader2 className="size-3 animate-spin" /> Thinking…</>
                        : <><Wand2 className="size-3" /> Suggest with AI</>}
                    </button>
                  </div>
                  <p className="mb-3 text-[12px] leading-relaxed text-violet-900/80 dark:text-violet-200/80">
                    Publish 1–3 framing prompts so residents share their biggest doubts ahead of the session. They appear as starter chips above the resident Ask &amp; Vote compose box.
                  </p>

                  {doubtPrompts.length > 0 && (
                    <ul className="mb-3 space-y-1.5">
                      {doubtPrompts.map((p, i) => (
                        <motion.li key={p.id} layout initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                          className="flex items-start gap-2 rounded-xl border border-violet-200/70 bg-white px-3 py-2 dark:border-violet-700/30 dark:bg-card">
                          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[10px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{i + 1}</span>
                          <p className="flex-1 text-[13px] leading-relaxed text-foreground">{p.text}</p>
                          <button
                            onClick={() => removeDoubtPrompt(p.id)}
                            disabled={doubtBusy}
                            title="Remove prompt"
                            className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </motion.li>
                      ))}
                    </ul>
                  )}

                  {doubtPrompts.length < 3 && (
                    <div className="flex items-start gap-2">
                      <input
                        value={doubtPromptText}
                        onChange={e => setDoubtPromptText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDoubtPrompt() } }}
                        placeholder="e.g. What confuses you most about herpetic uveitis…"
                        maxLength={200}
                        disabled={doubtBusy}
                        className="flex-1 rounded-lg border border-violet-200/70 bg-white px-3 py-2 text-[13px] outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 disabled:opacity-50 dark:border-violet-700/30 dark:bg-card"
                      />
                      <button
                        onClick={addDoubtPrompt}
                        disabled={!doubtPromptText.trim() || doubtBusy}
                        className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
                      >
                        {doubtBusy ? <Loader2 className="size-3 animate-spin" /> : 'Publish'}
                      </button>
                    </div>
                  )}
                  {doubtPrompts.length >= 3 && (
                    <p className="text-[11px] text-violet-700/70 dark:text-violet-300/70">Maximum 3 prompts. Remove one to add another.</p>
                  )}
                </div>

                {/* Embedded presenter dashboard — themes + top-voted questions + recluster */}
                <PreQuestionsDashboard sessionId={sessionId} canViewDashboard={true} />
              </div>
            )}

            {/* ── POLLS TAB ── */}
            {activeTab === 'polls' && (
              <PollsManager sessionId={sessionId} />
            )}
            </motion.div>
            </AnimatePresence>
          </div>

          {/* ── Prep checklist sidebar ── */}
          <div className="space-y-3">
            <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Prep checklist</p>

            <PrepCheckCard
              emoji="🎯"
              label="Objectives"
              sublabel={objectives.length > 0 ? `${objectives.length} defined` : 'Not set yet'}
              done={objectives.length > 0}
              onClick={() => setActiveTab('objectives')}
            />
            <PrepCheckCard
              emoji="📁"
              label="Study materials"
              sublabel={inPack.length > 0 ? `${inPack.length} added` : 'None uploaded'}
              done={inPack.length > 0}
              onClick={() => setActiveTab('materials')}
            />
            <PrepCheckCard
              emoji="💬"
              label="Student questions"
              sublabel={liveQuestionCount > 0 ? `${liveQuestionCount} waiting` : 'None yet'}
              done={liveQuestionCount > 0}
              onClick={() => setActiveTab('questions')}
            />
            <PrepCheckCard
              emoji="📋"
              label="Prerequisites"
              sublabel={prereqs.length > 0
                ? `${prereqs.filter(p => p.required).length}R · ${prereqs.filter(p => !p.required).length}O`
                : 'Not defined'}
              done={prereqs.length > 0}
              onClick={() => setActiveTab('prerequisites')}
            />
            <PrepCheckCard
              emoji="✨"
              label="Promo & share"
              sublabel={shareUrl
                ? 'Public link live'
                : promoAssetCount > 0
                ? `${promoAssetCount} asset${promoAssetCount === 1 ? '' : 's'} ready`
                : objectives.length >= 3
                ? 'Ready to generate'
                : 'Add 3+ objectives first'}
              done={!!shareUrl}
 // Once a link is live, the sidebar opens the live preview in a
 // new tab instead of running publishShare again (which would
 // mint a duplicate row).
              link={shareUrl ?? undefined}
              onClick={shareUrl
                ? undefined
                : objectives.length >= 3
                ? () => void publishShare()
                : undefined}
            />
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function PrepCheckCard({ emoji, label, sublabel, done, onClick, link }: {
  emoji: string
  label: string
  sublabel: string
  done: boolean
  onClick?: () => void
  link?: string
}) {
  const inner = (
    <motion.div
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      className="relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-border/40 bg-card px-3 py-2.5 transition-all hover:shadow-sm"
    >
      <div className={cn(
        'absolute inset-y-0 left-0 w-[3px]',
        done ? 'bg-emerald-500' : 'bg-orange-400'
      )} />
      <span className="text-base leading-none">{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold leading-snug text-foreground">{label}</p>
        <p className="text-[10px] text-muted-foreground">{sublabel}</p>
      </div>
      {done
        ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        : <span className="shrink-0 rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-white">Pending</span>
      }
    </motion.div>
  )
  if (link) {
 // Absolute URLs (e.g. the live promo share at /p/[token] presented as
 // origin+path) open in a new tab so the speaker keeps their prep
 // state. Relative routes stay SPA-navigated via next/link.
    const isAbsolute = /^https?:\/\//i.test(link)
    return isAbsolute
      ? <a href={link} target="_blank" rel="noopener noreferrer" className="block">{inner}</a>
      : <Link href={link} className="block">{inner}</Link>
  }
  return <div onClick={onClick}>{inner}</div>
}

// ─── Student Study Hub ────────────────────────────────────────────────────────

interface StudentHubProps {
  sessionId: string
  sessionTitle: string
  hostName: string
  scheduledStart: string
  data: StudyPackResponse
  totals: { readings: number; videos: number; preCases: number; done: number; total: number }
  pct: number
  countdown: string
  recordView: (kind: 'reading' | 'video', linkId: string, completed?: boolean, durationSec?: number) => void
  startPreCase: (preCaseId: string) => void
  busyId: string | null
  questionCount: number
  objectives: ObjectiveItem[]
  prereqs: PrereqItem[]
  currentUserId: string
  promoShareUrl: string | null
}

type StudyTab = 'objectives' | 'readings' | 'videos' | 'cases' | 'quiz' | 'flashcards' | 'polls' | 'questions'
interface TabDef { id: StudyTab; label: string; emoji: string; badge?: number; show: boolean }

function StudentStudyHub({
  sessionId, sessionTitle, hostName, scheduledStart,
  data, totals, countdown,
  recordView, startPreCase, busyId, questionCount,
  objectives, prereqs, currentUserId, promoShareUrl,
}: StudentHubProps) {
  const hasObjectives = objectives.length > 0 || prereqs.length > 0
 // Real AI-generated content from the session transcript (empty until recorded).
  const quiz = data.quiz
  const flashcards = data.flashcards
  const [activeTab, setActiveTab] = useState<StudyTab>(hasObjectives ? 'objectives' : 'readings')
  const [quizIdx, setQuizIdx] = useState(0)
  const [quizSelected, setQuizSelected] = useState<Record<number, number>>({})
  const [drillIdx, setDrillIdx] = useState(0)
  const [drillResults, setDrillResults] = useState<Record<number, 'got' | 'missed'>>({})

  function handleQuizSelect(optIdx: number) {
    if (quizSelected[quizIdx] !== undefined) return
    setQuizSelected(prev => ({ ...prev, [quizIdx]: optIdx }))
  }

  function nextQuestion() {
    if (quizIdx < quiz.length - 1) setQuizIdx(i => i + 1)
  }

 // Readiness includes quiz — opening a file alone is not enough
  const quizAnswered = Object.keys(quizSelected).length
  const compDone = totals.done + quizAnswered
  const compTotal = totals.total + quiz.length
  const compPct = compTotal === 0 ? 0 : Math.round((compDone / compTotal) * 100)

  const topicRows = [
    { label: 'Readings', val: totals.readings === 0 ? 100 : Math.round((data.readings.filter(r => r.viewedByMe).length / totals.readings) * 100), color: 'bg-blue-500' },
    ...(totals.videos > 0 ? [{ label: 'Videos', val: Math.round((data.videos.filter(v => v.viewedByMe).length / totals.videos) * 100), color: 'bg-rose-500' }] : []),
    ...(totals.preCases > 0 ? [{ label: 'Cases', val: Math.round((data.preCases.filter(c => c.myCaseStatus === 'COMPLETED').length / totals.preCases) * 100), color: 'bg-amber-500' }] : []),
    { label: 'Pre-Quiz', val: quiz.length === 0 ? 100 : Math.round((quizAnswered / quiz.length) * 100), color: 'bg-violet-500' },
  ]

  const aiTip = compPct === 0
    ? 'Start with Objectives to understand what this session covers.'
    : compPct < 50 ? 'Complete pre-readings to engage more actively in the session.'
    : compPct < 100 ? 'Almost there — finish remaining items to maximise your readiness.'
    : 'Excellent prep — you are fully ready for this session.'

  const allTabs: TabDef[] = [
    { id: 'objectives' as const, label: 'Objectives', emoji: '🎯', show: hasObjectives },
    { id: 'readings'   as const, label: 'Readings',   emoji: '📖', badge: data.readings.length, show: true },
    { id: 'videos'     as const, label: 'Videos',     emoji: '▶️', badge: data.videos.length, show: data.videos.length > 0 },
    { id: 'cases'      as const, label: 'Cases',      emoji: '🧠', badge: data.preCases.length, show: data.preCases.length > 0 },
    { id: 'quiz'       as const, label: 'Quiz',       emoji: '❓', badge: quiz.length, show: true },
    { id: 'flashcards' as const, label: 'Flashcards', emoji: '🃏', badge: flashcards.length, show: true },
    { id: 'polls'      as const, label: 'Poll',       emoji: '📊', show: true },
    { id: 'questions'  as const, label: 'Ask & Vote', emoji: '💬', badge: questionCount || undefined, show: true },
  ]
  const tabs = allTabs.filter(t => t.show)

  return (
    <>
      {/* Session strip — edge-to-edge gradient with integrated back arrow */}
      <div className="relative overflow-hidden border-b border-white/10"
        style={{ background: 'linear-gradient(135deg, #042F2E 0%, #0F2D3F 55%, #1E1B4B 100%)' }}>
        {/* Ambient orbs for depth */}
        <div aria-hidden className="pointer-events-none absolute -top-24 -left-20 size-72 rounded-full bg-teal-500/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 size-80 rounded-full bg-indigo-500/10 blur-3xl" />

        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3.5 sm:px-8">
          <Link href={`/classroom/${sessionId}`}
            aria-label="Back to classroom"
            className="group flex size-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition hover:border-white/30 hover:bg-white/10 hover:text-white hover:-translate-x-0.5">
            <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
          </Link>
          <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/75 shrink-0">Study Hub</span>
          <h1 className="text-base font-bold text-white truncate max-w-xs sm:max-w-lg lg:max-w-2xl">{sessionTitle}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-white/55">
            {hostName && <span className="flex items-center gap-1.5"><User className="size-3.5" />{hostName}</span>}
            <span className="flex items-center gap-1.5"><Calendar className="size-3.5" />{formatDate(scheduledStart)}</span>
            <span className="flex items-center gap-1.5"><Clock className="size-3.5" />{formatTime(scheduledStart)}</span>
          </div>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {compTotal > 0 && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-400" initial={{ width: 0 }} animate={{ width: `${compPct}%` }} transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }} />
                </div>
                <span className="text-[12px] font-bold tabular-nums text-teal-300">{compPct}%</span>
              </div>
            )}
            <span className="flex items-center gap-1.5 rounded-full bg-teal-500/20 px-3 py-1 text-[11px] font-bold text-teal-300 ring-1 ring-inset ring-teal-400/20">
              <span className="size-1.5 rounded-full bg-teal-400 animate-pulse" />{countdown}
            </span>
          </div>
        </div>
      </div>

      {/* Tab bar — wider canvas, larger type, sticky */}
      <div className="sticky top-0 z-10 border-b border-border/60 bg-card/85 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-6 sm:px-8">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={cn('relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-4 py-3 text-sm font-semibold transition-colors',
                  activeTab === tab.id ? 'text-teal-700 dark:text-teal-400' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                )}>
                {activeTab === tab.id && (
                  <motion.div layoutId="study-tab-line" className="absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full bg-gradient-to-r from-teal-500 to-emerald-500" transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }} />
                )}
                <span className="text-base leading-none">{tab.emoji}</span>
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                    activeTab === tab.id ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300' : 'bg-muted text-muted-foreground'
                  )}>{tab.badge}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main 2-col layout — Q&A tab takes full width (it has its own themes sidebar) */}
      <div className="mx-auto max-w-7xl px-6 py-6 sm:px-8">
        <div className={cn('grid gap-6', activeTab === 'questions' ? 'grid-cols-1' : 'lg:grid-cols-[1fr_320px]')}>

          {/* Tab content */}
          <div className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>

                {activeTab === 'objectives' && (
                  <ObjectivesFlyer objectives={objectives} prereqs={prereqs} sessionTitle={sessionTitle} hostName={hostName} scheduledStart={scheduledStart} promoShareUrl={promoShareUrl} />
                )}

                {activeTab === 'readings' && (
                  <div className="space-y-2">
                    {data.readings.length === 0
                      ? <EmptyTab label="No pre-readings added yet" />
                      : data.readings.map(r => (
                        <div key={r.linkId} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
                            <FileText className="size-4 text-blue-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold">{r.title}</p>
                            {r.description && <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{r.description}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <a href={r.signedUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[11px] font-semibold transition hover:border-teal-300 hover:text-teal-700 dark:bg-card">
                              Open <ExternalLink className="size-3" />
                            </a>
                            {r.viewedByMe
                              ? <StatusPill viewed />
                              : <button onClick={() => void recordView('reading', r.linkId, true)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-teal-700">
                                  <Check className="size-3" /> Mark read
                                </button>
                            }
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}

                {activeTab === 'videos' && (
                  <div className="space-y-2">
                    {data.videos.length === 0
                      ? <EmptyTab label="No videos added" />
                      : data.videos.map(v => (
                        <div key={v.linkId} className="overflow-hidden rounded-xl border border-border/60 bg-card">
                          <video controls preload="metadata" className="w-full bg-black" src={v.signedUrl}
                            onEnded={() => void recordView('video', v.linkId, true)} />
                          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold">{v.title}</p>
                              {v.description && <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{v.description}</p>}
                            </div>
                            {v.viewedByMe ? <StatusPill viewed /> : (
                              <Button variant="outline" size="sm" onClick={() => void recordView('video', v.linkId, true)}>Mark watched</Button>
                            )}
                          </div>
                        </div>
                      ))
                    }
                  </div>
                )}

                {activeTab === 'cases' && (
                  <div className="space-y-2">
                    {data.preCases.length === 0
                      ? <EmptyTab label="No cases added" />
                      : data.preCases.map(c => {
                          const completed = c.myCaseStatus === 'COMPLETED'
                          const inProgress = c.myCaseStatus === 'ACTIVE'
                          const diff = DIFFICULTY_CONFIG[c.difficulty]
                          return (
                            <div key={c.preCaseId} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3">
                              <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', completed ? 'bg-emerald-500/10' : 'bg-amber-500/10')}>
                                {completed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Sparkles className="size-4 text-amber-600" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <p className="text-[13px] font-semibold">{c.title}</p>
                                  <div className="flex shrink-0 flex-wrap gap-1.5">
                                    {c.required && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">Required</span>}
                                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', diff.cls)}>{diff.label}</span>
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">~{c.estimatedMinutes} min</span>
                                  </div>
                                </div>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">{c.condition}</p>
                                <div className="mt-2 flex items-center justify-between">
                                  <span className={cn('text-[11px] font-medium', completed ? 'text-emerald-600' : inProgress ? 'text-primary' : 'text-muted-foreground')}>
                                    {completed ? '✓ Completed' : inProgress ? 'In progress' : 'Not started'}
                                  </span>
                                  <Button size="sm" variant={completed ? 'outline' : 'default'} disabled={busyId === c.preCaseId} onClick={() => void startPreCase(c.preCaseId)}>
                                    {busyId === c.preCaseId ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                                    {completed ? 'Review' : inProgress ? 'Resume' : 'Start'}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )
                        })
                    }
                  </div>
                )}

                {activeTab === 'quiz' && (
                  quiz.length === 0
                    ? <StudyContentEmpty emoji="❓" title="No quiz yet" detail="Generated from the session recording." />
                    : <QuizZone quiz={quiz} quizIdx={quizIdx} selected={quizSelected} onSelect={handleQuizSelect} onNext={nextQuestion} />
                )}

                {activeTab === 'flashcards' && (
                  flashcards.length === 0
                    ? <StudyContentEmpty emoji="🃏" title="No flashcards yet" detail="Generated after the session." />
                    : <FlashcardDrill cards={flashcards} drillIdx={drillIdx} setDrillIdx={setDrillIdx} results={drillResults} setResults={setDrillResults} />
                )}

                {/* pre-session structured polls (LiveHook kind=POLL,
                    pre-published). Mentimeter-style: one vote, then aggregate. */}
                {activeTab === 'polls' && (
                  <PollsVoter sessionId={sessionId} />
                )}

                {activeTab === 'questions' && (
                  <PreQuestionsBoard sessionId={sessionId} currentUserId={currentUserId} />
                )}

              </motion.div>
            </AnimatePresence>
          </div>

          {/* Sidebar — hidden on Q&A tab (board has its own themes sidebar) */}
          {activeTab !== 'questions' && (
          <div className="space-y-4 lg:sticky lg:top-[89px] lg:self-start">
            <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.1 }}
              className="rounded-2xl border border-border/60 bg-card p-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Your Readiness</p>
              <ProgressRing done={compDone} total={compTotal} />
              <div className="mt-4 space-y-2.5">
                {topicRows.map(row => (
                  <div key={row.label} className="flex items-center gap-2.5">
                    <p className="w-20 shrink-0 text-[11px] text-muted-foreground">{row.label}</p>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <motion.div className={cn('h-full rounded-full', row.color)} initial={{ width: 0 }} animate={{ width: `${row.val}%` }} transition={{ duration: 0.8, ease: 'easeOut', delay: 0.5 }} />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[10px] font-mono text-muted-foreground">{row.val}%</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {compPct < 100 && (
              <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.2 }}
                className="rounded-2xl border border-amber-200/60 bg-amber-50/60 p-4 dark:border-amber-800/30 dark:bg-amber-900/10">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-sm">💡</span>
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-400">Study tip</p>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300/80">{aiTip}</p>
              </motion.div>
            )}

            <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.3 }}
              className="rounded-2xl border border-border/60 bg-card p-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Conference Schedule</p>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-400" />
                  <div>
                    <p className="text-[12px] font-semibold">Prep closes</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(scheduledStart)} · Midnight</p>
                    <span className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-bold text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">Action needed</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="mt-1.5 size-2 shrink-0 rounded-full bg-teal-500" />
                  <div>
                    <p className="text-[12px] font-semibold">{sessionTitle}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(scheduledStart)} · {formatTime(scheduledStart)}</p>
                    <span className="mt-1 inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-bold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">{countdown}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
          )}

        </div>
      </div>
    </>
  )
}

// ─── Objectives Flyer ─────────────────────────────────────────────────────────

function ObjectivesFlyer({ objectives, prereqs, sessionTitle, hostName, scheduledStart, promoShareUrl }: {
  objectives: ObjectiveItem[]
  prereqs: PrereqItem[]
  sessionTitle: string
  hostName: string
  scheduledStart: string
  promoShareUrl: string | null
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">

      {/* Header — teal accent bar matching Vaidix brand */}
      <div className="border-b border-border/60 bg-teal-50/60 px-5 py-4 dark:bg-teal-900/10">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
              Session Brief
            </span>
            {objectives.length > 0 && (
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                {objectives.length} Objective{objectives.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {promoShareUrl && (
            <motion.a
              href={promoShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              whileHover={{ y: -1 }}
              className="group relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-teal-600 via-emerald-600 to-teal-700 px-3.5 py-2 text-[12px] font-bold text-white shadow-md shadow-teal-900/20 ring-1 ring-inset ring-white/15 transition hover:shadow-lg hover:shadow-teal-900/30"
            >
              {/* Animated shimmer */}
              <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <Megaphone className="size-3.5" />
              <span>Session Flyer</span>
              <ExternalLink className="size-3 opacity-80" />
            </motion.a>
          )}
        </div>
        <h2 className="text-lg font-black leading-tight tracking-tight text-foreground">{sessionTitle}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
          {hostName && <span className="flex items-center gap-1"><User className="size-3" />{hostName}</span>}
          <span className="flex items-center gap-1"><Calendar className="size-3" />{formatDate(scheduledStart)}</span>
          <span className="flex items-center gap-1"><Clock className="size-3" />{formatTime(scheduledStart)}</span>
        </div>
      </div>

      {/* Prerequisites */}
      {prereqs.length > 0 && (
        <div className="border-b border-border/40 px-5 py-4">
          <p className="mb-3 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
            Prerequisites — what you should know before attending
          </p>
          <div className="flex flex-wrap gap-2">
            {prereqs.map(p => (
              <span key={p.id} className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1',
                p.required
                  ? 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-900/20 dark:text-rose-400 dark:ring-rose-800/40'
                  : 'bg-muted text-muted-foreground ring-border/60'
              )}>
                {p.required && <span className="size-1.5 rounded-full bg-rose-500 shrink-0" />}
                {p.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Learning objectives */}
      {objectives.length > 0 && (
        <div className="px-5 py-5">
          <p className="mb-4 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
            Learning Objectives — after this session you will be able to…
          </p>
          <div className="space-y-3">
            {objectives.map((o, i) => (
              <motion.div key={o.id}
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.04 * i, duration: 0.25 }}
                className="flex items-start gap-4">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-[11px] font-black text-teal-700 dark:border-teal-800/50 dark:bg-teal-900/20 dark:text-teal-400">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-[13px] font-medium leading-snug text-foreground">{o.text}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {BLOOMS[o.blooms] && (
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', BLOOMS[o.blooms].cls)}>
                        {BLOOMS[o.blooms].label}
                      </span>
                    )}
                    {o.epaTag && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        {o.epaTag}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ─── Quiz Zone ────────────────────────────────────────────────────────────────

function QuizZone({ quiz, quizIdx, selected, onSelect, onNext }: {
  quiz: QuizQuestion[]
  quizIdx: number
  selected: Record<number, number>
  onSelect: (idx: number) => void
  onNext: () => void
}) {
  const q = quiz[quizIdx]
  const answered = selected[quizIdx] !== undefined
  const isDone = quizIdx === quiz.length - 1 && answered
  const score = quiz.reduce((acc, _, i) => acc + (selected[i] === quiz[i]?.correct ? 1 : 0), 0)

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-2xl"
      style={{ background: 'linear-gradient(135deg, #1B2B4B 0%, #0F2D3F 100%)' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Knowledge Primer</span>
          <div>
            <p className="text-[14px] font-bold text-white">Pre-Session MCQ Quiz</p>
            <p className="text-[11px] text-white/40">{quiz.length} questions · Activate your prior knowledge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {quiz.map((_, i) => (
              <div key={i} className={cn('h-1.5 w-7 rounded-full transition-colors',
                i < quizIdx ? 'bg-teal-500' : i === quizIdx ? 'bg-amber-400' : 'bg-white/15'
              )} />
            ))}
          </div>
          <span className="text-[11px] text-white/40">Q{quizIdx + 1}/{quiz.length}</span>
        </div>
      </div>

      {/* Body */}
      <AnimatePresence mode="wait">
        <motion.div key={quizIdx} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.22 }} className="px-5 py-5">
          <p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/35">Question {quizIdx + 1} of {quiz.length}</p>
          <p className="mb-5 text-[14px] font-semibold leading-snug text-white">{q.q}</p>

          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {q.options.map((opt, i) => {
              const isSel = selected[quizIdx] === i
              const isRight = i === q.correct && answered
              const isWrong = isSel && i !== q.correct
              return (
                <button key={i} onClick={() => onSelect(i)} disabled={answered}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all',
                    answered ? 'cursor-default' : 'cursor-pointer hover:border-white/25 hover:bg-white/10',
                    isRight ? 'border-emerald-500/70 bg-emerald-500/20'
                      : isWrong ? 'border-rose-500/60 bg-rose-500/15'
                      : isSel ? 'border-teal-500 bg-teal-500/20'
                      : 'border-white/10 bg-white/[0.04]'
                  )}>
                  <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold transition-colors',
                    isRight ? 'bg-emerald-500 text-white' : isWrong ? 'bg-rose-500 text-white' : isSel ? 'bg-teal-500 text-white' : 'bg-white/10 text-white/50'
                  )}>{String.fromCharCode(65 + i)}</span>
                  <span className="text-[12px] leading-snug text-white/80">{opt}</span>
                </button>
              )
            })}
          </div>

          <AnimatePresence>
            {answered && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
                <div className="rounded-r-xl border-l-2 border-teal-400 bg-teal-500/10 px-4 py-3">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-teal-400">
                    {selected[quizIdx] === q.correct ? '✓ Correct · Here\'s why' : '✗ Incorrect · Here\'s why'}
                  </p>
                  <p className="text-[12px] leading-relaxed text-white/70">{q.explanation}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between">
            {!answered && (
              <span className="cursor-pointer text-[12px] text-white/30 transition hover:text-white/50" onClick={onNext}>
                Skip
              </span>
            )}
            {answered && !isDone && (
              <button onClick={onNext} className="ml-auto rounded-lg bg-teal-500 px-5 py-2 text-[13px] font-semibold text-white transition hover:bg-teal-400">
                Next Question →
              </button>
            )}
            {isDone && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[12px] text-white/50">Quiz complete!</span>
                <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-400">
                  {score}/{quiz.length} correct
                </span>
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

function EmptyTab({ label }: { label: string }) {
  return <div className="py-8 text-center"><p className="text-sm text-muted-foreground">{label}</p></div>
}

// Honest empty state for the AI-generated Quiz / Flashcard tabs — keeps the
// dark gradient card look of the populated zones, but states plainly that the
// content has not been generated yet. No fabricated questions/cards.
function StudyContentEmpty({ emoji, title, detail }: { emoji: string; title: string; detail: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-2 overflow-hidden rounded-2xl px-6 py-12 text-center"
      style={{ background: 'linear-gradient(135deg, #1B2B4B 0%, #0F2D3F 100%)' }}>
      <span className="text-4xl opacity-80">{emoji}</span>
      <p className="text-[14px] font-bold text-white">{title}</p>
      <p className="max-w-xs text-[12px] leading-relaxed text-white/50">{detail}</p>
    </motion.div>
  )
}

// ─── Flashcard Drill ──────────────────────────────────────────────────────────

function FlashcardDrill({ cards, drillIdx, setDrillIdx, results, setResults }: {
  cards: { front: string; back: string }[]
  drillIdx: number
  setDrillIdx: React.Dispatch<React.SetStateAction<number>>
  results: Record<number, 'got' | 'missed'>
  setResults: React.Dispatch<React.SetStateAction<Record<number, 'got' | 'missed'>>>
}) {
  const [flipped, setFlipped] = useState(false)
  const card = cards[drillIdx]
  const isDone = drillIdx >= cards.length
  const gotCount = Object.values(results).filter(r => r === 'got').length
  const missedCount = Object.values(results).filter(r => r === 'missed').length

  function handleResult(r: 'got' | 'missed') {
    setResults(prev => ({ ...prev, [drillIdx]: r }))
    setFlipped(false)
    setTimeout(() => setDrillIdx(i => i + 1), 150)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">🃏 Flashcard Quick Drill</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{cards.length} cards</span>
        </div>
        {!isDone && <span className="text-[11px] text-muted-foreground">Card {drillIdx + 1} / {cards.length}</span>}
      </div>

      {isDone ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card py-10 text-center">
          <span className="text-4xl">🎉</span>
          <p className="font-bold">Drill complete!</p>
          <div className="flex gap-3">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-[12px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">✓ Got {gotCount}</span>
            <span className="rounded-full bg-rose-100 px-3 py-1 text-[12px] font-bold text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">✗ Missed {missedCount}</span>
          </div>
          <button onClick={() => { setDrillIdx(0); setResults({}); setFlipped(false) }}
            className="rounded-xl bg-teal-600 px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-teal-700">
            Restart Drill
          </button>
        </div>
      ) : (
        <div className="relative h-[170px] cursor-pointer" onClick={() => setFlipped(f => !f)} style={{ perspective: '800px' }}>
          <motion.div animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: 0.45, type: 'spring', stiffness: 300, damping: 30 }}
            className="relative h-full w-full" style={{ transformStyle: 'preserve-3d' }}>
            <div className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-2xl p-5"
              style={{ background: 'linear-gradient(135deg, #1B2B4B 0%, #0F2D3F 100%)', backfaceVisibility: 'hidden' }}>
              <p className="text-[9px] uppercase tracking-widest text-white/35">Front · Click to reveal answer</p>
              <p className="text-[13px] font-semibold leading-snug text-white">{card.front}</p>
              <p className="text-[10px] text-teal-400">↻ Click to flip</p>
            </div>
            <div className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-2xl p-5"
              style={{ background: 'linear-gradient(135deg, #065A50 0%, #042F2E 100%)', backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
              <p className="text-[9px] uppercase tracking-widest text-white/35">Answer</p>
              <p className="text-[13px] leading-snug text-white">{card.back}</p>
              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => handleResult('got')}
                  className="flex-1 rounded-lg bg-emerald-500/30 py-1.5 text-[12px] font-bold text-emerald-300 transition hover:bg-emerald-500/50">
                  ✓ Got it
                </button>
                <button onClick={() => handleResult('missed')}
                  className="flex-1 rounded-lg bg-rose-500/20 py-1.5 text-[12px] font-bold text-rose-400 transition hover:bg-rose-500/35">
                  ✗ Missed it
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
