'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  BellOff,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Edit2,
  Eraser,
  Globe,
  HelpCircle,
  Languages,
  Layers,
  Lightbulb,
  Medal,
  Mic,
  MicOff,
  Minus,
  Monitor,
  Palette,
  Pencil,
  Plus,
  Save,
  Settings,
  SmilePlus,
  Sparkles,
  Square,
  Trash2,
  Trophy,
  Users2,
  Video,
  VideoOff,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionView } from '@/lib/medlearn/session-view'

type ViewMode = 'gallery' | 'presentation'
type RightTab = 'hooks' | 'transcript' | 'ai' | 'breakout'
type LbCategory = 'score' | 'consistent' | 'accurate' | 'engaged' | 'time'
type TxLang = 'all' | 'en' | 'te' | 'hi' | 'ta' | 'kn' | 'ml' | 'mixed'
interface TranscriptEntry { t: string; who: string; text: string; lang: 'en' | 'te' | 'hi' | 'ta' | 'kn' | 'ml' | 'mixed' }
interface HookItem { id: string; kind: 'poll' | 'tf' | 'flash' | 'mcq'; label: string; approved: null | boolean }
interface BreakoutRoom { id: string; name: string; members: string[]; task: string; timer: string }

const SLIDES = [
  { id: 1, title: 'Diabetic Retinopathy: Staging & Management', sub: 'Overview — ETDRS classification system', color: 'from-slate-800 to-slate-900' },
  { id: 2, title: 'OCT Macula — Interpretation', sub: 'Cystoid spaces · Hyperreflective foci · DRIL', color: 'from-teal-900/60 to-slate-900' },
  { id: 3, title: 'DME: Centre-involving vs. Non-centre', sub: 'ETDRS thickness thresholds · Visual acuity correlation', color: 'from-slate-900 to-emerald-900/60' },
  { id: 4, title: 'Treatment Algorithm — Centre-involving DME', sub: 'Anti-VEGF · Steroid implants · Laser adjuncts', color: 'from-slate-800 to-blue-900/60' },
  { id: 5, title: 'SCORE-2 Trial Data', sub: 'Bevacizumab vs. Ranibizumab — non-inferiority results', color: 'from-slate-900 to-violet-900/60' },
  { id: 6, title: 'When to refer for vitreoretinal surgery?', sub: 'Tractional RD · NVE/NVD · VH management', color: 'from-slate-900 to-rose-900/60' },
]

const PANELISTS = [
  { id: 'p1', name: 'Dr. Avinash Pathengay', initials: 'AP', role: 'Presenter', color: 'from-teal-100 to-emerald-200',   textColor: 'text-teal-700',   mic: true,  cam: true  },
  { id: 'p2', name: 'Dr. Ramesh Murthy',    initials: 'RM', role: 'Moderator', color: 'from-slate-100 to-gray-200',     textColor: 'text-slate-600',  mic: true,  cam: false },
  { id: 'p3', name: 'Dr. Kavitha Anand',    initials: 'KA', role: 'Panelist',  color: 'from-sky-100 to-blue-200',       textColor: 'text-sky-700',    mic: false, cam: false },
]

const AUDIENCE = [
  { id: 'a1', name: 'Arjun Mehta',   initials: 'AM', cohort: 'R3 · VR',  color: 'from-indigo-100 to-indigo-200',  textColor: 'text-indigo-700',  hand: true,  score: 840, reaction: '👋' },
  { id: 'a2', name: 'Pooja Iyer',    initials: 'PI', cohort: 'R2 · Cor', color: 'from-violet-100 to-purple-200',  textColor: 'text-violet-700',  hand: false, score: 720, reaction: null },
  { id: 'a3', name: 'Rakesh Naidu',  initials: 'RN', cohort: 'R3 · Glc', color: 'from-sky-100 to-blue-200',       textColor: 'text-sky-700',     hand: false, score: 660, reaction: '🤔' },
  { id: 'a4', name: 'Vikram Joshi',  initials: 'VJ', cohort: 'R1 · Uvea',color: 'from-amber-100 to-orange-200',   textColor: 'text-amber-700',   hand: false, score: 550, reaction: null },
  { id: 'a5', name: 'Sneha Rao',     initials: 'SR', cohort: 'R2 · VR',  color: 'from-rose-100 to-pink-200',      textColor: 'text-rose-700',    hand: false, score: 490, reaction: null },
  { id: 'a6', name: 'Priya Sharma',  initials: 'PS', cohort: 'Fellow',   color: 'from-cyan-100 to-teal-200',      textColor: 'text-cyan-700',    hand: false, score: 310, reaction: '💡' },
  { id: 'a7', name: 'Kiran Reddy',   initials: 'KR', cohort: 'R1 · Cor', color: 'from-green-100 to-emerald-200',  textColor: 'text-green-700',   hand: false, score: 280, reaction: null },
  { id: 'a8', name: 'Aisha Khan',    initials: 'AK', cohort: 'R2 · Glc', color: 'from-fuchsia-100 to-pink-200',   textColor: 'text-fuchsia-700', hand: false, score: 220, reaction: null },
]

const TRANSCRIPT: TranscriptEntry[] = [
  { t: '04:18', who: 'Dr. Avinash', text: 'So if we look at this OCT, you can see the hyperreflective foci over the inner retina—', lang: 'en' },
  { t: '04:38', who: 'Dr. Avinash', text: 'Notice the cystoid spaces? That gives us DRIL, which is a poor prognostic marker.', lang: 'en' },
  { t: '04:55', who: 'Arjun',       text: 'Is DRIL reversible if we treat early?', lang: 'en' },
  { t: '05:08', who: 'Dr. Avinash', text: 'Great question — partially, yes. Let me show you the SCORE-2 data here.', lang: 'en' },
  { t: '05:24', who: 'Pooja',       text: 'Sir, DRIL ante macula lo ekkuvaga vasthunda center-involving cases lo?', lang: 'te' },
  { t: '05:36', who: 'Dr. Avinash', text: 'Haan, generally centre-involving cases mein DRIL aur bhi common hota hai — especially jab VA 6/18 se neeche ho.', lang: 'hi' },
  { t: '05:52', who: 'Vikram',      text: 'So basically antha worse prognosis indicate chesthundi, right sir?', lang: 'mixed' },
  { t: '06:04', who: 'Dr. Avinash', text: 'Exactly. That is why we treat aggressively before DRIL becomes permanent.', lang: 'en' },
  { t: '06:18', who: 'Sneha',       text: 'What about the fellow eye? Should we treat prophylactically?', lang: 'en' },
]

const TRANSCRIPT_TRANSLATIONS: Record<string, string> = {
  '05:24': 'Sir, is DRIL more commonly seen in center-involving DME cases?',
  '05:36': 'Yes, in center-involving cases DRIL is more common — especially when VA drops below 6/18.',
  '05:52': 'So basically all of that indicates a worse prognosis, right sir?',
}

const HOOKS: HookItem[] = [
  { id: 'h1', kind: 'poll',  label: 'Poll: First-line Rx for centre-involving DME?', approved: null },
  { id: 'h2', kind: 'tf',   label: 'T/F: DRIL is always irreversible',              approved: null },
  { id: 'h3', kind: 'flash', label: 'Flash MCQ: ETDRS CST threshold for treatment?', approved: null },
  { id: 'h4', kind: 'mcq',  label: 'MCQ: Which VEGF isoform drives macular oedema?', approved: true },
]

const LEADERBOARD = [
  { rank: 1, name: 'Arjun Mehta',   initials: 'AM', score: 840, correct: 7, streak: 3 },
  { rank: 2, name: 'Pooja Iyer',    initials: 'PI', score: 720, correct: 6, streak: 2 },
  { rank: 3, name: 'Rakesh Naidu',  initials: 'RN', score: 660, correct: 6, streak: 1 },
  { rank: 4, name: 'Vikram Joshi',  initials: 'VJ', score: 550, correct: 5, streak: 2 },
  { rank: 5, name: 'Sneha Rao',     initials: 'SR', score: 490, correct: 4, streak: 1 },
  { rank: 6, name: 'Priya Sharma',  initials: 'PS', score: 310, correct: 3, streak: 0 },
]

const BREAKOUT: BreakoutRoom[] = [
  { id: 'b1', name: 'Group A — Anti-VEGF',      members: ['Arjun Mehta', 'Sneha Rao', 'Kiran Reddy'],       task: 'Compare outcomes: Bevacizumab vs Ranibizumab in DME',        timer: '12:30' },
  { id: 'b2', name: 'Group B — Steroid implants', members: ['Pooja Iyer', 'Aisha Khan'],                    task: 'Indications for steroid implants: when Anti-VEGF fails',     timer: '12:30' },
  { id: 'b3', name: 'Group C — Laser adjuncts', members: ['Rakesh Naidu', 'Vikram Joshi', 'Priya Sharma'],  task: 'Role of modified grid laser in non-centre-involving DME',    timer: '12:30' },
]

const AI_CO = [
  { id: 'c1', text: 'Summary: DR staging (ETDRS), OCT interpretation including DRIL, and its prognostic significance covered. 3 learners flagged confusion on slide 4.' },
  { id: 'c2', text: 'Silence detected for 22s after DRIL question — learners may need clarity. Suggest: open a poll on treatment threshold.' },
  { id: 'c3', text: 'Unanswered Q: "Is DRIL always irreversible?" — address before moving to Treatment Algorithm.' },
  { id: 'c4', text: 'Engagement guide: R2 Cornea cohort (Pooja, Aisha) is least engaged. A cornea-specific DR analogy could help.' },
]

interface SJTNode {
  id: string
  step: number
  stepLabel: string
  scenarioContext: string
  question: string
  options: string[]
  correct: number
  explanationCorrect: string
  explanationWrong: string[]
  next: (answerIdx: number) => string | null
}

const SJT_NODES: Record<string, SJTNode> = {
  q1: {
    id: 'q1', step: 1, stepLabel: 'Initial Presentation',
    scenarioContext: 'A 58-year-old diabetic male presents with 3 months of blurring in the right eye. BCVA is 6/18 OD. OCT shows centre-involving DME with CST 430µm. No prior treatment. HbA1c is 9.2%.',
    question: 'What is the MOST appropriate first step?',
    options: ['Intravitreal anti-VEGF injection', 'Optimise glycaemic control and review in 3 months', 'Focal laser photocoagulation', 'Intravitreal steroid implant'],
    correct: 0,
    explanationCorrect: 'Correct. Centre-involving DME with VA impairment (6/18) meets the primary threshold for intravitreal anti-VEGF as first-line treatment per NICE TA346 and ASRS guidelines.',
    explanationWrong: ['',
      'Delaying anti-VEGF to optimise glycaemia risks structural progression including DRIL. Glycaemic control is adjunctive — start anti-VEGF concurrently.',
      'Focal laser is reserved for non-centre-involving DME. In centre-involving DME with VA loss it is inferior to anti-VEGF and can damage central photoreceptors.',
      'Steroid implants are second-line for refractory DME (after ≥5 anti-VEGF injections) or in pseudophakic eyes. Not appropriate first-line.'],
    next: (a) => a === 0 ? 'q2a' : 'q2b',
  },
  q2a: {
    id: 'q2a', step: 2, stepLabel: 'Early Treatment Response',
    scenarioContext: 'Good — you started anti-VEGF. After 3 monthly injections, BCVA remains 6/18 but CST reduces from 430µm to 340µm. HbA1c has improved to 8.1%.',
    question: 'How do you interpret this anatomical-functional dissociation at 3 months?',
    options: ['Treatment has failed — switch to steroid implant immediately', 'Anatomical improvement without VA gain is expected at 3 months — continue the loading phase', 'Add focal laser to accelerate the response', 'Stop anti-VEGF — the CST reduction means the condition is self-resolving'],
    correct: 1,
    explanationCorrect: 'Correct. A 90µm CST reduction at 3 months is a meaningful anatomical response. VA lag behind anatomy is well-documented — most guidelines require ≥5 injections before declaring treatment failure.',
    explanationWrong: ['3 months is far too early to declare failure. Minimum 5 injections are required before switching. CST has already fallen 90µm — a positive signal.',
      '',
      'Adding laser in centre-involving DME with active anti-VEGF does not add benefit and risks central scotoma from laser burns.',
      'DME is a chronic, VEGF-driven condition. CST reduction is a sign to continue, not stop. Stopping will almost certainly cause rebound oedema.'],
    next: () => 'q3',
  },
  q2b: {
    id: 'q2b', step: 2, stepLabel: 'Reconsidering the Initial Decision',
    scenarioContext: 'You chose to optimise glycaemic control first. Three months later HbA1c improves to 7.8% — but BCVA has dropped to 6/24 and CST has risen to 510µm. OCT now shows early DRIL.',
    question: 'What was the critical error in management that led to this outcome?',
    options: ['The HbA1c target was too aggressive and worsened the oedema', 'Delaying anti-VEGF allowed structural progression — glycaemic control does not replace anti-VEGF when VA is already impaired', 'The patient should have had laser instead', 'This outcome was unavoidable — HbA1c correction always temporarily worsens DME'],
    correct: 1,
    explanationCorrect: 'Exactly right. The key principle: glycaemic optimisation is adjunctive — not a substitute for anti-VEGF in centre-involving DME with VA loss. The window to prevent DRIL has now closed. Anti-VEGF should have been started concurrently.',
    explanationWrong: ['HbA1c reduction from 9.2 to 7.8% is appropriate. Rapid lowering can transiently worsen DR, but sustained worsening of DME over 3 months is due to untreated oedema, not the HbA1c target.',
      '',
      'Laser is never appropriate for centre-involving DME. It would have worsened the central vision.',
      'Rapid glycaemic reduction causes only a short-term, transient worsening of DR — not sustained DME progression over 3 months. Untreated VEGF activity is the cause here.'],
    next: () => 'q3',
  },
  q3: {
    id: 'q3', step: 3, stepLabel: 'OCT Biomarkers',
    scenarioContext: 'At the 6-month review (6 anti-VEGF injections total): BCVA 6/18, CST 310µm. OCT now shows DRIL spanning the central 1mm zone and partial ellipsoid zone (EZ) disruption.',
    question: 'What do DRIL and EZ disruption tell you about the prognosis for visual recovery?',
    options: ['Positive signs — CST is near-normal so vision will recover with more injections', 'Poor prognostic markers — DRIL and EZ disruption indicate neuronal damage that limits VA recovery even with good anatomical control', 'DRIL is a normal OCT finding in treated DME and can be disregarded', 'EZ disruption means the patient needs vitrectomy urgently'],
    correct: 1,
    explanationCorrect: 'Correct. DRIL reflects disorganisation of inner retinal layers — neuronal and synaptic damage beyond simple oedema. EZ disruption signals photoreceptor damage. Both are independently associated with poor VA outcomes despite CST normalisation.',
    explanationWrong: ['CST near normal is anatomically encouraging, but VA is not determined by CST alone. DRIL and EZ disruption represent irreversible structural injury that cannot be reversed by further anti-VEGF.',
      '',
      'DRIL is NOT normal. It is defined as inability to distinguish boundaries between ganglion cell–IPL, INL, and OPL — a specific marker of structural damage with strong negative prognostic value.',
      'EZ disruption alone does not indicate vitrectomy. Surgery is indicated for tractional components, VH, or tractional RD — not for photoreceptor atrophy.'],
    next: () => 'q4',
  },
  q4: {
    id: 'q4', step: 4, stepLabel: 'Refractory Disease',
    scenarioContext: '18-month follow-up: 9 anti-VEGF injections given. BCVA remains 6/18. CST 360µm — persistent DME. HbA1c is now 7.4%. DRIL persists centrally.',
    question: 'This is refractory DME. What is the MOST appropriate next step?',
    options: ['Continue the same anti-VEGF agent for 6 more months', 'Switch to a dexamethasone intravitreal implant (Ozurdex)', 'Switch anti-VEGF agent (e.g., bevacizumab → aflibercept)', 'Refer for vitrectomy — tractional DME likely'],
    correct: 1,
    explanationCorrect: 'Correct. Persistent DME after ≥5–9 anti-VEGF injections in a patient with good glycaemic control is refractory DME. The dexamethasone implant (Ozurdex) addresses the inflammatory/VEGF-independent pathway. Monitor IOP every 4–6 weeks.',
    explanationWrong: ['Continuing the same agent after 9 failed injections is futile and delays effective treatment. The VEGF-driven component has been maximally suppressed.',
      '',
      'Switching anti-VEGF agents has modest evidence for partial responders early in treatment, but after 9 injections with no response, switching drug class (to steroids) is more appropriate.',
      'No tractional component has been described on OCT. Vitrectomy is not indicated for non-tractional refractory DME.'],
    next: () => 'q5',
  },
  q5: {
    id: 'q5', step: 5, stepLabel: 'Communication & Prognosis',
    scenarioContext: 'After Ozurdex, CST normalises to 280µm at 4 months. BCVA remains 6/18. The patient says: "Doctor, I have been coming for 2 years. When will I see normally again?"',
    question: 'Which response BEST reflects accurate, empathetic communication of the prognosis?',
    options: ['"With the new injection your vision should return to normal within 6 months."', '"I understand your frustration. With the structural damage we have seen on the scan, full visual recovery is unlikely — but our goal now is stabilisation, which we are achieving."', '"Your vision will not improve further. There is nothing more we can do."', '"It is too early to say — let us review in 6 months."'],
    correct: 1,
    explanationCorrect: 'Excellent. This response is accurate (acknowledges DRIL as a barrier to recovery), empathetic (validates frustration), and constructive (reframes success as stabilisation). It reflects shared decision-making without false hope or nihilism.',
    explanationWrong: ['"Vision returning to normal" is false hope when DRIL and EZ disruption are present. Unrealistic expectations erode trust when the promised improvement does not materialise.',
      '',
      'Saying "nothing more we can do" is inaccurate — Ozurdex is achieving CST normalisation and stabilisation. This response abandons the patient unnecessarily.',
      'After 2 years and 9+ injections the prognosis should be discussed openly. Deferring further damages trust and prevents the patient from making informed decisions about continued treatment.'],
    next: () => null,
  },
}

const ALERT_MSGS = [
  'Attention dropping — try a quick clinical question',
  '3 learners appear confused on slide 4',
  'Good pace — learners scoring well on polls',
  'Unanswered question in chat from Arjun',
]

const REACTIONS_LIST = ['👏', '🙋', '👋', '🤔', '💡', '❓', '👍', '❤️']

const LANG_LABEL: Record<string, string> = { en: 'EN', te: 'TE', hi: 'HI', ta: 'TA', kn: 'KN', ml: 'ML', mixed: 'MIX' }
const LANG_COLOR: Record<string, string> = {
  en:    'bg-slate-700 text-slate-300',
  te:    'bg-teal-900 text-teal-300',
  hi:    'bg-amber-900/60 text-amber-300',
  ta:    'bg-cyan-900/60 text-cyan-300',
  kn:    'bg-rose-900/60 text-rose-300',
  ml:    'bg-lime-900/60 text-lime-300',
  mixed: 'bg-violet-900/60 text-violet-300',
}

const SUBTITLE_TEXT: Record<string, string> = {
  en: 'Notice the cystoid spaces? That gives us DRIL — a poor prognostic marker.',
  fr: 'Remarquez les espaces kystiques? Cela nous donne le DRIL — un marqueur pronostique défavorable.',
  zh: '注意到囊样间隙了吗？这给了我们DRIL——一个不良预后标志。',
  es: 'Observe los espacios cistoides. Eso nos da DRIL — un marcador pronóstico desfavorable.',
}

function fmtTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}
function pad(n: number) { return n.toString().padStart(2, '0') }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function LiveConference({ session }: { session: SessionView }) {
  const [viewMode, setViewMode]           = useState<ViewMode>('gallery')
  const [slideIdx, setSlideIdx]           = useState(1)
  const [micOn, setMicOn]                 = useState(true)
  const [cameraOn, setCameraOn]           = useState(true)
  const [sharingScreen, setSharingScreen] = useState(false)
  const [leftCollapsed, setLeftCollapsed]   = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [rightTab, setRightTab]             = useState<RightTab>('hooks')
  const [showWhiteboard, setShowWhiteboard] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [wbColor, setWbColor]               = useState('#ffffff')
  const [wbSize, setWbSize]                 = useState(3)
  const [wbTool, setWbTool]                 = useState<'pen' | 'eraser' | 'shape' | 'text'>('pen')
  const [annotationMode, setAnnotationMode] = useState(false)
  const [showSubtitles, setShowSubtitles]   = useState(false)
  const [subtitleLang, setSubtitleLang]     = useState<'en' | 'fr' | 'zh' | 'es'>('en')
  const [newHookOpen, setNewHookOpen]       = useState(false)
  const [newHookKind, setNewHookKind]       = useState<'poll' | 'mcq' | 'tf' | 'flash'>('poll')
  const [newHookLabel, setNewHookLabel]     = useState('')
  const [lbCategory, setLbCategory]         = useState<LbCategory>('score')
  const [hookNotif, setHookNotif]           = useState<string | null>('Attention Hook queued — "Stage this DR"')
  const [alertText, setAlertText]         = useState<string | null>(null)
  const [alertsDisabled, setAlertsDisabled] = useState(false)
  const [elapsed, setElapsed]             = useState(1342)
  const [engagement, setEngagement]       = useState(74)
  const [mutedAll, setMutedAll]           = useState(false)
  const [sjtActive, setSjtActive]         = useState(false)
  const [sjtNodeId, setSjtNodeId]         = useState<string>('q1')
  const [sjtAnswer, setSjtAnswer]         = useState<number | null>(null)
  const [sjtDone, setSjtDone]             = useState(false)
  const [sjtHistory, setSjtHistory]       = useState<{nodeId: string; answer: number; correct: boolean}[]>([])
  const [hooks, setHooks]                 = useState<HookItem[]>(HOOKS)
  const [liveHookId, setLiveHookId]       = useState<string | null>(null)
  const [txLang, setTxLang]               = useState<TxLang>('all')
  const [showTranslation, setShowTranslation] = useState(false)
  const [breakoutActive, setBreakoutActive] = useState(false)
  const [rooms, setRooms]                   = useState<BreakoutRoom[]>(BREAKOUT)
  const [editingRoomId, setEditingRoomId]   = useState<string | null>(null)
  const [editRoomDraft, setEditRoomDraft]   = useState({ name: '', task: '', members: [] as string[] })
  const [showNewRoom, setShowNewRoom]       = useState(false)
  const [newRoomDraft, setNewRoomDraft]     = useState({ name: '', task: '', members: [] as string[] })
  const [reactionOpen, setReactionOpen]   = useState(false)
  const [myReaction, setMyReaction]       = useState<string | null>(null)
  const [drawTool, setDrawTool]           = useState<'draw' | 'laser' | 'annotate' | null>(null)

  const alertSeed = useRef(0)

  useEffect(() => {
    const i = setInterval(() => {
      setElapsed((e) => e + 1)
      setEngagement((e) => clamp(e + (Math.random() * 6 - 3), 42, 96))
    }, 1000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    const i = setInterval(() => {
      if (alertsDisabled) return
      const msg = ALERT_MSGS[alertSeed.current % ALERT_MSGS.length]
      alertSeed.current++
      setAlertText(msg)
      setTimeout(() => setAlertText(null), 5000)
    }, 11000)
    return () => clearInterval(i)
  }, [alertsDisabled])

  useEffect(() => {
    if (myReaction) {
      const t = setTimeout(() => setMyReaction(null), 4000)
      return () => clearTimeout(t)
    }
  }, [myReaction])

  const approveHook = (hid: string, approved: boolean) => {
    setHooks((h) => h.map((x) => (x.id === hid ? { ...x, approved } : x)))
    if (approved) setLiveHookId(hid)
  }

  const handleShare = () => {
    setSharingScreen((v) => {
      if (!v) setViewMode('presentation')
      return !v
    })
  }

  const handleDownloadTranscript = () => {
    const content = `LIVE SESSION TRANSCRIPT\n${session.title}\nDate: ${new Date().toLocaleDateString('en-US')}\nDuration: ${fmtTime(elapsed)}\n\n` +
      TRANSCRIPT.map((e) => `[${e.t}] ${e.who}: ${e.text}`).join('\n')
    downloadText(content, `transcript-${session.id}.txt`)
  }

  const handleDownloadPDF = () => {
    const content = `LIVE SESSION TRANSCRIPT (PDF export)\n${session.title}\nDate: ${new Date().toLocaleDateString('en-US')}\nDuration: ${fmtTime(elapsed)}\n\n` +
      TRANSCRIPT.map((e) => `[${e.t}] ${e.who} [${LANG_LABEL[e.lang]}]: ${e.text}`).join('\n')
    downloadText(content, `transcript-${session.id}.pdf`)
  }

  const handleDownloadTranslation = () => {
    const content = `TRANSCRIPT WITH TRANSLATIONS (English)\n${session.title}\nDate: ${new Date().toLocaleDateString('en-US')}\n\n` +
      TRANSCRIPT.map((e) => {
        const tr = TRANSCRIPT_TRANSLATIONS[e.t]
        return `[${e.t}] ${e.who} [${LANG_LABEL[e.lang]}]: ${e.text}${tr ? `\n        → [EN] ${tr}` : ''}`
      }).join('\n')
    downloadText(content, `transcript-translated-${session.id}.txt`)
  }

  const slide      = SLIDES[slideIdx]
  const engBand    = engagement >= 75 ? 'High' : engagement >= 55 ? 'Steady' : 'Dropping'
  const engColor   = engagement >= 75 ? 'text-emerald-400' : engagement >= 55 ? 'text-amber-400' : 'text-rose-400'
  const txFiltered = txLang === 'all' ? TRANSCRIPT : TRANSCRIPT.filter((l) => l.lang === txLang)

  // Gallery page 1: RM + KA + audience[0..5]  (8 tiles to fill right 2 cols × 4 rows)
  const galTiles = [AUDIENCE[0], AUDIENCE[1], AUDIENCE[2], AUDIENCE[3], AUDIENCE[4], AUDIENCE[5]]

  return (
    <div className="-mx-6 -my-8 flex h-[calc(100vh-56px)] flex-col overflow-hidden bg-gray-950 text-slate-100">

      {/* ── TOP STATUS BAR ─────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-600 bg-gray-700 px-4 backdrop-blur-sm">
        <Link
          href={`/session/${session.id}/pre`}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <ArrowLeft className="size-3.5" />
          Exit live
        </Link>

        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-rose-300 uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-rose-400" />
            Live
          </span>
          <span className="font-semibold tracking-tight text-white">{session.title}</span>
        </div>

        {/* View toggle */}
        <div className="ml-4 flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5">
          {(['gallery', 'presentation'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { setViewMode(v); if (v === 'presentation') setSharingScreen(false) }}
              className={cn(
                'rounded-full px-3 py-1 text-[10.5px] font-medium capitalize transition-colors',
                viewMode === v ? 'bg-white/[0.12] text-white' : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {v === 'gallery' ? 'Gallery View' : 'Presentation'}
            </button>
          ))}
        </div>

        {sharingScreen && (
          <span className="rounded-full border border-teal-500/30 bg-teal-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-teal-300">
            You are sharing screen
          </span>
        )}

        <div className="ml-auto flex items-center gap-4 text-[11.5px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" />
            <span className="font-mono tabular-nums">{fmtTime(elapsed)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users2 className="size-3.5" />
            {AUDIENCE.length + PANELISTS.length}
          </span>
          <span className={cn('inline-flex items-center gap-1 font-semibold', engColor)}>
            {Math.round(engagement)}% {engBand}
          </span>
        </div>
      </div>

      {/* ── MAIN ROW ───────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* LEFT PANEL */}
        <div className={cn('flex shrink-0 flex-col border-r border-gray-200 bg-white transition-all duration-300', leftCollapsed ? 'w-10' : 'w-[188px]')}>
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-gray-200 px-2.5">
            {!leftCollapsed && <span className="text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Faculty</span>}
            <button type="button" onClick={() => setLeftCollapsed((v) => !v)} className="ml-auto rounded-md p-1 text-gray-400 hover:text-gray-900">
              {leftCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
            </button>
          </div>

          {!leftCollapsed && (
            <div className="flex flex-col gap-2 overflow-y-auto p-2.5">
              {PANELISTS.map((p) => (
                <div key={p.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                  <div className={cn('flex h-[68px] items-center justify-center bg-linear-to-br', p.color)}>
                    <span className="text-xl font-bold text-white/90">{p.initials}</span>
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="truncate text-[11px] font-semibold leading-tight text-gray-900">{p.name}</div>
                    <div className="mt-0.5 flex items-center justify-between">
                      <div className="text-[9.5px] text-gray-500">{p.role}</div>
                      <div className="flex items-center gap-1">
                        {p.mic && !mutedAll ? <Mic className="size-2.5 text-teal-500" /> : <MicOff className="size-2.5 text-gray-400" />}
                        {p.cam ? <Video className="size-2.5 text-teal-500" /> : <VideoOff className="size-2.5 text-gray-400" />}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="mt-1 border-t border-gray-200 pt-2.5">
                <div className="mb-1.5 text-[9px] font-semibold tracking-widest text-gray-400 uppercase">Mod tools</div>
                <button
                  type="button"
                  onClick={() => setMutedAll(true)}
                  className={cn('mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] transition-colors hover:bg-gray-100', mutedAll ? 'text-rose-600 font-medium' : 'text-gray-600 hover:text-gray-900')}
                >
                  <MicOff className="size-3" />
                  {mutedAll ? 'All muted' : 'Mute all'}
                </button>
                <button
                  type="button"
                  onClick={() => setAlertsDisabled((v) => !v)}
                  className={cn('mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] transition-colors hover:bg-gray-100', alertsDisabled ? 'text-amber-600 font-medium' : 'text-gray-600 hover:text-gray-900')}
                >
                  <BellOff className="size-3" />
                  {alertsDisabled ? 'Alerts disabled' : 'Disable alerts'}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('presentation')}
                  className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                >
                  <Monitor className="size-3" />
                  Spotlight
                </button>
                <button
                  type="button"
                  className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                >
                  <Settings className="size-3" />
                  Settings
                </button>
              </div>
            </div>
          )}
        </div>

        {/* CENTER */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">

          {/* ── GALLERY VIEW ─────────────────────────────────────────── */}
          {viewMode === 'gallery' && (
            <div className="relative grid h-full grid-cols-4 grid-rows-3 gap-1.5 overflow-hidden bg-gray-900 p-2">
              {/* Presenter — 2×2 large tile */}
              <div className="relative col-span-2 row-span-2 overflow-hidden rounded-2xl ring-2 ring-teal-500/70 ring-offset-1 ring-offset-gray-900">
                <div className={cn('absolute inset-0 bg-linear-to-br', PANELISTS[0].color)} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={cn('text-5xl font-bold', PANELISTS[0].textColor)}>{PANELISTS[0].initials}</span>
                </div>
                {myReaction && (
                  <div className="absolute top-3 left-3 animate-in zoom-in-50 text-3xl">{myReaction}</div>
                )}
                {liveHookId && (
                  <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-teal-500/30 bg-black/60 px-3 py-1 backdrop-blur">
                    <div className="text-[10px] font-semibold text-teal-300">
                      <Zap className="mr-1 inline-block size-3" />
                      Live: {hooks.find((h) => h.id === liveHookId)?.label}
                    </div>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-black/50 px-3 py-2 backdrop-blur-sm">
                  <Mic className="size-3 text-teal-400" />
                  <span className="flex-1 truncate text-[11px] font-medium text-white">{PANELISTS[0].name}</span>
                  <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white">Presenter</span>
                </div>
                {/* Annotation tools overlay */}
                <div className="absolute bottom-10 left-3 flex items-center gap-1 rounded-xl border border-white/[0.08] bg-black/40 p-1 backdrop-blur">
                  {[
                    { key: 'draw' as const,     icon: <Pencil className="size-3" />,   label: 'Draw' },
                    { key: 'laser' as const,    icon: <Wand2 className="size-3" />,    label: 'Laser' },
                    { key: 'annotate' as const, icon: <HelpCircle className="size-3" />, label: 'Annotate' },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      title={t.label}
                      onClick={() => setDrawTool(drawTool === t.key ? null : t.key)}
                      className={cn('rounded-lg p-1.5 transition-colors', drawTool === t.key ? 'bg-teal-500/30 text-teal-300' : 'text-slate-400 hover:bg-white/10 hover:text-white')}
                    >
                      {t.icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Panelist tiles — col 2-3, rows 0-1 */}
              {[PANELISTS[1], PANELISTS[2]].map((p, pi) => (
                <div key={p.id} className="relative overflow-hidden rounded-2xl">
                  <div className={cn('absolute inset-0 bg-linear-to-br', p.color)} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={cn('text-2xl font-bold', p.textColor)}>{p.initials}</span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 bg-black/50 px-2 py-1.5 backdrop-blur-sm">
                    {p.mic && !mutedAll ? <Mic className="size-2.5 shrink-0 text-teal-400" /> : <MicOff className="size-2.5 shrink-0 text-rose-400" />}
                    <span className="flex-1 truncate text-[9.5px] font-medium text-white">{p.name.split(' ').slice(0, 2).join(' ')}</span>
                    <span className={cn('rounded px-1 py-0.5 text-[7.5px] font-bold uppercase', pi === 0 ? 'bg-slate-600 text-slate-200' : 'bg-sky-700 text-sky-200')}>{p.role}</span>
                  </div>
                </div>
              ))}

              {/* Audience tiles — row 2 (4 tiles) + remaining 2 in row 1 cols 2-3 filled above */}
              {galTiles.map((a) => (
                <div key={a.id} className="relative overflow-hidden rounded-2xl">
                  <div className={cn('absolute inset-0 bg-linear-to-br', a.color)} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={cn('text-xl font-bold', a.textColor)}>{a.initials}</span>
                  </div>
                  {a.reaction && (
                    <div className="absolute top-1.5 left-1.5 text-base">{a.reaction}</div>
                  )}
                  {a.hand && (
                    <div className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-amber-500 text-[10px]">✋</div>
                  )}
                  {mutedAll && (
                    <div className="absolute top-1.5 right-1.5"><MicOff className="size-3 text-rose-400" /></div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 bg-black/50 px-2 py-1.5 backdrop-blur-sm">
                    <MicOff className="size-2.5 shrink-0 text-slate-500" />
                    <span className="flex-1 truncate text-[9.5px] font-medium text-white">{a.name}</span>
                    <span className="font-mono text-[8px] text-slate-400">{a.score}</span>
                  </div>
                </div>
              ))}

              {/* Remaining 2 audience tiles in row 2 last 2 cells */}
              {AUDIENCE.slice(6, 8).map((a) => (
                <div key={a.id} className="relative overflow-hidden rounded-2xl">
                  <div className={cn('absolute inset-0 bg-linear-to-br', a.color)} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className={cn('text-xl font-bold', a.textColor)}>{a.initials}</span>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 bg-black/50 px-2 py-1.5 backdrop-blur-sm">
                    <MicOff className="size-2.5 shrink-0 text-slate-500" />
                    <span className="flex-1 truncate text-[9.5px] font-medium text-white">{a.name}</span>
                    <span className="font-mono text-[8px] text-slate-400">{a.score}</span>
                  </div>
                </div>
              ))}

              {/* Subtitle bar — gallery view */}
              {showSubtitles && (
                <div className="pointer-events-none absolute bottom-10 left-1/2 z-10 w-[65%] -translate-x-1/2 rounded-xl bg-black/80 px-4 py-2 text-center backdrop-blur">
                  <p className="text-[11px] font-medium leading-snug text-white">{SUBTITLE_TEXT[subtitleLang]}</p>
                  <span className="mt-0.5 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[8px] font-semibold text-white/50 uppercase">
                    {subtitleLang === 'en' ? 'English' : subtitleLang === 'fr' ? 'French' : subtitleLang === 'zh' ? 'Chinese' : 'Spanish'}
                  </span>
                </div>
              )}
              {/* Page indicator */}
              <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[9px] font-semibold text-slate-400 backdrop-blur">
                1 / 4
              </div>
            </div>
          )}

          {/* ── PRESENTATION VIEW ──────────────────────────────────── */}
          {viewMode === 'presentation' && (
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div className={cn('absolute inset-3 overflow-hidden rounded-3xl bg-linear-to-br ring-1 ring-white/10 shadow-2xl', slide.color, annotationMode && 'cursor-crosshair')}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.5_0.14_165/0.18),transparent_55%)]" />
                <div className="relative flex h-full flex-col justify-between p-8">
                  <div>
                    <div className="mb-2 text-[10.5px] font-semibold tracking-widest text-slate-400 uppercase">
                      {session.specialty} · Slide {slideIdx + 1}/{SLIDES.length}
                    </div>
                    <h2 className="text-[22px] font-bold leading-tight tracking-tight text-white">{slide.title}</h2>
                    <p className="mt-2 text-[13.5px] text-slate-300">{slide.sub}</p>
                  </div>

                  <div className="flex items-end justify-between">
                    <div className="flex items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-black/30 p-1.5 backdrop-blur">
                      {[
                        { key: 'draw' as const,     icon: <Pencil className="size-3.5" />,    label: 'Draw' },
                        { key: 'laser' as const,    icon: <Wand2 className="size-3.5" />,     label: 'Laser' },
                        { key: 'annotate' as const, icon: <HelpCircle className="size-3.5" />, label: 'Annotate' },
                      ].map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          title={t.label}
                          onClick={() => setDrawTool(drawTool === t.key ? null : t.key)}
                          className={cn('rounded-xl p-1.5 transition-colors', drawTool === t.key ? 'bg-teal-500/30 text-teal-300' : 'text-slate-400 hover:bg-white/10 hover:text-white')}
                        >
                          {t.icon}
                        </button>
                      ))}
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
                      <div className="flex h-14 w-20 items-center justify-center bg-linear-to-br from-teal-500 to-emerald-600">
                        <span className="text-base font-bold text-white">AP</span>
                      </div>
                      <div className="border-t border-white/10 bg-black/40 px-2 py-1 text-center text-[9px] text-white/60">Dr. Avinash</div>
                    </div>
                  </div>
                </div>

                {liveHookId && (
                  <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded-2xl border border-teal-500/30 bg-teal-500/15 px-4 py-1.5 backdrop-blur">
                    <div className="text-[10.5px] font-semibold text-teal-300">
                      <Zap className="mr-1 inline-block size-3" />
                      Live: {hooks.find((h) => h.id === liveHookId)?.label}
                    </div>
                  </div>
                )}
                {/* Screen annotation pen toggle — only when sharing */}
                {sharingScreen && (
                  <div className="absolute top-4 right-4 z-20">
                    <button
                      type="button"
                      onClick={() => setAnnotationMode((v) => !v)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10.5px] font-semibold backdrop-blur transition-colors',
                        annotationMode
                          ? 'border-orange-400/50 bg-orange-500/25 text-orange-200'
                          : 'border-white/20 bg-black/40 text-white/70 hover:text-white'
                      )}
                    >
                      <Pencil className="size-3" />
                      {annotationMode ? 'Pen ON — scribble freely' : 'Annotation Pen'}
                    </button>
                  </div>
                )}
                {/* Subtitle bar */}
                {showSubtitles && (
                  <div className="absolute bottom-4 left-1/2 z-20 w-[80%] -translate-x-1/2 rounded-xl bg-black/80 px-4 py-2.5 text-center backdrop-blur">
                    <p className="text-[13px] font-medium leading-snug text-white">{SUBTITLE_TEXT[subtitleLang]}</p>
                    <span className="mt-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-white/50 uppercase">
                      {subtitleLang === 'en' ? 'English' : subtitleLang === 'fr' ? 'French' : subtitleLang === 'zh' ? 'Chinese' : 'Spanish'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Slide nav — always visible */}
          <div className="flex shrink-0 items-center justify-center gap-3 border-t border-gray-700 bg-gray-800 px-4 py-2">
            <button
              type="button"
              disabled={slideIdx === 0}
              onClick={() => setSlideIdx((i) => i - 1)}
              className="rounded-full border border-gray-600 bg-gray-700 p-1.5 text-gray-300 hover:bg-gray-600 disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="flex items-center gap-1">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSlideIdx(i)}
                  className={cn('rounded-full transition-all', i === slideIdx ? 'h-2 w-5 bg-teal-400' : 'size-2 bg-gray-600 hover:bg-gray-400')}
                />
              ))}
            </div>
            <button
              type="button"
              disabled={slideIdx === SLIDES.length - 1}
              onClick={() => setSlideIdx((i) => i + 1)}
              className="rounded-full border border-gray-600 bg-gray-700 p-1.5 text-gray-300 hover:bg-gray-600 disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className={cn('flex shrink-0 flex-col border-l border-gray-200 bg-white transition-all duration-300', rightCollapsed ? 'w-10' : 'w-[264px]')}>
          {/* Collapse toggle row */}
          <div className="flex h-9 shrink-0 items-center border-b border-gray-200 px-2.5">
            <button type="button" onClick={() => setRightCollapsed((v) => !v)} className="rounded-md p-1 text-gray-400 hover:text-gray-900">
              {rightCollapsed ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
            {!rightCollapsed && <span className="ml-1 text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Panel</span>}
          </div>
          {!rightCollapsed && <>
          <div className="grid shrink-0 grid-cols-4 border-b border-gray-200">
            {([
              { key: 'hooks'      as RightTab, icon: <Zap className="size-[13px]" />,        label: 'Hooks' },
              { key: 'transcript' as RightTab, icon: <Globe className="size-[13px]" />,      label: 'Captions' },
              { key: 'ai'         as RightTab, icon: <Sparkles className="size-[13px]" />,   label: 'AI' },
              { key: 'breakout'   as RightTab, icon: <Layers className="size-[13px]" />,     label: 'Rooms' },
            ] as const).map((tab) => (
              <button key={tab.key} type="button" onClick={() => setRightTab(tab.key)}
                className={cn('flex flex-col items-center gap-0.5 border-b-2 py-2 text-[9px] font-medium transition-colors', rightTab === tab.key ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-400 hover:text-gray-700')}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">

            {rightTab === 'hooks' && (
              <div className="space-y-2 p-3">
                <div className="mb-1 text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Attention Hooks</div>
                {hooks.map((h) => (
                  <div key={h.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <div className="px-3 pt-2.5 pb-1.5">
                      <div className="mb-1 inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-gray-500 uppercase">{h.kind}</div>
                      <div className="text-[11px] font-medium leading-snug text-gray-800">{h.label}</div>
                    </div>
                    {h.approved === null ? (
                      <div className="flex gap-1.5 border-t border-gray-100 px-2.5 py-2">
                        <button type="button" onClick={() => approveHook(h.id, false)} className="flex-1 rounded-lg border border-gray-200 py-1 text-[10px] text-gray-500 hover:bg-gray-50">Skip</button>
                        <button type="button" onClick={() => approveHook(h.id, true)} className="flex-1 rounded-lg bg-teal-500 py-1 text-[10px] font-semibold text-white hover:bg-teal-400">Launch</button>
                      </div>
                    ) : (
                      <div className={cn('border-t border-gray-100 px-3 py-1.5 text-[10px] font-semibold', h.approved ? 'text-teal-600' : 'text-gray-400')}>
                        {h.approved ? <><Check className="mr-1 inline-block size-3" />Live now</> : 'Skipped'}
                      </div>
                    )}
                  </div>
                ))}
                {/* New hook with type picker */}
                {newHookOpen ? (
                  <div className="rounded-2xl border border-teal-200 bg-teal-50 p-2.5 space-y-2">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-teal-700">New Hook</div>
                    <div className="grid grid-cols-2 gap-1">
                      {([
                        { kind: 'poll'  as const, label: 'Poll' },
                        { kind: 'mcq'   as const, label: 'MCQ' },
                        { kind: 'tf'    as const, label: 'True / False' },
                        { kind: 'flash' as const, label: 'Flashcard' },
                      ]).map((t) => (
                        <button key={t.kind} type="button" onClick={() => setNewHookKind(t.kind)}
                          className={cn('rounded-xl border py-1.5 text-[10px] font-medium transition-colors',
                            newHookKind === t.kind ? 'border-teal-500 bg-teal-500 text-white' : 'border-teal-200 bg-white text-gray-600 hover:border-teal-400')}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <input value={newHookLabel} onChange={(e) => setNewHookLabel(e.target.value)}
                      placeholder="Enter question…"
                      className="w-full rounded-xl border border-teal-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-900 outline-none focus:ring-2 focus:ring-teal-400" />
                    <div className="flex gap-1.5">
                      <button type="button" disabled={!newHookLabel.trim()} onClick={() => {
                        setHooks((h) => [...h, { id: `h${Date.now()}`, kind: newHookKind, label: newHookLabel.trim(), approved: null }])
                        setNewHookLabel(''); setNewHookOpen(false)
                      }} className="flex-1 rounded-full bg-teal-500 py-1.5 text-[10px] font-semibold text-white hover:bg-teal-400 disabled:opacity-40">Add</button>
                      <button type="button" onClick={() => setNewHookOpen(false)} className="rounded-full border border-teal-200 px-3 py-1.5 text-[10px] text-gray-500 hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setNewHookOpen(true)}
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-gray-300 py-2.5 text-[10.5px] text-gray-400 hover:border-teal-400 hover:text-teal-600">
                    <Plus className="size-3.5" />
                    New hook
                  </button>
                )}
              </div>
            )}

            {rightTab === 'transcript' && (
              <div className="flex h-full flex-col p-3">
                {/* Language filter — 4-col compact grid */}
                <div className="mb-2">
                  <div className="mb-1 text-[8.5px] font-semibold uppercase tracking-wider text-gray-400">Filter by language</div>
                  <div className="grid grid-cols-4 gap-1">
                    {([
                      { key: 'all'   as TxLang, label: 'All'  },
                      { key: 'en'    as TxLang, label: 'EN'   },
                      { key: 'te'    as TxLang, label: 'TE'   },
                      { key: 'hi'    as TxLang, label: 'HI'   },
                      { key: 'mixed' as TxLang, label: 'MIX'  },
                      { key: 'ta'    as TxLang, label: 'TA'   },
                      { key: 'kn'    as TxLang, label: 'KN'   },
                      { key: 'ml'    as TxLang, label: 'ML'   },
                    ]).map(({ key, label }) => (
                      <button key={key} type="button" onClick={() => setTxLang(key)}
                        className={cn('rounded-lg py-1 text-[8.5px] font-bold uppercase transition-colors', txLang === key ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Translate toggle */}
                <button
                  type="button"
                  onClick={() => setShowTranslation((v) => !v)}
                  className={cn('mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl border py-1.5 text-[9px] font-semibold transition-colors', showTranslation ? 'border-indigo-300 bg-indigo-100 text-indigo-700' : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-700')}
                >
                  <Languages className="size-3" />
                  {showTranslation ? 'Hide translation' : 'Show EN translation'}
                </button>
                {/* Download buttons */}
                <div className="mb-2 grid grid-cols-3 gap-1">
                  <button type="button" onClick={handleDownloadTranscript} className="flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50 py-1.5 text-[8.5px] text-gray-500 hover:bg-gray-100">
                    <Download className="size-3" />TXT
                  </button>
                  <button type="button" onClick={handleDownloadTranslation} className="flex items-center justify-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 py-1.5 text-[8.5px] text-indigo-600 hover:bg-indigo-100">
                    <Download className="size-3" />EN
                  </button>
                  <button type="button" onClick={handleDownloadPDF} className="flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 py-1.5 text-[8.5px] text-rose-600 hover:bg-rose-100">
                    <Download className="size-3" />PDF
                  </button>
                </div>
                {/* Subtitle controls */}
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[8.5px] font-semibold uppercase tracking-wider text-amber-700">Live Subtitles</span>
                    <button type="button" onClick={() => setShowSubtitles((v) => !v)}
                      className={cn('rounded-full px-2 py-0.5 text-[8px] font-bold transition-colors', showSubtitles ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-600 hover:bg-amber-200')}>
                      {showSubtitles ? 'On' : 'Off'}
                    </button>
                  </div>
                  {showSubtitles && (
                    <div className="grid grid-cols-2 gap-1">
                      {([
                        { key: 'en' as const, label: 'English' },
                        { key: 'fr' as const, label: 'French'  },
                        { key: 'zh' as const, label: 'Chinese' },
                        { key: 'es' as const, label: 'Spanish' },
                      ]).map(({ key, label }) => (
                        <button key={key} type="button" onClick={() => setSubtitleLang(key)}
                          className={cn('rounded-lg py-1 text-[8.5px] font-semibold transition-colors', subtitleLang === key ? 'bg-amber-500 text-white' : 'bg-white border border-amber-200 text-amber-700 hover:bg-amber-100')}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* Entries */}
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {txFiltered.map((l, i) => (
                    <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-2.5">
                      <div className="mb-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-gray-400">{l.t}</span>
                        <span className="text-[9px] font-medium text-gray-600">{l.who}</span>
                        <span className={cn('ml-auto rounded px-1 py-0.5 text-[7.5px] font-bold', LANG_COLOR[l.lang])}>{LANG_LABEL[l.lang]}</span>
                      </div>
                      <p className="text-[11px] leading-snug text-gray-800">{l.text}</p>
                      {showTranslation && TRANSCRIPT_TRANSLATIONS[l.t] && (
                        <p className="mt-1.5 rounded-md bg-indigo-50 px-2 py-1 text-[10.5px] leading-snug text-indigo-800">
                          <span className="mr-1 text-[8px] font-bold uppercase text-indigo-500">EN →</span>
                          {TRANSCRIPT_TRANSLATIONS[l.t]}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rightTab === 'ai' && (
              <div className="p-3">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="size-4 text-teal-600" />
                  <span className="text-[12px] font-semibold text-gray-900">AI Co-Facilitator</span>
                </div>
                <div className="space-y-2.5">
                  {AI_CO.map((m) => (
                    <div key={m.id} className="rounded-2xl border border-teal-200 bg-teal-50 p-3">
                      <div className="flex items-start gap-2">
                        <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
                        <p className="text-[11px] leading-snug text-gray-800">{m.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rightTab === 'breakout' && (
              <div className="p-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Smart Breakouts</span>
                  <button type="button" onClick={() => setBreakoutActive((v) => !v)} className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors', breakoutActive ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-teal-200 bg-teal-50 text-teal-700')}>
                    {breakoutActive ? 'End' : 'Start'}
                  </button>
                </div>
                <div className="space-y-2">
                  {rooms.map((r) => (
                    <div key={r.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                      {editingRoomId === r.id ? (
                        /* ── Inline edit form ── */
                        <div className="p-2.5 space-y-2">
                          <input
                            value={editRoomDraft.name}
                            onChange={(e) => setEditRoomDraft((d) => ({ ...d, name: e.target.value }))}
                            placeholder="Room name"
                            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-900 outline-none focus:ring-2 focus:ring-teal-400"
                          />
                          <textarea
                            value={editRoomDraft.task}
                            onChange={(e) => setEditRoomDraft((d) => ({ ...d, task: e.target.value }))}
                            placeholder="Task / discussion topic"
                            rows={2}
                            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-900 outline-none focus:ring-2 focus:ring-teal-400"
                          />
                          <div>
                            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Members</div>
                            <div className="space-y-0.5 max-h-28 overflow-y-auto">
                              {AUDIENCE.map((a) => (
                                <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-50">
                                  <input
                                    type="checkbox"
                                    checked={editRoomDraft.members.includes(a.name)}
                                    onChange={(e) => setEditRoomDraft((d) => ({
                                      ...d,
                                      members: e.target.checked
                                        ? [...d.members, a.name]
                                        : d.members.filter((m) => m !== a.name),
                                    }))}
                                    className="size-3 accent-teal-500"
                                  />
                                  <span className="text-[10.5px] text-gray-700">{a.name.split(' ')[0]}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => {
                              setRooms((prev) => prev.map((x) => x.id === r.id ? { ...x, name: editRoomDraft.name || x.name, task: editRoomDraft.task || x.task, members: editRoomDraft.members.length ? editRoomDraft.members : x.members } : x))
                              setEditingRoomId(null)
                            }} className="flex flex-1 items-center justify-center gap-1 rounded-full bg-teal-500 py-1.5 text-[10px] font-semibold text-white hover:bg-teal-400">
                              <Save className="size-3" /> Save
                            </button>
                            <button type="button" onClick={() => setEditingRoomId(null)} className="flex-1 rounded-full border border-gray-200 py-1.5 text-[10px] text-gray-500 hover:bg-gray-50">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        /* ── Normal view ── */
                        <>
                          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                            <span className="text-[11px] font-semibold text-gray-900">{r.name}</span>
                            <div className="flex items-center gap-1">
                              {breakoutActive && <span className="font-mono text-[9.5px] text-teal-600">{r.timer}</span>}
                              <button type="button" onClick={() => { setEditingRoomId(r.id); setEditRoomDraft({ name: r.name, task: r.task, members: [...r.members] }) }} className="rounded-md p-1 text-gray-400 hover:text-gray-700">
                                <Edit2 className="size-3" />
                              </button>
                              <button type="button" onClick={() => setRooms((prev) => prev.filter((x) => x.id !== r.id))} className="rounded-md p-1 text-gray-400 hover:text-rose-500">
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          </div>
                          <div className="px-3 py-2">
                            <div className="mb-1.5 text-[9.5px] text-gray-500">{r.task}</div>
                            <div className="flex flex-wrap gap-1">
                              {r.members.map((m) => (
                                <span key={m} className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] text-gray-600">{m.split(' ')[0]}</span>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* ── New room form ── */}
                {showNewRoom ? (
                  <div className="mt-2 overflow-hidden rounded-2xl border border-teal-200 bg-teal-50 p-2.5 space-y-2">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-teal-600">New Room</div>
                    <input
                      value={newRoomDraft.name}
                      onChange={(e) => setNewRoomDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="Room name"
                      className="w-full rounded-lg border border-teal-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-900 outline-none focus:ring-2 focus:ring-teal-400"
                    />
                    <textarea
                      value={newRoomDraft.task}
                      onChange={(e) => setNewRoomDraft((d) => ({ ...d, task: e.target.value }))}
                      placeholder="Task / discussion topic"
                      rows={2}
                      className="w-full rounded-lg border border-teal-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-900 outline-none focus:ring-2 focus:ring-teal-400"
                    />
                    <div>
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-teal-600">Assign members</div>
                      <div className="space-y-0.5 max-h-28 overflow-y-auto">
                        {AUDIENCE.map((a) => (
                          <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-teal-100">
                            <input
                              type="checkbox"
                              checked={newRoomDraft.members.includes(a.name)}
                              onChange={(e) => setNewRoomDraft((d) => ({
                                ...d,
                                members: e.target.checked
                                  ? [...d.members, a.name]
                                  : d.members.filter((m) => m !== a.name),
                              }))}
                              className="size-3 accent-teal-500"
                            />
                            <span className="text-[10.5px] text-gray-700">{a.name.split(' ')[0]}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" disabled={!newRoomDraft.name.trim()} onClick={() => {
                        const id = `b${Date.now()}`
                        setRooms((prev) => [...prev, { id, name: newRoomDraft.name, task: newRoomDraft.task || 'Discuss assigned topic', members: newRoomDraft.members, timer: '12:00' }])
                        setNewRoomDraft({ name: '', task: '', members: [] })
                        setShowNewRoom(false)
                      }} className="flex flex-1 items-center justify-center gap-1 rounded-full bg-teal-500 py-1.5 text-[10px] font-semibold text-white hover:bg-teal-400 disabled:opacity-40">
                        <Plus className="size-3" /> Create
                      </button>
                      <button type="button" onClick={() => { setShowNewRoom(false); setNewRoomDraft({ name: '', task: '', members: [] }) }} className="flex-1 rounded-full border border-teal-200 bg-white py-1.5 text-[10px] text-gray-500 hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowNewRoom(true)} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-teal-300 py-2 text-[10.5px] text-teal-600 hover:border-teal-400 hover:bg-teal-50">
                    <Plus className="size-3.5" /> Create room
                  </button>
                )}
              </div>
            )}

          </div>
          </>}
        </div>
      </div>

      {/* ── BOTTOM DOCK ────────────────────────────────────────────────── */}
      <div className="relative flex h-[68px] shrink-0 items-center justify-center gap-2 border-t border-gray-600 bg-gray-700 px-4 backdrop-blur-sm">
        <DockBtn active={micOn}    onClick={() => setMicOn((v) => !v)}    icon={micOn ? <Mic className="size-5" />    : <MicOff className="size-5" />}    label={micOn ? 'Mute' : 'Unmute'} />
        <DockBtn active={cameraOn} onClick={() => setCameraOn((v) => !v)} icon={cameraOn ? <Video className="size-5" /> : <VideoOff className="size-5" />} label="Camera" />
        <DockBtn active={sharingScreen} onClick={handleShare} icon={<Monitor className="size-5" />} label="Share Screen" />

        <div className="mx-1 h-8 w-px bg-white/[0.08]" />

        <DockBtn active={showWhiteboard}  icon={<Pencil className="size-5" />}  label="Whiteboard"   onClick={() => setShowWhiteboard((v) => !v)} />
        <DockBtn active={showLeaderboard} icon={<Trophy className="size-5" />}  label="Leaderboard"  onClick={() => setShowLeaderboard((v) => !v)} />
        <DockBtn icon={<Zap className="size-5" />}       label="Hooks"        onClick={() => setRightTab('hooks')} />
        <DockBtn icon={<Layers className="size-5" />}    label="Rooms"        onClick={() => setRightTab('breakout')} />

        <div className="relative">
          <DockBtn icon={<SmilePlus className="size-5" />} label="Reactions" onClick={() => setReactionOpen((v) => !v)} active={reactionOpen ? true : undefined} />
          {reactionOpen && (
            <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 flex gap-1.5 rounded-2xl border border-white/[0.08] bg-slate-800/95 p-2 shadow-2xl backdrop-blur">
              {REACTIONS_LIST.map((r) => (
                <button key={r} type="button" onClick={() => { setMyReaction(r); setReactionOpen(false) }}
                  className="rounded-xl p-1.5 text-xl hover:bg-white/10 transition-colors">{r}</button>
              ))}
            </div>
          )}
        </div>

        <div className="mx-1 h-8 w-px bg-white/[0.08]" />

        <button type="button" onClick={() => setSjtActive(true)}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 text-[12px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20">
          <HelpCircle className="size-4" />End &amp; SJT
        </button>

        <div className="mx-1 h-8 w-px bg-white/[0.08]" />

        <Link href={`/session/${session.id}/post`}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-500 px-4 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-rose-500/90">
          <AlertCircle className="size-4" />End Session
        </Link>
      </div>

      {/* ── FULL-SCREEN WHITEBOARD ─────────────────────────────────────── */}
      {showWhiteboard && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-white">
          {/* Toolbar */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 shadow-sm">
            <span className="mr-2 text-[13px] font-semibold text-gray-800">Whiteboard</span>
            {/* Tools */}
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
              {([
                { key: 'pen'    as const, icon: <Pencil className="size-4" />,  label: 'Pen' },
                { key: 'eraser' as const, icon: <Eraser className="size-4" />,  label: 'Eraser' },
                { key: 'shape'  as const, icon: <Square className="size-4" />,  label: 'Shape' },
                { key: 'text'   as const, icon: <Minus className="size-4" />,   label: 'Text' },
              ]).map((t) => (
                <button key={t.key} type="button" title={t.label} onClick={() => setWbTool(t.key)}
                  className={cn('grid size-8 place-items-center rounded-lg transition-colors', wbTool === t.key ? 'bg-teal-500 text-white' : 'text-gray-500 hover:bg-gray-100')}>
                  {t.icon}
                </button>
              ))}
            </div>
            {/* Size */}
            <div className="flex items-center gap-1.5">
              <button onClick={() => setWbSize((s) => Math.max(1, s - 1))} className="grid size-6 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100"><Minus className="size-3" /></button>
              <span className="w-5 text-center text-[11px] font-mono font-semibold text-gray-700">{wbSize}</span>
              <button onClick={() => setWbSize((s) => Math.min(16, s + 1))} className="grid size-6 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100"><Plus className="size-3" /></button>
            </div>
            {/* Colors */}
            <div className="flex items-center gap-1">
              {['#111827','#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#6366f1','#ffffff'].map((c) => (
                <button key={c} type="button" onClick={() => setWbColor(c)}
                  className={cn('size-6 rounded-full border-2 transition-transform hover:scale-110', wbColor === c ? 'border-teal-500 scale-110' : 'border-gray-300')}
                  style={{ backgroundColor: c }} />
              ))}
              <label className="ml-1 flex size-6 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-gray-300 hover:border-teal-400" title="Custom colour">
                <Palette className="size-3 text-gray-400" />
                <input type="color" value={wbColor} onChange={(e) => setWbColor(e.target.value)} className="sr-only" />
              </label>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-teal-700">Shared with all participants</span>
              <button type="button" onClick={() => setShowWhiteboard(false)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
                <X className="size-3.5" /> Close
              </button>
            </div>
          </div>
          {/* Canvas area */}
          <div className="relative flex-1 overflow-hidden bg-white" style={{ cursor: wbTool === 'eraser' ? 'cell' : 'crosshair' }}>
            <div className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[13px] font-medium text-gray-300 select-none">Draw freely · {wbTool === 'pen' ? 'Pen' : wbTool === 'eraser' ? 'Eraser' : wbTool === 'shape' ? 'Shape' : 'Text'} selected · Size {wbSize}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── LEADERBOARD OVERLAY ──────────────────────────────────────────── */}
      {showLeaderboard && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowLeaderboard(false)}>
          <div className="mx-4 w-full max-w-md overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <div className="flex items-center gap-2">
                <Trophy className="size-5 text-amber-400" />
                <span className="text-[15px] font-semibold">Live Leaderboard</span>
              </div>
              <button type="button" onClick={() => setShowLeaderboard(false)} className="text-slate-500 hover:text-white"><X className="size-5" /></button>
            </div>
            {/* Category tabs */}
            <div className="flex gap-0 border-b border-white/[0.06] overflow-x-auto">
              {([
                { key: 'score'      as LbCategory, label: 'Top Score' },
                { key: 'consistent' as LbCategory, label: 'Most Consistent' },
                { key: 'accurate'   as LbCategory, label: 'Most Accurate' },
                { key: 'engaged'    as LbCategory, label: 'Most Engaged' },
                { key: 'time'       as LbCategory, label: 'Least Time' },
              ]).map((c) => (
                <button key={c.key} type="button" onClick={() => setLbCategory(c.key)}
                  className={cn('shrink-0 border-b-2 px-3 py-2.5 text-[10.5px] font-medium whitespace-nowrap transition-colors',
                    lbCategory === c.key ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200')}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5 p-4">
              {LEADERBOARD.map((l) => {
                const aud = AUDIENCE.find((a) => a.initials === l.initials)
                const metric = lbCategory === 'score' ? l.score
                  : lbCategory === 'consistent' ? `${l.streak} streak`
                  : lbCategory === 'accurate'   ? `${l.correct} correct`
                  : lbCategory === 'engaged'    ? `${Math.round((l.score / 840) * 100)}%`
                  : `${(Math.random() * 2 + 1).toFixed(1)}s avg`
                return (
                  <div key={l.rank} className={cn('flex items-center gap-3 rounded-2xl border p-3', l.rank === 1 ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/[0.06] bg-white/[0.03]')}>
                    <div className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold', l.rank === 1 ? 'bg-amber-400 text-white' : l.rank === 2 ? 'bg-slate-500 text-white' : l.rank === 3 ? 'bg-amber-700 text-white' : 'bg-white/[0.08] text-slate-400')}>
                      {l.rank <= 3 ? <Medal className="size-3.5" /> : l.rank}
                    </div>
                    <div className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[9px] font-semibold bg-linear-to-br', aud?.textColor ?? 'text-gray-400', aud?.color ?? 'from-gray-700 to-gray-800')}>{l.initials}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-white">{l.name}</div>
                      <div className="text-[10px] text-slate-400">{l.streak > 0 ? `🔥 ${l.streak}-streak` : 'No streak'}</div>
                    </div>
                    <div className="font-mono text-[13px] font-bold text-amber-300">{metric}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── HOOK NOTIFICATION ──────────────────────────────────────────── */}
      {hookNotif && (
        <div className="fixed top-[68px] right-4 z-50 flex animate-in slide-in-from-right-4 items-start gap-3 rounded-2xl border border-amber-500/30 bg-black/70 px-4 py-3 shadow-2xl backdrop-blur-md">
          <Zap className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] font-bold tracking-widest text-amber-400 uppercase">Hook Ready</div>
            <div className="mt-0.5 text-[12px] text-slate-200">{hookNotif}</div>
          </div>
          <button type="button" onClick={() => setHookNotif(null)} className="mt-0.5 text-slate-500 hover:text-slate-200">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* ── COGNITIVE ALERT ────────────────────────────────────────────── */}
      {alertText && !alertsDisabled && (
        <div className="fixed top-[132px] right-4 z-50 flex animate-in slide-in-from-right-4 items-start gap-3 rounded-2xl border border-violet-500/30 bg-black/70 px-4 py-3 shadow-2xl backdrop-blur-md">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-violet-400" />
          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] font-bold tracking-widest text-violet-400 uppercase">Private · Cognitive alert</div>
            <div className="mt-0.5 text-[12px] text-slate-200">{alertText}</div>
          </div>
          <button type="button" onClick={() => setAlertText(null)} className="mt-0.5 text-slate-500 hover:text-slate-200">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* ── SJT OVERLAY (adaptive 5-step chain) ───────────────────────── */}
      {sjtActive && (() => {
        const node = SJT_NODES[sjtNodeId]
        const correctCount = sjtHistory.filter((h) => h.correct).length
        const visitedStepNumbers = sjtHistory.map((h) => SJT_NODES[h.nodeId]?.step ?? 0)
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md">
            {!sjtDone ? (
              <div className="mx-4 w-full max-w-2xl overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-900 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] font-bold tracking-widest text-amber-400 uppercase">
                        SJT · Step {node.step} of 5 — {node.stepLabel}
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[8.5px] font-semibold text-violet-300">
                        <Sparkles className="size-2.5" />AI Generated
                      </span>
                    </div>
                    <div className="mt-0.5 text-[16px] font-semibold">Situational Judgement Test</div>
                  </div>
                  <button type="button" onClick={() => setSjtActive(false)} className="text-slate-500 hover:text-slate-200">
                    <X className="size-5" />
                  </button>
                </div>

                {/* Progress chain */}
                <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-6 py-3">
                  {[1, 2, 3, 4, 5].map((s) => {
                    const done = visitedStepNumbers.includes(s)
                    const current = node.step === s
                    return (
                      <div key={s} className="flex flex-1 items-center gap-1.5">
                        <div className={cn('grid size-6 place-items-center rounded-full text-[10px] font-bold transition-all',
                          done    ? 'bg-teal-500 text-white' :
                          current ? 'bg-amber-500 text-white ring-2 ring-amber-400/40' :
                                    'bg-white/[0.08] text-slate-500')}>
                          {done ? <Check className="size-3" /> : s}
                        </div>
                        {s < 5 && <div className={cn('h-px flex-1', done ? 'bg-teal-500/50' : 'bg-white/[0.08]')} />}
                      </div>
                    )
                  })}
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-6">
                  {/* Scenario context */}
                  <div className="mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                    <div className="mb-2 text-[9.5px] font-bold tracking-widest text-slate-400 uppercase">
                      {sjtHistory.length === 0 ? 'Clinical Scenario' : 'Evolving Case — Building on previous answers'}
                    </div>
                    <p className="text-[13px] leading-relaxed text-slate-200">{node.scenarioContext}</p>
                  </div>

                  <div className="mb-4 text-[14px] font-semibold text-white">{node.question}</div>

                  <div className="space-y-2">
                    {node.options.map((opt, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => sjtAnswer === null && setSjtAnswer(i)}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left text-[13px] transition-all',
                          sjtAnswer === null
                            ? 'border-white/[0.08] hover:border-teal-500/40 hover:bg-teal-500/[0.06]'
                            : sjtAnswer === i
                              ? i === node.correct
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                              : i === node.correct
                                ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300'
                                : 'border-white/[0.04] opacity-40'
                        )}
                      >
                        <div className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                          sjtAnswer !== null && i === node.correct       ? 'bg-emerald-500 text-white' :
                          sjtAnswer === i && i !== node.correct          ? 'bg-rose-500 text-white' :
                                                                           'bg-white/[0.08]')}>
                          {sjtAnswer !== null && i === node.correct ? <Check className="size-3" /> : String.fromCharCode(65 + i)}
                        </div>
                        {opt}
                      </button>
                    ))}
                  </div>

                  {sjtAnswer !== null && (
                    <div className={cn('mt-4 rounded-2xl border p-4',
                      sjtAnswer === node.correct
                        ? 'border-teal-500/30 bg-teal-500/[0.08]'
                        : 'border-rose-500/30 bg-rose-500/[0.06]')}>
                      <div className={cn('mb-1 text-[9.5px] font-bold tracking-widest uppercase',
                        sjtAnswer === node.correct ? 'text-teal-400' : 'text-rose-400')}>
                        {sjtAnswer === node.correct ? '✅ Correct — Explanation' : '❌ Incorrect — Here is where the reasoning breaks down'}
                      </div>
                      <p className="text-[12.5px] leading-relaxed text-slate-200">
                        {sjtAnswer === node.correct
                          ? node.explanationCorrect
                          : node.explanationWrong[sjtAnswer] || node.explanationCorrect}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-4">
                  <div className="text-[12px] text-slate-400">
                    {sjtAnswer === null ? 'Select an answer to continue the chain' :
                     sjtAnswer === node.correct ? `Step ${node.step} correct · ${correctCount + 1}/${node.step} so far` :
                     'Review the explanation above before continuing'}
                  </div>
                  {sjtAnswer !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        const wasCorrect = sjtAnswer === node.correct
                        setSjtHistory((h) => [...h, { nodeId: sjtNodeId, answer: sjtAnswer, correct: wasCorrect }])
                        const nextId = node.next(sjtAnswer)
                        if (nextId) {
                          setSjtNodeId(nextId)
                          setSjtAnswer(null)
                        } else {
                          setSjtDone(true)
                        }
                      }}
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-700 px-5 text-[13px] font-semibold text-white hover:bg-slate-600"
                    >
                      {node.next(sjtAnswer) ? 'Next question' : 'Finish session'}
                      <ChevronRight className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="mx-4 w-full max-w-lg text-center">
                <div className="mx-auto grid size-20 place-items-center rounded-3xl bg-linear-to-br from-teal-500 to-emerald-500 shadow-[0_20px_40px_-10px_oklch(0.55_0.16_165/0.5)]">
                  <Trophy className="size-9 text-white" />
                </div>
                <h1 className="mt-6 text-[32px] font-bold tracking-tight">Session complete!</h1>
                <p className="mt-2 text-[14px] text-slate-400">{session.title} · {fmtTime(elapsed)} total runtime</p>
                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    { label: 'Avg engagement', value: `${Math.round(engagement)}%` },
                    { label: 'SJT correct',     value: `${correctCount}/${sjtHistory.length}` },
                    { label: 'Top score',        value: `${LEADERBOARD[0].score}` },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] py-4">
                      <div className="text-[22px] font-bold text-teal-300">{s.value}</div>
                      <div className="text-[10.5px] text-slate-400">{s.label}</div>
                    </div>
                  ))}
                </div>
                {/* Chain summary */}
                <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 text-left">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Your reasoning chain</div>
                  <div className="space-y-1.5">
                    {sjtHistory.map((h, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11.5px]">
                        <div className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-bold', h.correct ? 'bg-teal-500 text-white' : 'bg-rose-500 text-white')}>
                          {h.correct ? <Check className="size-2.5" /> : '✕'}
                        </div>
                        <span className="text-slate-300">{SJT_NODES[h.nodeId]?.stepLabel}</span>
                        <span className={cn('ml-auto text-[10px] font-semibold', h.correct ? 'text-teal-400' : 'text-rose-400')}>
                          {h.correct ? 'Correct' : `Option ${String.fromCharCode(65 + h.answer)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 text-left">
                  <div className="mb-3 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">Download session records</div>
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={handleDownloadTranscript} className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-left hover:bg-white/[0.08] transition-colors">
                      <Download className="size-4 shrink-0 text-teal-400" />
                      <div>
                        <div className="text-[12px] font-semibold text-white">Live Transcript</div>
                        <div className="text-[10.5px] text-slate-500">Full text · all languages</div>
                      </div>
                    </button>
                    <button type="button" onClick={handleDownloadTranslation} className="flex items-center gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] px-4 py-3 text-left hover:bg-indigo-500/[0.12] transition-colors">
                      <Languages className="size-4 shrink-0 text-indigo-400" />
                      <div>
                        <div className="text-[12px] font-semibold text-white">Translated Transcript</div>
                        <div className="text-[10.5px] text-slate-500">Non-English entries translated to EN</div>
                      </div>
                    </button>
                  </div>
                </div>
                <Link href={`/session/${session.id}/post`} className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-teal-600 px-8 text-[14px] font-semibold text-white hover:bg-teal-500">
                  Post Conference
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function DockBtn({
  icon, label, onClick, active,
}: {
  icon: React.ReactNode; label: string; onClick?: () => void; active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 transition-colors',
        active === false
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
          : active === true
            ? 'border-teal-500/30 bg-teal-500/10 text-teal-200 hover:bg-teal-500/20'
            : 'border-white/[0.08] bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
      )}
    >
      {icon}
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  )
}
