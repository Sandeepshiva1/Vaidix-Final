'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Bell,
  BellOff,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  FileText,
  Flame,
  Globe,
  HelpCircle,
  Info,
  Layers,
  Link2,
  Medal,
  MessageCircle,
  Mic,
  PenLine,
  Play,
  Plus,
  Presentation,
  RefreshCw,
  Save,
  Send,
  Share2,
  Sparkles,
  Star,
  ThumbsUp,
  Trophy,
  Users2,
  Video,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SessionHeader } from '@/components/medlearn/session-header'
import type { SessionView } from '@/lib/medlearn/session-view'

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

interface Pearl {
  id: string
  type: 'key' | 'visual' | 'case'
  title: string
  body: string
  schedule: '24h' | '72h' | '7d'
  sent: boolean
  editing: boolean
}

interface Reel {
  id: string
  title: string
  duration: string
  topic: string
  type: 'concept' | 'soundbite'
  speaker?: string
  quote?: string
}

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
  voiceNote?: boolean
  videoUrl?: string
  peerReplies?: { author: string; initials: string; text: string }[]
  questionType?: 'doubt' | 'text-based' | 'open-ended'
}

interface SimCase {
  id: string
  title: string
  scenario: string
  score: number
  correct: number
  total: number
  students: { name: string; score: number; level: string }[]
}

interface StudentEval {
  name: string
  initials: string
  bloom: { remember: number; understand: number; apply: number; analyse: number; evaluate: number; create: number }
  kirkpatrick: { reaction: number; learning: number; behaviour: number; results: number }
  overall: number
  pathwayReady: boolean
}

interface StudentAnalytics {
  name: string
  initials: string
  cohort: string
  preScore: number
  liveScore: number
  postScore: number
  attendance: boolean
  doubts: number
  peerEngagement: number
}

// Materials shown on the Materials tab. SessionView does not carry the file
// lists the demo body reads, so they live in local state seeded with the
// demo default (the "Glaucoma Suspect" session).
interface MaterialFile {
  name: string
  size: string
  kind: string
}

const SOURCE_FILES_SEED: MaterialFile[] = [
  { name: 'EGS Guidelines 2022 — Glaucoma Management.pdf', size: '4.2 MB', kind: 'pdf' },
  { name: 'Glaucoma-suspect-cases.pptx', size: '9.3 MB', kind: 'pptx' },
]

const PREREAD_FILES_SEED: MaterialFile[] = [
  { name: 'OCT-RNFL interpretation primer.pdf', size: '1.1 MB', kind: 'pdf' },
]

const PEARLS_SEED: Pearl[] = [
  { id: 'p1', type: 'key', title: 'Pearl 1 — Optic Disc Haemorrhage', body: 'A single disc haemorrhage doubles the 5-year risk of glaucoma conversion in OHT patients. Treat more aggressively when present, even if IOP is borderline.', schedule: '24h', sent: true, editing: false },
  { id: 'p2', type: 'key', title: 'Pearl 2 — RNFL Asymmetry Rule', body: 'Inter-eye RNFL asymmetry >10µm in corresponding sectors is clinically significant — even before visual field changes appear on standard automated perimetry.', schedule: '72h', sent: false, editing: false },
  { id: 'p3', type: 'key', title: 'Pearl 3 — Target IOP Calculation', body: 'Set target IOP = baseline − (20–30% for moderate risk) or − (30–40% for high risk). Recalculate every 6 months based on structural/functional progression.', schedule: '7d', sent: false, editing: false },
  { id: 'p4', type: 'visual', title: 'Visual Card — ISNT Rule', body: 'In a normal optic disc, rim width follows: Inferior > Superior > Nasal > Temporal. Violation of this rule is a red flag for glaucomatous cupping.', schedule: '24h', sent: false, editing: false },
  { id: 'p5', type: 'visual', title: 'Visual Card — VF Progression Map', body: 'Hemifield defects respecting the horizontal meridian are characteristic of glaucoma. Compare mean deviation and pattern standard deviation across serial fields.', schedule: '72h', sent: false, editing: false },
  { id: 'p6', type: 'case', title: 'Mini Case — The 52-year-old Suspect', body: 'OHT patient, IOP 26 mmHg, normal VF, RNFL 78µm inferior. No disc haemorrhage. OHTS risk score: 12%. Decision: Monitor vs treat? Key factors — CCT, family history, and rate of structural change.', schedule: '7d', sent: false, editing: false },
]

const REELS_SEED: Reel[] = [
  { id: 'r1', title: 'ISNT Rule — 30-sec Explainer', duration: '0:30', topic: 'Optic disc anatomy', type: 'concept' },
  { id: 'r2', title: 'Target IOP — Why It Matters', duration: '0:28', topic: 'IOP management', type: 'concept' },
  { id: 'r3', title: 'Reading an RNFL Report', duration: '0:30', topic: 'OCT interpretation', type: 'concept' },
  { id: 'r4', title: '"The disc haemorrhage is a warning sign…"', duration: '0:18', topic: 'Key teaching moment', type: 'soundbite', speaker: 'Dr. Avinash Pathengay', quote: '"One disc haemorrhage — that\'s your signal. Don\'t wait for the field defect."' },
  { id: 'r5', title: '"OHTS taught us to treat based on risk…"', duration: '0:22', topic: 'Evidence-based practice', type: 'soundbite', speaker: 'Dr. Avinash Pathengay', quote: '"The OHTS data is clear — risk calculators should guide our decision, not just the IOP number."' },
]

const DOUBTS_SEED: Doubt[] = [
  { id: 'd1', author: 'Arjun Mehta', cohort: 'R3 · VR', text: 'In a suspect with normal VF but RNFL thinning on OCT, how often should we repeat imaging?', time: '2h ago', pinned: true, answered: false, endorsed: 5, questionType: 'doubt',
    peerReplies: [{ author: 'Rakesh Naidu', initials: 'RN', text: 'Most protocols suggest 6-monthly OCT for 2 years, then annually if stable. At least 2 consecutive worsening scans before calling progression.' }] },
  { id: 'd2', author: 'Pooja Iyer', cohort: 'R2 · Cornea', text: 'What is the threshold IOP to start treatment in a low-risk OHT patient?', time: '4h ago', pinned: false, answered: true, endorsed: 3, questionType: 'doubt',
    reply: 'Great question Pooja — most guidelines use ≥26 mmHg as a threshold, but we always factor in CCT, disc morphology, and family history. Low-risk patients with IOP 22-25 mmHg may be monitored every 6 months rather than treated.' },
  { id: 'd3', author: 'Sneha Rao', cohort: 'R2 · VR', text: 'Is selective laser trabeculoplasty first-line now or still after drops?', time: '6h ago', pinned: false, answered: false, endorsed: 7, questionType: 'doubt',
    peerReplies: [{ author: 'Vikram Joshi', initials: 'VJ', text: 'LiGHT trial showed SLT non-inferior to drops at 3 years with lower cost. Many guidelines now list it as a valid first-line option.' }] },
  { id: 'd4', author: 'Kiran Reddy', cohort: 'R1 · Cornea', text: 'How do we differentiate physiological cupping from early glaucomatous cupping?', time: '1d ago', pinned: false, answered: false, endorsed: 9, questionType: 'doubt',
    peerReplies: [{ author: 'Arjun Mehta', initials: 'AM', text: 'Key differentiators: ISNT rule violation, disc haemorrhage, RNFL defects on OCT, and VF correlation. Physiological cupping has a symmetric, round cup with intact rim.' }] },
  { id: 'q1', author: 'Dr. Avinash (Faculty)', cohort: 'Faculty', text: 'What is the most important OCT biomarker for predicting visual prognosis in DME?', time: 'Just now', pinned: false, answered: false, endorsed: 0, questionType: 'text-based' },
  { id: 'q2', author: 'Dr. Avinash (Faculty)', cohort: 'Faculty', text: 'Describe your approach to a patient with refractory DME after 6 anti-VEGF injections. What factors guide your next decision?', time: 'Just now', pinned: false, answered: false, endorsed: 0, questionType: 'open-ended' },
]

const SIM_CASES: SimCase[] = [
  {
    id: 's1',
    title: 'Case Simulation 1 — OHT Management Decision',
    scenario: 'A 55-year-old with IOP 27 mmHg OU, CCT 510µm, normal VFs, mild inferior RNFL thinning. OHTS score 18%. What is the most appropriate management?',
    score: 72,
    correct: 6,
    total: 8,
    students: [
      { name: 'Arjun Mehta', score: 90, level: 'Apply' },
      { name: 'Pooja Iyer', score: 75, level: 'Understand' },
      { name: 'Sneha Rao', score: 65, level: 'Remember' },
      { name: 'Kiran Reddy', score: 58, level: 'Remember' },
    ],
  },
  {
    id: 's2',
    title: 'Case Simulation 2 — Progressive Glaucoma',
    scenario: 'Follow-up at 2 years: on Latanoprost, IOP 18 mmHg. VF showing -2 dB/year progression. RNFL loss 4µm/year. Is the current management adequate?',
    score: 61,
    correct: 5,
    total: 8,
    students: [
      { name: 'Arjun Mehta', score: 85, level: 'Analyse' },
      { name: 'Pooja Iyer', score: 60, level: 'Understand' },
      { name: 'Sneha Rao', score: 55, level: 'Remember' },
      { name: 'Kiran Reddy', score: 45, level: 'Remember' },
    ],
  },
]

const STUDENT_EVALS: StudentEval[] = [
  {
    name: 'Arjun Mehta', initials: 'AM',
    bloom: { remember: 95, understand: 90, apply: 85, analyse: 80, evaluate: 70, create: 55 },
    kirkpatrick: { reaction: 90, learning: 85, behaviour: 75, results: 65 },
    overall: 84, pathwayReady: true,
  },
  {
    name: 'Pooja Iyer', initials: 'PI',
    bloom: { remember: 88, understand: 80, apply: 65, analyse: 55, evaluate: 40, create: 30 },
    kirkpatrick: { reaction: 85, learning: 72, behaviour: 55, results: 40 },
    overall: 65, pathwayReady: true,
  },
  {
    name: 'Sneha Rao', initials: 'SR',
    bloom: { remember: 70, understand: 62, apply: 50, analyse: 42, evaluate: 30, create: 20 },
    kirkpatrick: { reaction: 75, learning: 60, behaviour: 45, results: 35 },
    overall: 52, pathwayReady: true,
  },
  {
    name: 'Kiran Reddy', initials: 'KR',
    bloom: { remember: 65, understand: 55, apply: 40, analyse: 32, evaluate: 25, create: 15 },
    kirkpatrick: { reaction: 70, learning: 55, behaviour: 40, results: 28 },
    overall: 44, pathwayReady: false,
  },
]

const STUDENT_ANALYTICS: StudentAnalytics[] = [
  { name: 'Arjun Mehta',  initials: 'AM', cohort: 'R3 · VR',   preScore: 88, liveScore: 840, postScore: 91, attendance: true,  doubts: 2, peerEngagement: 1 },
  { name: 'Pooja Iyer',   initials: 'PI', cohort: 'R2 · Cor',  preScore: 74, liveScore: 720, postScore: 78, attendance: true,  doubts: 1, peerEngagement: 0 },
  { name: 'Rakesh Naidu', initials: 'RN', cohort: 'R3 · Glc',  preScore: 69, liveScore: 660, postScore: 72, attendance: true,  doubts: 0, peerEngagement: 1 },
  { name: 'Vikram Joshi', initials: 'VJ', cohort: 'R1 · Uvea', preScore: 55, liveScore: 550, postScore: 60, attendance: true,  doubts: 0, peerEngagement: 1 },
  { name: 'Sneha Rao',    initials: 'SR', cohort: 'R2 · VR',   preScore: 49, liveScore: 490, postScore: 55, attendance: true,  doubts: 1, peerEngagement: 0 },
  { name: 'Priya Sharma', initials: 'PS', cohort: 'Fellow',    preScore: 31, liveScore: 310, postScore: 38, attendance: false, doubts: 0, peerEngagement: 0 },
  { name: 'Kiran Reddy',  initials: 'KR', cohort: 'R1 · Cor',  preScore: 28, liveScore: 280, postScore: 34, attendance: true,  doubts: 1, peerEngagement: 0 },
  { name: 'Aisha Khan',   initials: 'AK', cohort: 'R2 · Glc',  preScore: 22, liveScore: 220, postScore: 29, attendance: false, doubts: 0, peerEngagement: 0 },
]

const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'] as const
const BLOOM_COLORS = ['bg-slate-400', 'bg-sky-400', 'bg-teal-400', 'bg-emerald-400', 'bg-amber-400', 'bg-rose-400']

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

export function PostClient({ session }: { session: SessionView }) {
  const [activeTab, setActiveTab] = useState<PostTab>('overview')
  const [pearls, setPearls] = useState<Pearl[]>(PEARLS_SEED)
  const [doubts, setDoubts] = useState<Doubt[]>(DOUBTS_SEED)
  // Demo session.sourceFiles / session.prereadFiles aren't on SessionView, so
  // they're local state seeded with the demo default.
  const [sourceFiles] = useState<MaterialFile[]>(SOURCE_FILES_SEED)
  const [prereadFiles] = useState<MaterialFile[]>(PREREAD_FILES_SEED)
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const [videoUrlDraft, setVideoUrlDraft] = useState<Record<string, string>>({})
  const [expandedDoubt, setExpandedDoubt] = useState<string | null>(null)
  const [expandedSim, setExpandedSim] = useState<string | null>('s1')
  const [shareLink] = useState('https://vaidix.app/s/gl-2026')
  const [linkCopied, setLinkCopied] = useState(false)
  const [pearlEditDraft, setPearlEditDraft] = useState<Record<string, string>>({})
  const [regeneratingPearl, setRegeneratingPearl] = useState<Record<string, boolean>>({})
  const [regeneratingReel, setRegeneratingReel] = useState<Record<string, boolean>>({})
  const [analyticsPhase, setAnalyticsPhase] = useState<'pre' | 'live' | 'post' | 'combined'>('combined')
  const [showEvalInfo, setShowEvalInfo] = useState(false)
  const [evalSharedWithMod, setEvalSharedWithMod] = useState(false)
  const [scoresVisibleToStudents, setScoresVisibleToStudents] = useState(false)
  const [showAddQuestion, setShowAddQuestion] = useState(false)
  const [newQuestionType, setNewQuestionType] = useState<'text-based' | 'open-ended'>('text-based')
  const [newQuestionText, setNewQuestionText] = useState('')
  const doubtsOpen = true
  const daysLeft = 5
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [doubts])

  const sendPearl = (pid: string) => {
    setPearls((prev) => prev.map((p) => p.id === pid ? { ...p, sent: true } : p))
  }

  const deletePearl = (pid: string) => {
    setPearls((prev) => prev.filter((p) => p.id !== pid))
  }

  const regeneratePearl = (pid: string) => {
    setRegeneratingPearl((r) => ({ ...r, [pid]: true }))
    setTimeout(() => setRegeneratingPearl((r) => ({ ...r, [pid]: false })), 2000)
  }

  const regenerateReel = (rid: string) => {
    setRegeneratingReel((r) => ({ ...r, [rid]: true }))
    setTimeout(() => setRegeneratingReel((r) => ({ ...r, [rid]: false })), 2000)
  }

  const startEdit = (pid: string, body: string) => {
    setPearlEditDraft((d) => ({ ...d, [pid]: body }))
    setPearls((prev) => prev.map((p) => p.id === pid ? { ...p, editing: true } : p))
  }

  const saveEdit = (pid: string) => {
    setPearls((prev) => prev.map((p) => p.id === pid ? { ...p, body: pearlEditDraft[pid] ?? p.body, editing: false } : p))
  }

  const cancelEdit = (pid: string) => {
    setPearls((prev) => prev.map((p) => p.id === pid ? { ...p, editing: false } : p))
  }

  const sendReply = (did: string) => {
    const text = (replyDraft[did] ?? '').trim()
    if (!text) return
    const videoUrl = (videoUrlDraft[did] ?? '').trim()
    setDoubts((prev) => prev.map((d) => d.id === did ? { ...d, reply: text, answered: true, videoUrl: videoUrl || d.videoUrl } : d))
    setReplyDraft((r) => ({ ...r, [did]: '' }))
    setVideoUrlDraft((r) => ({ ...r, [did]: '' }))
  }

  const addVoiceNote = (did: string) => {
    setDoubts((prev) => prev.map((d) => d.id === did ? { ...d, voiceNote: true } : d))
  }

  const addQuestion = () => {
    const text = newQuestionText.trim()
    if (!text) return
    const newQ: Doubt = {
      id: `q${Date.now()}`, author: 'Dr. Avinash (Faculty)', cohort: 'Faculty',
      text, time: 'Just now', pinned: false, answered: false, endorsed: 0, questionType: newQuestionType,
    }
    setDoubts((prev) => [...prev, newQ])
    setNewQuestionText('')
    setShowAddQuestion(false)
  }

  const copyLink = () => {
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const pearlsBySchedule = (sched: '24h' | '72h' | '7d') => pearls.filter((p) => p.schedule === sched)

  const scheduleLabel: Record<string, string> = { '24h': '24 Hours After', '72h': '72 Hours After', '7d': '7 Days After' }

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header */}
      <SessionHeader
        session={session}
        backHref={`/session/${session.id}/prepare`}
        eyebrow="Post-Conference"
      />
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/10 px-2.5 py-0.5 text-[10.5px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-500/20">
              <Check className="size-3" /> Post-Conference Active
            </span>
            {doubtsOpen && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/20">
                <Bell className="size-3" /> Doubts open · {daysLeft} days left
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex items-center gap-0.5 overflow-x-auto rounded-2xl border border-border/60 bg-card p-1 scrollbar-hide">
        {TABS.map((t) => (
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
              { label: 'Learners',         value: '58',  sub: 'attended live',       color: 'from-teal-500/15 to-emerald-500/10',  icon: <Users2 className="size-4 text-teal-600" /> },
              { label: 'Avg Engagement',   value: '74%', sub: 'during session',       color: 'from-sky-500/15 to-blue-500/10',       icon: <BarChart3 className="size-4 text-sky-600" /> },
              { label: 'Quiz Top Score',   value: '840', sub: 'Arjun Mehta',          color: 'from-amber-500/15 to-orange-500/10',   icon: <Trophy className="size-4 text-amber-600" /> },
              { label: 'Doubts Raised',    value: '12',  sub: `${daysLeft} days left`, color: 'from-violet-500/15 to-purple-500/10',  icon: <MessageCircle className="size-4 text-violet-600" /> },
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
              { tab: 'pearls' as PostTab,      icon: <Zap className="size-5 text-amber-600" />,        title: 'Knowledge Pearls',        desc: 'AI-generated key pearls, visual cards, and mini cases ready to send', color: 'bg-amber-50 border-amber-200' },
              { tab: 'reels' as PostTab,        icon: <Play className="size-5 text-rose-600" />,        title: 'Content Reels',           desc: '3 concept reels + 2 speaker soundbites generated from session', color: 'bg-rose-50 border-rose-200' },
              { tab: 'doubts' as PostTab,       icon: <MessageCircle className="size-5 text-sky-600" />, title: 'Doubts (Open)',           desc: `4 new questions · ${daysLeft} days remaining`, color: 'bg-sky-50 border-sky-200' },
              { tab: 'simulations' as PostTab,  icon: <Brain className="size-5 text-violet-600" />,     title: 'AI Simulations',          desc: '2 case simulations evaluated · avg score 67%', color: 'bg-violet-50 border-violet-200' },
              { tab: 'evaluation' as PostTab,   icon: <BarChart3 className="size-5 text-teal-600" />,   title: 'Evaluation Report',       desc: "Bloom's + Kirkpatrick scoring for all 8 students", color: 'bg-teal-50 border-teal-200' },
              { tab: 'analytics' as PostTab,    icon: <Trophy className="size-5 text-emerald-600" />,   title: 'Full Analytics',          desc: 'Pre · Live · Post combined with individual student data', color: 'bg-emerald-50 border-emerald-200' },
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
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-semibold">Knowledge Pearls</h2>
              <p className="text-[12.5px] text-muted-foreground">AI-generated · edit and schedule for delivery via WhatsApp · 24h · 72h · 7 days</p>
            </div>
          </div>

          {(['24h', '72h', '7d'] as const).map((sched) => (
            <div key={sched}>
              <div className="mb-3 flex items-center gap-2">
                <div className="grid size-6 place-items-center rounded-full bg-teal-500/15 text-teal-700"><Clock3 className="size-3" /></div>
                <span className="text-[13px] font-semibold">{scheduleLabel[sched]}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{pearlsBySchedule(sched).filter((p) => p.sent).length}/{pearlsBySchedule(sched).length} sent</span>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {pearlsBySchedule(sched).map((pearl) => (
                  <div
                    key={pearl.id}
                    className={cn(
                      'overflow-hidden rounded-2xl border',
                      pearl.type === 'key'    ? 'border-teal-200 bg-teal-50'   :
                      pearl.type === 'visual' ? 'border-sky-200 bg-sky-50'     :
                                               'border-amber-200 bg-amber-50'
                    )}
                  >
                    <div className="flex items-center justify-between px-4 pt-3 pb-2">
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                          pearl.type === 'key'    ? 'bg-teal-200 text-teal-800'   :
                          pearl.type === 'visual' ? 'bg-sky-200 text-sky-800'     :
                                                   'bg-amber-200 text-amber-800'
                        )}>
                          {pearl.type === 'key' ? 'Key Pearl' : pearl.type === 'visual' ? 'Visual Card' : 'Mini Case'}
                        </span>
                        <span className="text-[12.5px] font-semibold">{pearl.title}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {!pearl.editing && (
                          <>
                            <button type="button" title="Edit" onClick={() => startEdit(pearl.id, pearl.body)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/60 hover:text-foreground">
                              <Edit2 className="size-3.5" />
                            </button>
                            <button type="button" title="Regenerate" onClick={() => regeneratePearl(pearl.id)} disabled={regeneratingPearl[pearl.id]}
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/60 hover:text-indigo-600 disabled:opacity-40">
                              <RefreshCw className={cn('size-3.5', regeneratingPearl[pearl.id] && 'animate-spin')} />
                            </button>
                            <button type="button" title="Delete" onClick={() => deletePearl(pearl.id)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/60 hover:text-rose-500">
                              <X className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="px-4 pb-3">
                      {pearl.editing ? (
                        <div className="space-y-2">
                          <textarea
                            value={pearlEditDraft[pearl.id] ?? pearl.body}
                            onChange={(e) => setPearlEditDraft((d) => ({ ...d, [pearl.id]: e.target.value }))}
                            rows={3}
                            className="w-full rounded-xl border border-teal-300 bg-white px-3 py-2 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-teal-400"
                          />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => saveEdit(pearl.id)} className="flex items-center gap-1.5 rounded-full bg-teal-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-400">
                              <Save className="size-3" /> Save
                            </button>
                            <button type="button" onClick={() => cancelEdit(pearl.id)} className="rounded-full border border-gray-300 px-3 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[12.5px] leading-relaxed text-gray-700">{pearl.body}</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between border-t border-white/60 bg-white/40 px-4 py-2">
                      {pearl.sent ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600">
                          <Check className="size-3" /> Sent via WhatsApp
                        </span>
                      ) : (
                        <button type="button" onClick={() => sendPearl(pearl.id)} className="inline-flex items-center gap-1.5 rounded-full bg-teal-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-400">
                          <Send className="size-3" /> Send Now
                        </button>
                      )}
                      <span className="text-[10.5px] text-muted-foreground">Schedule: {scheduleLabel[pearl.schedule]}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── REELS ────────────────────────────────────────────────────────── */}
      {activeTab === 'reels' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-[17px] font-semibold">Content Reels</h2>
            <p className="text-[12.5px] text-muted-foreground">AI-generated 30-second concept reels and speaker soundbites from the session</p>
          </div>

          <div>
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">30-Second Concept Reels</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {REELS_SEED.filter((r) => r.type === 'concept').map((r) => (
                <div key={r.id} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                  <div className="flex h-28 items-center justify-center bg-linear-to-br from-slate-800 to-slate-900">
                    <div className="grid size-12 place-items-center rounded-full bg-white/10 ring-2 ring-white/20">
                      <Play className="size-5 text-white" />
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-[12.5px] font-semibold leading-snug">{r.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{r.topic}</span>
                      <span>·</span>
                      <span className="font-mono">{r.duration}</span>
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <button type="button" className="flex flex-1 items-center justify-center gap-1 rounded-full border border-border/60 py-1.5 text-[10.5px] text-muted-foreground hover:bg-foreground/5">
                        <Eye className="size-3" /> Preview
                      </button>
                      <button type="button" onClick={() => regenerateReel(r.id)} disabled={regeneratingReel[r.id]}
                        className="flex items-center justify-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[10.5px] text-indigo-600 hover:bg-indigo-100 disabled:opacity-40">
                        <RefreshCw className={cn('size-3', regeneratingReel[r.id] && 'animate-spin')} />
                        {regeneratingReel[r.id] ? 'Generating…' : 'Regenerate'}
                      </button>
                      <button type="button" onClick={() => downloadBlob(`Reel: ${r.title}\nTopic: ${r.topic}\nDuration: ${r.duration}`, `${r.id}.txt`)}
                        className="flex items-center justify-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[10.5px] text-teal-600 hover:bg-teal-100">
                        <Download className="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Speaker Soundbites</div>
            <div className="space-y-3">
              {REELS_SEED.filter((r) => r.type === 'soundbite').map((r) => (
                <div key={r.id} className="flex items-start gap-4 overflow-hidden rounded-2xl border border-border/60 bg-card p-4">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-500 to-emerald-600">
                    <Mic className="size-4 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold">{r.title}</div>
                    <div className="text-[11px] text-muted-foreground">{r.speaker} · {r.duration}</div>
                    {r.quote && (
                      <blockquote className="mt-2 border-l-2 border-teal-400 pl-3 text-[12px] italic text-gray-600">{r.quote}</blockquote>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button type="button" onClick={() => regenerateReel(r.id)} disabled={regeneratingReel[r.id]}
                      className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[10.5px] text-indigo-600 hover:bg-indigo-100 disabled:opacity-40">
                      <RefreshCw className={cn('size-3', regeneratingReel[r.id] && 'animate-spin')} />
                      {regeneratingReel[r.id] ? 'Generating…' : 'Regenerate'}
                    </button>
                    <button type="button" onClick={() => downloadBlob(`Soundbite: ${r.title}\nSpeaker: ${r.speaker ?? ''}\n\n${r.quote ?? ''}`, `${r.id}.txt`)}
                      className="flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[10.5px] text-teal-600 hover:bg-teal-100">
                      <Download className="size-3" /> Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-teal-300 py-3 text-[12px] text-teal-600 hover:border-teal-400 hover:bg-teal-50/50">
              <RefreshCw className="size-3.5" /> Generate more reels from session
            </button>
          </div>
        </div>
      )}

      {/* ── DOUBTS ───────────────────────────────────────────────────────── */}
      {activeTab === 'doubts' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-semibold">Learner Doubts &amp; Questions</h2>
              <p className="text-[12.5px] text-muted-foreground">Open for {daysLeft} more days · Peer answers count as engagement</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {doubtsOpen && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-50 px-3 py-1.5 text-[11.5px] font-semibold text-amber-700">
                  <Bell className="size-3.5" /> {daysLeft} days left
                </span>
              )}
              <button type="button" onClick={() => setShowAddQuestion((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full bg-teal-500 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-teal-400">
                <Plus className="size-3.5" /> Add Question
              </button>
            </div>
          </div>

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
                              <span className="rounded-full bg-indigo-200 px-1.5 py-0.5 text-[8px] font-bold text-indigo-700">Peer reply · Engagement +1</span>
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
                      {d.voiceNote && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-teal-300 bg-white px-3 py-1.5">
                          <Mic className="size-3.5 text-teal-500" />
                          <span className="text-[10.5px] text-teal-700 font-medium">Voice note attached · 0:42</span>
                        </div>
                      )}
                      {d.videoUrl && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-teal-300 bg-white px-3 py-1.5">
                          <Video className="size-3.5 text-teal-500" />
                          <span className="flex-1 truncate text-[10.5px] text-teal-700 font-mono">{d.videoUrl}</span>
                          <ExternalLink className="size-3 text-teal-400" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => setDoubts((prev) => prev.map((x) => x.id === d.id ? { ...x, endorsed: x.endorsed + 1 } : x))}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-[10.5px] text-muted-foreground hover:border-teal-300 hover:text-teal-600">
                      <ThumbsUp className="size-3" /> Endorse ({d.endorsed})
                    </button>
                    <button type="button" onClick={() => setDoubts((prev) => prev.map((x) => x.id === d.id ? { ...x, pinned: !x.pinned } : x))}
                      className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px]', d.pinned ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-border/60 text-muted-foreground hover:border-amber-300 hover:text-amber-600')}>
                      📌 {d.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button type="button" onClick={() => setExpandedDoubt(expandedDoubt === d.id ? null : d.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[10.5px] text-teal-600 hover:bg-teal-100">
                      <MessageCircle className="size-3" /> {d.answered ? 'Update answer' : 'Answer'}
                    </button>
                    <button type="button" onClick={() => setDoubts((prev) => prev.filter((x) => x.id !== d.id))}
                      className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-[10.5px] text-muted-foreground hover:border-rose-300 hover:text-rose-500">
                      <X className="size-3" /> Dismiss
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
                      {/* Video link */}
                      <input
                        value={videoUrlDraft[d.id] ?? ''}
                        onChange={(e) => setVideoUrlDraft((r) => ({ ...r, [d.id]: e.target.value }))}
                        placeholder="Paste video link (optional)…"
                        className="w-full rounded-xl border border-teal-200 bg-white px-4 py-2 text-[11.5px] text-muted-foreground outline-none focus:ring-2 focus:ring-teal-300"
                      />
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => addVoiceNote(d.id)}
                          className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10.5px] font-medium transition-colors', d.voiceNote ? 'border-teal-400 bg-teal-100 text-teal-700' : 'border-border/60 text-muted-foreground hover:border-teal-300 hover:text-teal-600')}>
                          <Mic className="size-3" /> {d.voiceNote ? 'Voice note added' : 'Add voice note'}
                        </button>
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

          <div className="space-y-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Presentation</div>
            {sourceFiles.map((f) => (
              <div key={f.name} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4">
                <div className={cn('grid size-9 shrink-0 place-items-center rounded-xl text-white', f.kind === 'pdf' ? 'bg-rose-500' : f.kind === 'pptx' ? 'bg-orange-500' : 'bg-blue-500')}>
                  <FileText className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{f.name}</div>
                  <div className="text-[11px] text-muted-foreground">{f.size} · {f.kind.toUpperCase()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1.5 text-[10.5px] text-muted-foreground hover:bg-foreground/5">
                    <Eye className="size-3" /> View
                  </button>
                  <button type="button" onClick={() => downloadBlob(`File: ${f.name}`, f.name)} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[10.5px] text-teal-600 hover:bg-teal-100">
                    <Download className="size-3" /> Download
                  </button>
                </div>
              </div>
            ))}

            {prereadFiles.length > 0 && (
              <>
                <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pre-Read Materials</div>
                {prereadFiles.map((f) => (
                  <div key={f.name} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4">
                    <div className={cn('grid size-9 shrink-0 place-items-center rounded-xl text-white', f.kind === 'pdf' ? 'bg-rose-500' : f.kind === 'video' ? 'bg-violet-500' : 'bg-blue-500')}>
                      <FileText className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{f.name}</div>
                      <div className="text-[11px] text-muted-foreground">{f.size} · {f.kind.toUpperCase()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" className="inline-flex items-center gap-1 rounded-full border border-border/60 px-3 py-1.5 text-[10.5px] text-muted-foreground hover:bg-foreground/5">
                        <Eye className="size-3" /> View
                      </button>
                      <button type="button" onClick={() => downloadBlob(`File: ${f.name}`, f.name)} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[10.5px] text-teal-600 hover:bg-teal-100">
                        <Download className="size-3" /> Download
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── SIMULATIONS ──────────────────────────────────────────────────── */}
      {activeTab === 'simulations' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-[17px] font-semibold">AI-Evaluated Simulations</h2>
            <p className="text-[12.5px] text-muted-foreground">Case simulations launched during the session — AI has graded and classified each response by Bloom's level</p>
          </div>

          {SIM_CASES.map((sc) => (
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
                    <span>Avg score: <span className="font-semibold text-foreground">{sc.score}%</span></span>
                    <span>{sc.correct}/{sc.total} correct on avg</span>
                    <span>{sc.students.length} students</span>
                  </div>
                </div>
                {expandedSim === sc.id ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
              </button>

              {expandedSim === sc.id && (
                <div className="border-t border-border/60 p-4">
                  <div className="mb-3 rounded-xl border border-border/60 bg-foreground/[0.02] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Scenario</div>
                    <p className="text-[12.5px] text-foreground">{sc.scenario}</p>
                  </div>
                  <div className="space-y-2">
                    {sc.students.map((s) => (
                      <div key={s.name} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
                        <div className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-400 to-emerald-500 text-[10px] font-bold text-white">
                          {s.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                        </div>
                        <div className="flex-1 text-[12px] font-medium">{s.name}</div>
                        <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-bold',
                          s.level === 'Analyse' || s.level === 'Apply' ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600'
                        )}>{s.level}</span>
                        <div className="w-24">
                          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/5">
                            <div className={cn('h-full rounded-full', s.score >= 80 ? 'bg-emerald-500' : s.score >= 60 ? 'bg-amber-400' : 'bg-rose-500')} style={{ width: `${s.score}%` }} />
                          </div>
                        </div>
                        <span className="font-mono text-[11.5px] font-semibold tabular-nums">{s.score}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          <button type="button" className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-violet-300 py-3 text-[12px] text-violet-600 hover:border-violet-400 hover:bg-violet-50/50">
            <Plus className="size-3.5" /> Add new simulation case
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
              <p className="text-[12.5px] text-muted-foreground">Bloom&apos;s Taxonomy · Kirkpatrick Levels 1–4 · AI-generated personalised revision pathways</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" onClick={() => setScoresVisibleToStudents((v) => !v)}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                  scoresVisibleToStudents ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-border/60 text-muted-foreground hover:border-teal-300 hover:text-teal-600')}>
                <Eye className="size-3.5" />
                {scoresVisibleToStudents ? 'Scores visible to students' : 'Scores hidden from students'}
              </button>
              <button type="button" onClick={() => setEvalSharedWithMod((v) => !v)}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                  evalSharedWithMod ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-border/60 text-muted-foreground hover:border-indigo-300 hover:text-indigo-600')}>
                <Share2 className="size-3.5" />
                {evalSharedWithMod ? 'Shared with Moderator' : 'Share with Moderator'}
              </button>
              <button type="button" onClick={() => downloadBlob(
                  STUDENT_EVALS.map((s) => `${s.name}\nOverall: ${s.overall}%\nBloom's: ${Object.entries(s.bloom).map(([k,v])=>`${k}:${v}`).join(', ')}\nKirkpatrick: ${Object.entries(s.kirkpatrick).map(([k,v])=>`${k}:${v}`).join(', ')}`).join('\n\n'),
                  'evaluation-report.pdf'
                )}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-teal-300 hover:text-teal-600">
                <Download className="size-3.5" /> Download PDF
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
              <div className="grid grid-cols-1 gap-3 text-[11.5px] text-sky-900 sm:grid-cols-3">
                <div className="rounded-xl border border-sky-200 bg-white p-3">
                  <div className="mb-1 font-bold text-[10px] uppercase tracking-wider text-sky-600">Bloom&apos;s Taxonomy (50%)</div>
                  <p>Average of 6 cognitive levels — Remember, Understand, Apply, Analyse, Evaluate, Create. Each measured by quiz accuracy and response classification.</p>
                </div>
                <div className="rounded-xl border border-sky-200 bg-white p-3">
                  <div className="mb-1 font-bold text-[10px] uppercase tracking-wider text-sky-600">Kirkpatrick Framework (50%)</div>
                  <p>L1 Reaction (20%) · L2 Learning (30%) · L3 Behaviour (30%) · L4 Results (20%). Weighted average across post-session survey + performance data.</p>
                </div>
                <div className="rounded-xl border border-sky-200 bg-white p-3">
                  <div className="mb-1 font-bold text-[10px] uppercase tracking-wider text-sky-600">Overall Score</div>
                  <p>(Bloom's average × 0.5) + (Kirkpatrick weighted average × 0.5). Rounded to nearest integer. Colour bands: ≥75 green · ≥55 amber · &lt;55 red.</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {STUDENT_EVALS.map((s) => {
              const bloomEntries = Object.entries(s.bloom) as [string, number][]
              const kirkEntries = Object.entries(s.kirkpatrick) as [string, number][]
              return (
                <div key={s.name} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                  <div className="flex items-center gap-3 p-4">
                    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-400 to-emerald-500 text-[12px] font-bold text-white">{s.initials}</div>
                    <div className="flex-1">
                      <div className="text-[14px] font-semibold">{s.name}</div>
                      <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                        <span>Overall: <span className={cn('font-bold', s.overall >= 75 ? 'text-emerald-600' : s.overall >= 55 ? 'text-amber-600' : 'text-rose-600')}>{s.overall}%</span></span>
                        {scoresVisibleToStudents && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-bold text-teal-700">
                            <Eye className="size-2.5" /> Visible to student
                          </span>
                        )}
                        {s.pathwayReady && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-bold text-teal-700">
                            <Sparkles className="size-2.5" /> Pathway generated
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 border-t border-border/60 p-4 lg:grid-cols-2">
                    {/* Bloom's */}
                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bloom&apos;s Taxonomy</div>
                      <div className="space-y-1">
                        {bloomEntries.map(([level, val], i) => (
                          <div key={level} className="flex items-center gap-2">
                            <span className="w-16 text-[10px] capitalize text-muted-foreground">{level}</span>
                            <div className="flex-1 overflow-hidden rounded-full bg-foreground/5 h-1.5">
                              <div className={cn('h-full rounded-full', BLOOM_COLORS[i])} style={{ width: `${val}%` }} />
                            </div>
                            <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Kirkpatrick */}
                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Kirkpatrick Levels</div>
                      <div className="grid grid-cols-2 gap-2">
                        {kirkEntries.map(([level, val]) => (
                          <div key={level} className={cn('rounded-xl p-2.5', val >= 75 ? 'bg-emerald-50 border border-emerald-200' : val >= 55 ? 'bg-amber-50 border border-amber-200' : 'bg-rose-50 border border-rose-200')}>
                            <div className="text-[9.5px] font-semibold capitalize text-muted-foreground">L{['reaction','learning','behaviour','results'].indexOf(level)+1} · {level}</div>
                            <div className={cn('mt-0.5 text-[18px] font-bold', val >= 75 ? 'text-emerald-600' : val >= 55 ? 'text-amber-600' : 'text-rose-600')}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {s.pathwayReady && (
                    <div className="border-t border-border/60 bg-teal-50/50 px-4 py-3">
                      <div className="flex items-center gap-2 text-[11.5px] text-teal-700">
                        <Sparkles className="size-3.5" />
                        <span className="font-semibold">Personalised revision pathway generated</span>
                        <span className="text-teal-500">— visible to student in their post-class dashboard</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── ANALYTICS ────────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[17px] font-semibold">Full Session Analytics</h2>
              <p className="text-[12.5px] text-muted-foreground">Pre-conference · Live · Post-conference · Combined — all students by name</p>
            </div>
          </div>

          {/* Phase tabs */}
          <div className="flex items-center gap-1 rounded-2xl border border-border/60 bg-card p-1 w-fit">
            {(['combined', 'pre', 'live', 'post'] as const).map((p) => (
              <button key={p} type="button" onClick={() => setAnalyticsPhase(p)}
                className={cn('rounded-xl px-4 py-1.5 text-[12px] font-medium capitalize transition-all', analyticsPhase === p ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-foreground/5')}>
                {p === 'combined' ? 'Combined' : p === 'pre' ? 'Pre-Conference' : p === 'live' ? 'Live Session' : 'Post-Conference'}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-2xl border border-border/60">
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border/60 bg-foreground/[0.025]">
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Student</th>
                    <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Cohort</th>
                    {(analyticsPhase === 'combined' || analyticsPhase === 'pre')   && <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Pre</th>}
                    {(analyticsPhase === 'combined' || analyticsPhase === 'live')  && <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Live</th>}
                    {(analyticsPhase === 'combined' || analyticsPhase === 'post')  && <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Post</th>}
                    {analyticsPhase === 'combined' && <th className="px-4 py-3 text-right font-semibold text-teal-600">Aggregate</th>}
                    <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Attended</th>
                    <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Doubts</th>
                    <th className="px-4 py-3 text-center font-semibold text-indigo-600">Peer Eng.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {STUDENT_ANALYTICS.map((s, i) => {
                    const liveNorm = Math.round(s.liveScore / 840 * 100)
                    const agg = Math.round((s.preScore + liveNorm + s.postScore) / 3)
                    return (
                      <tr key={s.name} className={cn('transition-colors hover:bg-foreground/[0.02]', i % 2 === 0 ? '' : 'bg-foreground/[0.01]')}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-400 to-emerald-500 text-[10px] font-bold text-white">{s.initials}</div>
                            <span className="font-medium">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{s.cohort}</td>
                        {(analyticsPhase === 'combined' || analyticsPhase === 'pre')  && <td className="px-4 py-3 text-right font-mono font-semibold">{s.preScore}%</td>}
                        {(analyticsPhase === 'combined' || analyticsPhase === 'live') && <td className="px-4 py-3 text-right font-mono font-semibold">{liveNorm}%</td>}
                        {(analyticsPhase === 'combined' || analyticsPhase === 'post') && <td className="px-4 py-3 text-right font-mono font-semibold">{s.postScore}%</td>}
                        {analyticsPhase === 'combined' && (
                          <td className="px-4 py-3 text-right">
                            <span className={cn('rounded-full px-2 py-0.5 font-mono text-[11.5px] font-bold',
                              agg >= 75 ? 'bg-emerald-100 text-emerald-700' : agg >= 55 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>
                              {agg}%
                            </span>
                          </td>
                        )}
                        <td className="px-4 py-3 text-center">
                          {s.attendance ? <Check className="mx-auto size-4 text-emerald-500" /> : <X className="mx-auto size-4 text-rose-500" />}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-muted-foreground">{s.doubts}</td>
                        <td className="px-4 py-3 text-center">
                          {s.peerEngagement > 0
                            ? <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[9.5px] font-bold text-indigo-700">{s.peerEngagement} reply</span>
                            : <span className="text-[11px] text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top performers */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STUDENT_ANALYTICS.slice(0, 3).map((s, i) => (
              <div key={s.name} className={cn('rounded-2xl border p-4', i === 0 ? 'border-amber-200 bg-amber-50' : i === 1 ? 'border-slate-200 bg-slate-50' : 'border-orange-200 bg-orange-50')}>
                <div className="flex items-center gap-2">
                  <div className={cn('grid size-7 place-items-center rounded-full text-[10px] font-bold', i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-400 text-white' : 'bg-orange-500 text-white')}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                  </div>
                  <div className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-400 to-emerald-500 text-[10px] font-bold text-white">{s.initials}</div>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold">{s.name}</div>
                    <div className="text-[10.5px] text-muted-foreground">{s.cohort}</div>
                  </div>
                </div>
                <div className="mt-2 text-[22px] font-bold tabular-nums">{s.liveScore}</div>
                <div className="text-[10.5px] text-muted-foreground">Live session score</div>
              </div>
            ))}
          </div>
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
            <div className="mb-3 text-[13px] font-semibold">Session Link</div>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/60 bg-foreground/[0.025] px-3 py-2">
                <Link2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate font-mono text-[12px] text-muted-foreground">{shareLink}</span>
              </div>
              <button type="button" onClick={copyLink} className={cn('inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-semibold transition-colors', linkCopied ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-white hover:bg-slate-600')}>
                {linkCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {linkCopied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
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
