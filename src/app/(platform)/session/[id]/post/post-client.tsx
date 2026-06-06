'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Bell,
  BellOff,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Info,
  Link2,
  MessageCircle,
  Play,
  Plus,
  Send,
  Share2,
  Sparkles,
  ThumbsUp,
  Trophy,
  Users2,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ensureCsrfHeaders } from '@/lib/csrf-client'
import type { SessionView } from '@/lib/medlearn/session-view'
import type { PostData } from './post-data'

type PostTab =
  | 'overview'
  | 'pearls'
  | 'reels'
  | 'doubts'
  | 'materials'
  | 'simulations'
  | 'evaluation'
  | 'analytics'
  | 'share'

interface Doubt {
  id: string
  author: string
  cohort: string
  text: string
  time: string
  pinned: boolean
  answered: boolean
  endorsed: number
  reply?: string
  peerReplies?: { author: string; initials: string; text: string }[]
  questionType?: 'doubt' | 'text-based' | 'open-ended'
}

const TABS: { key: PostTab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview',    label: 'Overview',    icon: <Sparkles className="size-3.5" /> },
  { key: 'pearls',      label: 'Pearls',      icon: <Zap className="size-3.5" /> },
  { key: 'reels',       label: 'Reels',       icon: <Play className="size-3.5" /> },
  { key: 'doubts',      label: 'Doubts',      icon: <MessageCircle className="size-3.5" /> },
  { key: 'materials',   label: 'Materials',   icon: <FileText className="size-3.5" /> },
  { key: 'simulations', label: 'Simulations', icon: <Brain className="size-3.5" /> },
  { key: 'evaluation',  label: 'Evaluation',  icon: <BarChart3 className="size-3.5" /> },
  { key: 'analytics',   label: 'Analytics',   icon: <Trophy className="size-3.5" /> },
  { key: 'share',       label: 'Share',       icon: <Share2 className="size-3.5" /> },
]

function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

function formatBytes(bytesStr: string): string {
  const bytes = Number(bytesStr)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// Adapt a real PostDoubt (Q&A item) into the demo's Doubt render-shape.
function toDoubt(d: PostData['doubts'][number]): Doubt {
  return {
    id: d.id,
    author: d.author,
    cohort: '',
    text: d.text,
    time: relativeTime(d.time),
    pinned: d.pinned,
    answered: d.answered,
    endorsed: d.endorsed,
    reply: d.answer ?? undefined,
    questionType: 'doubt',
    peerReplies: d.replies.map((r) => ({
      author: r.author,
      initials: r.author.split(' ').map((w) => w[0]).join('').slice(0, 2),
      text: r.text,
    })),
  }
}

export function PostClient({ session, data, canViewAnalytics = true }: { session: SessionView; data: PostData; canViewAnalytics?: boolean }) {
  // Real session materials from DocumentSessionLink (split pre-session vs presentation).
  const sourceFiles = data.materials.filter((m) => !m.isPreSession)
  const prereadFiles = data.materials.filter((m) => m.isPreSession)

  const [activeTab, setActiveTab] = useState<PostTab>('overview')
  // Pearls + reels are AI-generated; generation is PARKED behind real buttons.
  const pearls = data.pearls
  const [doubts, setDoubts] = useState<Doubt[]>(() => data.doubts.map(toDoubt))
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const [expandedDoubt, setExpandedDoubt] = useState<string | null>(null)
  const [expandedSim, setExpandedSim] = useState<string | null>(data.cases[0]?.id ?? null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [showEvalInfo, setShowEvalInfo] = useState(false)
  const [scoresVisibleToStudents, setScoresVisibleToStudents] = useState(false)
  const [showAddQuestion, setShowAddQuestion] = useState(false)
  const [newQuestionType, setNewQuestionType] = useState<'text-based' | 'open-ended'>('text-based')
  const [newQuestionText, setNewQuestionText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [generateBusy, setGenerateBusy] = useState(false)
  const [generateMsg, setGenerateMsg] = useState<string | null>(null)
  // Post-conference doubts are the recording Q&A — "open" while a recording exists.
  const doubtsOpen = data.hasRecording
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [doubts])

  const qaBase = `/api/classroom/sessions/${session.id}/qa`

  // ── Real Q&A actions (recording-backed PostSessionQa / QaItem) ─────────────
  const sendReply = async (did: string) => {
    const text = (replyDraft[did] ?? '').trim()
    if (!text) return
    setActionError(null)
    // Optimistic
    setDoubts((prev) => prev.map((d) => d.id === did ? { ...d, reply: text, answered: true } : d))
    setReplyDraft((r) => ({ ...r, [did]: '' }))
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch(`${qaBase}/${did}/answer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...csrf },
        body: JSON.stringify({ answer: text }),
      })
      if (!res.ok) throw new Error('Failed to post answer')
    } catch {
      setActionError('Could not save your answer. Please try again.')
    }
  }

  const endorseDoubt = async (did: string) => {
    setActionError(null)
    setDoubts((prev) => prev.map((d) => d.id === did ? { ...d, endorsed: d.endorsed + 1 } : d))
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch(`${qaBase}/${did}/likes`, { method: 'POST', headers: csrf })
      if (res.ok) {
        const json = await res.json().catch(() => null)
        const likeCount = json?.data?.likeCount
        if (typeof likeCount === 'number') {
          setDoubts((prev) => prev.map((d) => d.id === did ? { ...d, endorsed: likeCount } : d))
        }
      }
    } catch {
      setActionError('Could not endorse. Please try again.')
    }
  }

  const togglePin = async (did: string) => {
    setActionError(null)
    const target = doubts.find((d) => d.id === did)
    const next = !(target?.pinned ?? false)
    setDoubts((prev) => prev.map((d) => d.id === did ? { ...d, pinned: next } : d))
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch(`${qaBase}/${did}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrf },
        body: JSON.stringify({ pinned: next }),
      })
      if (!res.ok) throw new Error('pin failed')
    } catch {
      // revert
      setDoubts((prev) => prev.map((d) => d.id === did ? { ...d, pinned: !next } : d))
      setActionError('Could not update pin. Only the host / PD / admin can pin.')
    }
  }

  // Add Question: posts a real top-level Q&A item to the recording.
  const addQuestion = async () => {
    const text = newQuestionText.trim()
    if (!text) return
    setActionError(null)
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch(qaBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrf },
        body: JSON.stringify({ timestampSec: 0, question: text }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error?.message ?? 'Failed to post question')
      }
      const json = await res.json().catch(() => null)
      const newId = json?.data?.id ?? `tmp-${Date.now()}`
      setDoubts((prev) => [
        ...prev,
        { id: newId, author: 'You', cohort: '', text, time: 'just now', pinned: false, answered: false, endorsed: 0, questionType: newQuestionType },
      ])
      setNewQuestionText('')
      setShowAddQuestion(false)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not post the question (a recording is required).')
    }
  }

  // Share: mint a real recording-share link (or surface a graceful message).
  const copyLink = async () => {
    setShareError(null)
    if (shareLink) {
      try { await navigator.clipboard.writeText(shareLink) } catch { /* ignore */ }
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
      return
    }
    setShareBusy(true)
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch(`/api/classroom/sessions/${session.id}/recording-share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrf },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        if (res.status === 409) throw new Error('No recording to share yet.')
        throw new Error('Could not create a share link.')
      }
      const json = await res.json().catch(() => null)
      const url: string | undefined = json?.data?.url
      if (!url) throw new Error('Share link unavailable.')
      setShareLink(url)
      try { await navigator.clipboard.writeText(url) } catch { /* ignore */ }
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Could not create a share link.')
    } finally {
      setShareBusy(false)
    }
  }

  // Fetch a signed download URL for a session document and open it.
  const openDocument = async (documentId: string) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/documents/${documentId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load document')
      const json = await res.json().catch(() => null)
      const url: string | undefined = json?.data?.document?.downloadUrl
      if (!url) throw new Error('Download link unavailable')
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not open the document.')
    }
  }

  // Park AI generation (pearls / reels / post-session pack). The Gemini/worker
  // pipeline is offline in this env; the route enqueues a job or 503s gracefully.
  const triggerGeneration = async (label: string) => {
    setGenerateBusy(true)
    setGenerateMsg(null)
    try {
      const csrf = await ensureCsrfHeaders()
      const res = await fetch(`/api/classroom/sessions/${session.id}/post-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrf },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        setGenerateMsg(`${label} generation queued — content will appear once processing completes.`)
      } else {
        setGenerateMsg(`${label} generation is offline right now. Please try again later.`)
      }
    } catch {
      setGenerateMsg(`${label} generation is offline right now. Please try again later.`)
    } finally {
      setGenerateBusy(false)
    }
  }

  // Group Kirkpatrick evaluations by learner (real data; honest empty otherwise).
  const KIRK_LABEL: Record<string, string> = {
    L1_REACTION: 'L1 · Reaction',
    L2_LEARNING: 'L2 · Learning',
    L3_BEHAVIOR: 'L3 · Behaviour',
    L4_RESULTS: 'L4 · Results',
  }
  const KIRK_ORDER = ['L1_REACTION', 'L2_LEARNING', 'L3_BEHAVIOR', 'L4_RESULTS']
  const evalGroups = (() => {
    const byUser = new Map<string, { userId: string; name: string; initials: string; levels: { label: string; score: number; order: number }[] }>()
    for (const e of data.evaluations) {
      const g = byUser.get(e.userId) ?? { userId: e.userId, name: e.name, initials: e.initials, levels: [] }
      const order = KIRK_ORDER.indexOf(e.level)
      g.levels.push({ label: KIRK_LABEL[e.level] ?? e.level, score: Math.round(e.score), order: order < 0 ? 99 : order })
      byUser.set(e.userId, g)
    }
    return Array.from(byUser.values())
      .map((g) => {
        const levels = g.levels.sort((a, b) => a.order - b.order)
        const overall = levels.length > 0 ? Math.round(levels.reduce((s, l) => s + l.score, 0) / levels.length) : null
        return { ...g, levels, overall }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  })()

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link href={`/session/${session.id}/prepare`} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            Back to session
          </Link>
          <h1 className="mt-1 text-[22px] font-bold tracking-tight">{session.title}</h1>
          <div className="mt-1 flex items-center gap-3 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/10 px-2.5 py-0.5 text-[10.5px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-500/20">
              <Check className="size-3" /> Post-Conference Active
            </span>
            <span>{session.specialty} · {session.type}</span>
            <span>{session.date}</span>
            {doubtsOpen && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/20">
                <Bell className="size-3" /> Doubts open
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex items-center gap-0.5 overflow-x-auto rounded-2xl border border-border/60 bg-card p-1 scrollbar-hide">
        {TABS.filter((t) => t.key !== 'analytics' || canViewAnalytics).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-medium transition-all',
              activeTab === t.key
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Learners',         value: String(data.attendedCount),  sub: `attended · ${data.invitedCount} invited`,       color: 'from-teal-500/15 to-emerald-500/10',  icon: <Users2 className="size-4 text-teal-600" /> },
              { label: 'Avg Engagement',   value: data.avgEngagement === null ? '—' : `${data.avgEngagement}%`, sub: data.avgEngagement === null ? 'no signal' : 'during session',       color: 'from-sky-500/15 to-blue-500/10',       icon: <BarChart3 className="size-4 text-sky-600" /> },
              { label: 'Evaluations',      value: String(data.evaluations.length), sub: data.evaluations.length === 0 ? 'not generated' : 'Kirkpatrick',          color: 'from-amber-500/15 to-orange-500/10',   icon: <Trophy className="size-4 text-amber-600" /> },
              { label: 'Doubts Raised',    value: String(data.doubtsCount),  sub: doubtsOpen ? 'open' : 'closed', color: 'from-violet-500/15 to-purple-500/10',  icon: <MessageCircle className="size-4 text-violet-600" /> },
            ].map((s) => (
              <div key={s.label} className={cn('rounded-2xl border border-border/60 bg-linear-to-br p-4', s.color)}>
                <div className="flex items-center justify-between">
                  <div className="grid size-9 place-items-center rounded-xl bg-white/60">{s.icon}</div>
                </div>
                <div className="mt-3 text-[26px] font-bold tracking-tight">{s.value}</div>
                <div className="text-[11px] font-medium text-muted-foreground">{s.label}</div>
                <div className="text-[10.5px] text-muted-foreground/70">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { tab: 'pearls' as PostTab,      icon: <Zap className="size-5 text-amber-600" />,        title: 'Knowledge Pearls',        desc: data.pearls.length > 0 ? `${data.pearls.length} pearl${data.pearls.length === 1 ? '' : 's'} from this session` : 'No pearls yet — generate from session', color: 'bg-amber-50 border-amber-200' },
              { tab: 'reels' as PostTab,        icon: <Play className="size-5 text-rose-600" />,        title: 'Content Reels',           desc: data.recordings.length > 0 ? 'Generate reels from the recording' : 'No recording to clip yet', color: 'bg-rose-50 border-rose-200' },
              { tab: 'doubts' as PostTab,       icon: <MessageCircle className="size-5 text-sky-600" />, title: doubtsOpen ? 'Doubts (Open)' : 'Doubts',           desc: `${data.doubtsCount} question${data.doubtsCount === 1 ? '' : 's'}`, color: 'bg-sky-50 border-sky-200' },
              { tab: 'simulations' as PostTab,  icon: <Brain className="size-5 text-violet-600" />,     title: 'AI Simulations',          desc: data.cases.length > 0 ? `${data.cases.length} case${data.cases.length === 1 ? '' : 's'} in the bank` : 'No cases for this topic yet', color: 'bg-violet-50 border-violet-200' },
              { tab: 'evaluation' as PostTab,   icon: <BarChart3 className="size-5 text-teal-600" />,   title: 'Evaluation Report',       desc: data.evaluations.length > 0 ? `Kirkpatrick scoring · ${data.evaluations.length} record${data.evaluations.length === 1 ? '' : 's'}` : 'No evaluations generated yet', color: 'bg-teal-50 border-teal-200' },
              { tab: 'analytics' as PostTab,    icon: <Trophy className="size-5 text-emerald-600" />,   title: 'Full Analytics',          desc: data.analytics.length > 0 ? `${data.analytics.length} participant${data.analytics.length === 1 ? '' : 's'}` : 'No participant data yet', color: 'bg-emerald-50 border-emerald-200' },
            ].map((f) => (
              <button
                key={f.tab}
                type="button"
                onClick={() => setActiveTab(f.tab)}
                className={cn('rounded-2xl border p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5', f.color)}
              >
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/70">{f.icon}</div>
                  <div>
                    <div className="text-[13.5px] font-semibold">{f.title}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">{f.desc}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── PEARLS ───────────────────────────────────────────────────────── */}
      {activeTab === 'pearls' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-semibold">Knowledge Pearls</h2>
              <p className="text-[12.5px] text-muted-foreground">Key clinical takeaways extracted from this session&apos;s recording &amp; topic</p>
            </div>
            <button type="button" onClick={() => triggerGeneration('Pearls')} disabled={generateBusy || !data.hasRecording}
              title={data.hasRecording ? 'Generate pearls from the session' : 'A recording is required to generate pearls'}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500 px-3.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-amber-400 disabled:opacity-40">
              <Sparkles className={cn('size-3.5', generateBusy && 'animate-spin')} /> {generateBusy ? 'Generating…' : 'Generate pearls'}
            </button>
          </div>

          {generateMsg && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800">{generateMsg}</div>
          )}

          {pearls.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-10 text-center">
              <Zap className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-2 text-[13px] font-medium text-muted-foreground">No pearls yet</div>
              <div className="text-[11.5px] text-muted-foreground">Generate pearls from the session recording to populate this library.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {pearls.map((pearl) => (
                <div key={pearl.id} className="overflow-hidden rounded-2xl border border-teal-200 bg-teal-50">
                  <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-teal-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-teal-800">Pearl</span>
                      <span className="text-[12.5px] font-semibold">{pearl.title}</span>
                    </div>
                    {pearl.extractedByAi && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-semibold text-teal-700"><Sparkles className="size-2.5" /> AI</span>
                    )}
                  </div>
                  <div className="px-4 pb-3">
                    <p className="text-[12.5px] leading-relaxed text-gray-700">{pearl.body}</p>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/60 bg-white/40 px-4 py-2">
                    {pearl.approved ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600"><Check className="size-3" /> Approved</span>
                    ) : (
                      <span className="text-[10.5px] text-muted-foreground">Pending approval</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── REELS ────────────────────────────────────────────────────────── */}
      {activeTab === 'reels' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-semibold">Content Reels</h2>
              <p className="text-[12.5px] text-muted-foreground">Short concept reels &amp; soundbites are clipped from the session recording</p>
            </div>
            <button type="button" onClick={() => triggerGeneration('Reels')} disabled={generateBusy || data.recordings.length === 0}
              title={data.recordings.length > 0 ? 'Generate reels from the recording' : 'A recording is required to generate reels'}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rose-500 px-3.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-rose-400 disabled:opacity-40">
              <Sparkles className={cn('size-3.5', generateBusy && 'animate-spin')} /> {generateBusy ? 'Generating…' : 'Generate reels'}
            </button>
          </div>

          {generateMsg && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-800">{generateMsg}</div>
          )}

          {data.recordings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-10 text-center">
              <Play className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-2 text-[13px] font-medium text-muted-foreground">No recording to clip yet</div>
              <div className="text-[11.5px] text-muted-foreground">Reels are generated from the session recording once it is processed.</div>
            </div>
          ) : (
            <div>
              <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Session Recording</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.recordings.map((r) => (
                  <div key={r.id} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                    <div className="flex h-28 items-center justify-center bg-linear-to-br from-slate-800 to-slate-900">
                      {r.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumbnailUrl} alt="Recording thumbnail" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid size-12 place-items-center rounded-full bg-white/10 ring-2 ring-white/20"><Play className="size-5 text-white" /></div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="text-[12.5px] font-semibold leading-snug">Session recording</div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="capitalize">{r.status.toLowerCase()}</span>
                        {r.durationSec != null && (<><span>·</span><span className="font-mono">{Math.floor(r.durationSec / 60)}:{String(r.durationSec % 60).padStart(2, '0')}</span></>)}
                      </div>
                      {r.hlsUrl && (
                        <a href={r.hlsUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center justify-center gap-1 rounded-full border border-teal-200 bg-teal-50 py-1.5 text-[10.5px] text-teal-600 hover:bg-teal-100">
                          <Play className="size-3" /> Open recording
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DOUBTS ───────────────────────────────────────────────────────── */}
      {activeTab === 'doubts' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-semibold">Learner Doubts &amp; Questions</h2>
              <p className="text-[12.5px] text-muted-foreground">Questions raised on the session recording · peer replies are discussion</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {doubtsOpen && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-50 px-3 py-1.5 text-[11.5px] font-semibold text-amber-700">
                  <Bell className="size-3.5" /> Open
                </span>
              )}
              <button type="button" disabled={!doubtsOpen} onClick={() => setShowAddQuestion((v) => !v)}
                title={doubtsOpen ? 'Post a question' : 'A recording is required to post questions'}
                className="inline-flex items-center gap-1.5 rounded-full bg-teal-500 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-teal-400 disabled:opacity-40">
                <Plus className="size-3.5" /> Add Question
              </button>
            </div>
          </div>

          {actionError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{actionError}</div>
          )}

          {/* Add question form */}
          {showAddQuestion && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700">New Faculty Question</div>
              <div className="flex gap-2">
                {(['text-based', 'open-ended'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setNewQuestionType(t)}
                    className={cn('rounded-full border px-3 py-1 text-[10.5px] font-semibold transition-colors', newQuestionType === t ? 'border-teal-500 bg-teal-500 text-white' : 'border-teal-300 bg-white text-teal-600 hover:bg-teal-100')}>
                    {t === 'text-based' ? 'Text-based (MCQ / Short answer)' : 'Open-ended (Free response)'}
                  </button>
                ))}
              </div>
              <textarea value={newQuestionText} onChange={(e) => setNewQuestionText(e.target.value)}
                placeholder={newQuestionType === 'text-based' ? 'Enter your question…' : 'Enter your open-ended prompt…'}
                rows={2} className="w-full rounded-xl border border-teal-300 bg-white px-3 py-2 text-[12.5px] outline-none focus:ring-2 focus:ring-teal-400" />
              <div className="flex gap-2">
                <button type="button" disabled={!newQuestionText.trim()} onClick={addQuestion}
                  className="inline-flex items-center gap-1.5 rounded-full bg-teal-500 px-4 py-1.5 text-[11.5px] font-semibold text-white hover:bg-teal-400 disabled:opacity-40">
                  <Send className="size-3" /> Post Question
                </button>
                <button type="button" onClick={() => { setShowAddQuestion(false); setNewQuestionText('') }}
                  className="rounded-full border border-teal-200 px-4 py-1.5 text-[11.5px] text-gray-600 hover:bg-white">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {doubts.map((d) => (
              <div key={d.id}
                className={cn('overflow-hidden rounded-2xl border bg-card',
                  d.pinned ? 'border-amber-300' :
                  d.questionType === 'text-based' ? 'border-sky-300' :
                  d.questionType === 'open-ended'  ? 'border-violet-300' :
                  'border-border/60'
                )}
              >
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={cn('grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white bg-linear-to-br',
                      d.questionType === 'text-based' ? 'from-sky-400 to-blue-500' :
                      d.questionType === 'open-ended' ? 'from-violet-400 to-purple-500' :
                      'from-teal-400 to-emerald-500')}>
                      {d.author.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{d.author}</span>
                        <span>{d.cohort}</span>
                        <span>·</span>
                        <span>{d.time}</span>
                        {d.questionType === 'text-based' && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[9px] font-bold text-sky-700">Text-based</span>}
                        {d.questionType === 'open-ended' && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold text-violet-700">Open-ended</span>}
                        {d.pinned && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700">📌 Pinned</span>}
                        {d.answered && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-bold text-teal-700">✓ Answered</span>}
                      </div>
                      <p className="mt-1 text-[13px] text-foreground">{d.text}</p>
                    </div>
                  </div>

                  {/* Peer replies */}
                  {d.peerReplies && d.peerReplies.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {d.peerReplies.map((pr, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-2.5">
                          <div className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-400 text-[9px] font-bold text-white">{pr.initials}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[10px] font-semibold text-indigo-700">{pr.author}</span>
                              <span className="rounded-full bg-indigo-200 px-1.5 py-0.5 text-[8px] font-bold text-indigo-700">Peer reply</span>
                            </div>
                            <p className="text-[11.5px] text-gray-700">{pr.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Faculty reply */}
                  {d.reply && (
                    <div className="mt-3 rounded-xl border border-teal-200 bg-teal-50 p-3">
                      <div className="text-[10px] font-bold text-teal-600 uppercase tracking-wider mb-1">Faculty Answer</div>
                      <p className="text-[12.5px] text-gray-700">{d.reply}</p>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => endorseDoubt(d.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-[10.5px] text-muted-foreground hover:border-teal-300 hover:text-teal-600">
                      <ThumbsUp className="size-3" /> Endorse ({d.endorsed})
                    </button>
                    <button type="button" onClick={() => togglePin(d.id)}
                      className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px]', d.pinned ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-border/60 text-muted-foreground hover:border-amber-300 hover:text-amber-600')}>
                      📌 {d.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button type="button" onClick={() => setExpandedDoubt(expandedDoubt === d.id ? null : d.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10.5px] text-teal-600 hover:bg-teal-100">
                      <MessageCircle className="size-3" /> {d.answered ? 'Update answer' : 'Answer'}
                    </button>
                  </div>

                  {expandedDoubt === d.id && (
                    <div className="mt-3 space-y-2">
                      <input
                        value={replyDraft[d.id] ?? ''}
                        onChange={(e) => setReplyDraft((r) => ({ ...r, [d.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && sendReply(d.id)}
                        placeholder="Type your answer…"
                        className="w-full rounded-xl border border-teal-300 bg-teal-50 px-4 py-2 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-teal-400"
                      />
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => sendReply(d.id)}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-teal-500 px-4 py-1.5 text-[10.5px] font-semibold text-white hover:bg-teal-400">
                          <Send className="size-3" /> Send Answer
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {doubts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-10 text-center">
                <MessageCircle className="mx-auto size-8 text-muted-foreground" />
                <div className="mt-2 text-[13px] font-medium text-muted-foreground">No doubts yet</div>
                <div className="text-[11.5px] text-muted-foreground">{doubtsOpen ? 'Learner questions on the recording will appear here.' : 'Questions open once the session recording is ready.'}</div>
              </div>
            )}
          </div>

          {!doubtsOpen && (
            <div className="rounded-2xl border border-border/60 bg-foreground/[0.02] p-6 text-center">
              <BellOff className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-2 text-[13px] font-medium text-muted-foreground">Doubt period has ended</div>
              <div className="text-[11.5px] text-muted-foreground">No new questions can be submitted</div>
            </div>
          )}
        </div>
      )}

      {/* ── MATERIALS ────────────────────────────────────────────────────── */}
      {activeTab === 'materials' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-[17px] font-semibold">Session Materials</h2>
            <p className="text-[12.5px] text-muted-foreground">View or download only — editing is disabled for completed sessions</p>
          </div>

          {data.materials.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-10 text-center">
              <FileText className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-2 text-[13px] font-medium text-muted-foreground">No materials linked</div>
              <div className="text-[11.5px] text-muted-foreground">Documents linked to this session will appear here.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {sourceFiles.length > 0 && (
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Presentation &amp; Documents</div>
              )}
              {sourceFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4">
                  <div className={cn('grid size-9 shrink-0 place-items-center rounded-xl text-white', f.kind === 'PDF' ? 'bg-rose-500' : f.kind === 'SLIDES' ? 'bg-orange-500' : f.kind === 'VIDEO' ? 'bg-violet-500' : 'bg-blue-500')}>
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{f.name}</div>
                    <div className="text-[11px] text-muted-foreground">{formatBytes(f.sizeBytes)} · {f.kind}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => openDocument(f.documentId)} className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1.5 text-[10.5px] text-muted-foreground hover:bg-foreground/5">
                      <Eye className="size-3" /> View
                    </button>
                    <button type="button" onClick={() => openDocument(f.documentId)} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[10.5px] text-teal-600 hover:bg-teal-100">
                      <Download className="size-3" /> Download
                    </button>
                  </div>
                </div>
              ))}

              {prereadFiles.length > 0 && (
                <>
                  <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pre-Read Materials</div>
                  {prereadFiles.map((f) => (
                    <div key={f.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4">
                      <div className={cn('grid size-9 shrink-0 place-items-center rounded-xl text-white', f.kind === 'PDF' ? 'bg-rose-500' : f.kind === 'VIDEO' ? 'bg-violet-500' : 'bg-blue-500')}>
                        <FileText className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{f.name}</div>
                        <div className="text-[11px] text-muted-foreground">{formatBytes(f.sizeBytes)} · {f.kind}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => openDocument(f.documentId)} className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1.5 text-[10.5px] text-muted-foreground hover:bg-foreground/5">
                          <Eye className="size-3" /> View
                        </button>
                        <button type="button" onClick={() => openDocument(f.documentId)} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[10.5px] text-teal-600 hover:bg-teal-100">
                          <Download className="size-3" /> Download
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SIMULATIONS ──────────────────────────────────────────────────── */}
      {activeTab === 'simulations' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-[17px] font-semibold">Case Simulations</h2>
            <p className="text-[12.5px] text-muted-foreground">Published case-bank scenarios for this session&apos;s topic — open the case bank to run them</p>
          </div>

          {generateMsg && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-[12px] text-violet-800">{generateMsg}</div>
          )}

          {data.cases.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-10 text-center">
              <Brain className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-2 text-[13px] font-medium text-muted-foreground">No cases for this topic yet</div>
              <div className="text-[11.5px] text-muted-foreground">Forge a case from the session to add it to the program case bank.</div>
            </div>
          ) : (
            data.cases.map((sc) => (
              <div key={sc.id} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 p-4 text-left"
                  onClick={() => setExpandedSim(expandedSim === sc.id ? null : sc.id)}
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-600">
                    <Brain className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold">{sc.title}</div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11.5px] text-muted-foreground">
                      <span>{sc.condition}</span>
                      <span className="capitalize">{sc.difficulty.toLowerCase()}</span>
                      <span>Bloom L{sc.bloomsLevel}</span>
                      <span>{sc.estimatedMinutes} min</span>
                      <span>{sc.completions} completion{sc.completions === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  {expandedSim === sc.id ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                </button>

                {expandedSim === sc.id && (
                  <div className="border-t border-border/60 p-4">
                    <div className="mb-3 rounded-xl border border-border/60 bg-foreground/[0.02] p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Scenario</div>
                      <p className="text-[12.5px] text-foreground">{sc.description}</p>
                    </div>
                    <Link href={`/cases/${sc.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100">
                      <ExternalLink className="size-3" /> Open case
                    </Link>
                  </div>
                )}
              </div>
            ))
          )}

          <button type="button" onClick={() => triggerGeneration('Case')} disabled={generateBusy || !data.hasRecording}
            title={data.hasRecording ? 'Forge a new case from the session' : 'A recording is required to forge a case'}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-violet-300 py-3 text-[12px] text-violet-600 hover:border-violet-400 hover:bg-violet-50/50 disabled:opacity-40">
            <Sparkles className={cn('size-3.5', generateBusy && 'animate-spin')} /> {generateBusy ? 'Generating…' : 'Generate case from session'}
          </button>
        </div>
      )}

      {/* ── EVALUATION ───────────────────────────────────────────────────── */}
      {activeTab === 'evaluation' && (
        <div className="space-y-6">
          {/* Header with actions */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[17px] font-semibold">Student Evaluation</h2>
                <button type="button" onClick={() => setShowEvalInfo((v) => !v)}
                  title="How scores are calculated"
                  className="grid size-5 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5">
                  <Info className="size-4" />
                </button>
              </div>
              <p className="text-[12.5px] text-muted-foreground">Kirkpatrick Levels 1–4 — learning-impact scores recorded for this session</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" onClick={() => setScoresVisibleToStudents((v) => !v)}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                  scoresVisibleToStudents ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-border/60 text-muted-foreground hover:border-teal-300 hover:text-teal-600')}>
                <Eye className="size-3.5" />
                {scoresVisibleToStudents ? 'Scores visible to students' : 'Scores hidden from students'}
              </button>
              <button type="button" disabled={evalGroups.length === 0} onClick={() => downloadBlob(
                  evalGroups.map((g) => `${g.name}\n${g.levels.map((l) => `${l.label}: ${l.score}`).join(', ')}`).join('\n\n'),
                  'evaluation-report.txt'
                )}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-teal-300 hover:text-teal-600 disabled:opacity-40">
                <Download className="size-3.5" /> Download
              </button>
            </div>
          </div>

          {/* Scoring info panel */}
          {showEvalInfo && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-sky-800">
                  <Info className="size-4" /> How scores are calculated
                </div>
                <button type="button" onClick={() => setShowEvalInfo(false)} className="text-sky-400 hover:text-sky-700"><X className="size-4" /></button>
              </div>
              <div className="grid grid-cols-1 gap-3 text-[11.5px] text-sky-900 sm:grid-cols-2">
                <div className="rounded-xl border border-sky-200 bg-white p-3">
                  <div className="mb-1 font-bold text-[10px] uppercase tracking-wider text-sky-600">Kirkpatrick Framework</div>
                  <p>L1 Reaction · L2 Learning · L3 Behaviour · L4 Results. Each level is scored 0–100 from post-session survey, quiz, and performance evidence linked to the evaluation.</p>
                </div>
                <div className="rounded-xl border border-sky-200 bg-white p-3">
                  <div className="mb-1 font-bold text-[10px] uppercase tracking-wider text-sky-600">Colour bands</div>
                  <p>≥75 green · ≥55 amber · &lt;55 red. Scores are computed server-side from recorded evidence — no values are estimated here.</p>
                </div>
              </div>
            </div>
          )}

          {evalGroups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-10 text-center">
              <BarChart3 className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-2 text-[13px] font-medium text-muted-foreground">No evaluations yet</div>
              <div className="text-[11.5px] text-muted-foreground">Kirkpatrick evaluations recorded for this session will appear here.</div>
            </div>
          ) : (
            <div className="space-y-4">
              {evalGroups.map((s) => (
                <div key={s.userId} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                  <div className="flex items-center gap-3 p-4">
                    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-400 to-emerald-500 text-[12px] font-bold text-white">{s.initials}</div>
                    <div className="flex-1">
                      <div className="text-[14px] font-semibold">{s.name}</div>
                      <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                        {s.overall !== null && (
                          <span>Avg: <span className={cn('font-bold', s.overall >= 75 ? 'text-emerald-600' : s.overall >= 55 ? 'text-amber-600' : 'text-rose-600')}>{s.overall}</span></span>
                        )}
                        {scoresVisibleToStudents && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-bold text-teal-700">
                            <Eye className="size-2.5" /> Visible to student
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border/60 p-4">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Kirkpatrick Levels</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {s.levels.map((l) => (
                        <div key={l.label} className={cn('rounded-xl p-2.5', l.score >= 75 ? 'bg-emerald-50 border border-emerald-200' : l.score >= 55 ? 'bg-amber-50 border border-amber-200' : 'bg-rose-50 border border-rose-200')}>
                          <div className="text-[9.5px] font-semibold text-muted-foreground">{l.label}</div>
                          <div className={cn('mt-0.5 text-[18px] font-bold', l.score >= 75 ? 'text-emerald-600' : l.score >= 55 ? 'text-amber-600' : 'text-rose-600')}>{l.score}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ANALYTICS ────────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && canViewAnalytics && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-semibold">Full Session Analytics</h2>
              <p className="text-[12.5px] text-muted-foreground">Per-participant pre-conference readiness, attendance &amp; doubts raised</p>
            </div>
          </div>

          {data.analytics.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-10 text-center">
              <Trophy className="mx-auto size-8 text-muted-foreground" />
              <div className="mt-2 text-[13px] font-medium text-muted-foreground">No participant data yet</div>
              <div className="text-[11.5px] text-muted-foreground">Once learners join this session, their analytics appear here.</div>
            </div>
          ) : (
            <>
              {/* Table */}
              <div className="overflow-hidden rounded-2xl border border-border/60">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-border/60 bg-foreground/[0.025]">
                        <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Student</th>
                        {data.analytics.some((s) => s.cohort) && <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Cohort</th>}
                        <th className="px-4 py-3 text-right font-semibold text-teal-600">Readiness (pre)</th>
                        <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Attended</th>
                        <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Doubts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {data.analytics.map((s, i) => (
                        <tr key={s.userId} className={cn('transition-colors hover:bg-foreground/[0.02]', i % 2 === 0 ? '' : 'bg-foreground/[0.01]')}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-400 to-emerald-500 text-[10px] font-bold text-white">{s.initials}</div>
                              <span className="font-medium">{s.name}</span>
                            </div>
                          </td>
                          {data.analytics.some((x) => x.cohort) && <td className="px-4 py-3 text-muted-foreground">{s.cohort || '—'}</td>}
                          <td className="px-4 py-3 text-right">
                            <span className={cn('rounded-full px-2 py-0.5 font-mono text-[11.5px] font-bold',
                              s.readinessScore >= 75 ? 'bg-emerald-100 text-emerald-700' : s.readinessScore >= 55 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>
                              {s.readinessScore}%
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {s.attended ? <Check className="mx-auto size-4 text-emerald-500" /> : <X className="mx-auto size-4 text-rose-500" />}
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-muted-foreground">{s.doubts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top by readiness */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[...data.analytics].sort((a, b) => b.readinessScore - a.readinessScore).slice(0, 3).map((s, i) => (
                  <div key={s.userId} className={cn('rounded-2xl border p-4', i === 0 ? 'border-amber-200 bg-amber-50' : i === 1 ? 'border-slate-200 bg-slate-50' : 'border-orange-200 bg-orange-50')}>
                    <div className="flex items-center gap-2">
                      <div className={cn('grid size-7 place-items-center rounded-full text-[10px] font-bold', i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-400 text-white' : 'bg-orange-500 text-white')}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                      </div>
                      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-400 to-emerald-500 text-[10px] font-bold text-white">{s.initials}</div>
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold">{s.name}</div>
                        <div className="text-[10.5px] text-muted-foreground">{s.cohort || ''}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[22px] font-bold tabular-nums">{s.readinessScore}%</div>
                    <div className="text-[10.5px] text-muted-foreground">Pre-conference readiness</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── SHARE ────────────────────────────────────────────────────────── */}
      {activeTab === 'share' && (
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h2 className="text-[17px] font-semibold">Share Session</h2>
            <p className="text-[12.5px] text-muted-foreground">Share the recorded lecture and all materials with your next batch or colleagues</p>
          </div>

          {/* Share link */}
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="mb-3 text-[13px] font-semibold">Recording Share Link</div>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/60 bg-foreground/[0.025] px-3 py-2">
                <Link2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate font-mono text-[12px] text-muted-foreground">
                  {shareLink ?? (data.hasRecording ? 'Generate a secure share link →' : 'No recording to share yet')}
                </span>
              </div>
              <button type="button" onClick={copyLink} disabled={shareBusy || !data.hasRecording}
                className={cn('inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-40', linkCopied ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-white hover:bg-slate-600')}>
                {linkCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {linkCopied ? 'Copied!' : shareBusy ? 'Creating…' : shareLink ? 'Copy link' : 'Create link'}
              </button>
            </div>
            {shareError && <div className="mt-2 text-[11.5px] text-rose-600">{shareError}</div>}
            {data.shares.length > 0 && !shareLink && (
              <div className="mt-2 text-[11px] text-muted-foreground">{data.shares.length} active share link{data.shares.length === 1 ? '' : 's'} exist — create a fresh one to copy the URL.</div>
            )}
          </div>

          {/* What to include */}
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="mb-3 text-[13px] font-semibold">Include in share package</div>
            <div className="space-y-2">
              {[
                { label: 'Session recording + slides', desc: 'Main presentation with audio' },
                { label: 'Pre-read materials',          desc: 'PDFs and supplementary documents' },
                { label: 'Knowledge pearls',            desc: 'Key pearls, visual cards, mini cases' },
                { label: 'Quiz questions',              desc: 'Learner quiz with answer key' },
                { label: 'Session transcript',          desc: 'Full transcript including translations' },
              ].map((item, i) => (
                <label key={i} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 p-3 hover:bg-foreground/[0.02]">
                  <input type="checkbox" defaultChecked className="size-4 rounded accent-teal-500" />
                  <div>
                    <div className="text-[12.5px] font-medium">{item.label}</div>
                    <div className="text-[11px] text-muted-foreground">{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Share channels */}
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="mb-3 text-[13px] font-semibold">Share via</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'WhatsApp',   color: 'bg-emerald-500', icon: '💬' },
                { label: 'Email',      color: 'bg-blue-500',    icon: '✉️' },
                { label: 'Copy link',  color: 'bg-slate-600',   icon: '🔗' },
                { label: 'QR Code',    color: 'bg-violet-500',  icon: '📱' },
              ].map((c) => (
                <button key={c.label} type="button" className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-card py-4 text-[11.5px] font-medium text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-teal-400 hover:text-teal-600 hover:shadow-md">
                  <span className="text-2xl">{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
