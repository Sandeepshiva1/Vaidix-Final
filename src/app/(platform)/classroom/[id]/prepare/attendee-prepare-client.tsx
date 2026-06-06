'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import {
  ArrowRight, BookOpen, Brain, CheckCircle2, ChevronDown, ChevronUp,
  CircleDashed, Clock, ExternalLink, FileText, HelpCircle, Image,
  Layers, MessageCircle, Play, Sparkles, Trophy, Video, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { PreQuestionsBoard } from '@/components/classroom/pre-questions-board'

// ─── Types ────────────────────────────────────────────────────────────────────

interface McqQuestion { id: string; q: string; options: string[]; optionCount: number }
interface OeQuestion  { id: string; q: string }
interface QuizResponseMap {
  [qId: string]: { answer: number; answerText?: string | null; isCorrect?: boolean | null }
}
interface StudyMaterial {
  linkId: string; documentId: string; title: string; kind: string; mimeType: string; viewUrl: string
}
interface Flashcard   { q: string; a: string }
interface MicroItem   { kind: string; title: string; dur: string }
interface Infographic { title: string; sub: string }
interface PreCase {
  id: string; caseTemplateId: string; title: string; condition: string
  difficulty: string; bloomsLevel: number; estimatedMinutes: number
  required: boolean; rank: number; myStatus: string | null
}

interface Props {
  sessionId: string
  sessionTitle: string
  description: string
  scheduledStart: string
  scheduledEnd: string
  presenterName: string
  status: string
  deck: { documentId: string; viewUrl: string; title: string; mimeType: string } | null
  studyMaterials: StudyMaterial[]
  mcqs: McqQuestion[]
  openEnded: OeQuestion[]
  responseMap: QuizResponseMap
  viewedLinkIds: string[]
  hasAskedQuestion: boolean
  questionCount: number
  currentUserId: string
  flashcards: Flashcard[]
  microlearning: MicroItem[]
  infographics: Infographic[]
  preCases: PreCase[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}
function countdown(iso: string) {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'Starting now'
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000)
  if (d > 1) return `${d} days to go`; if (d === 1) return 'Tomorrow'
  if (h > 0) return `${h}h ${m}m to go`; return 'Very soon'
}

const DIFFICULTY_COLOR: Record<string, string> = {
  BEGINNER:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  INTERMEDIATE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  ADVANCED:     'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
}

type Tab = 'overview' | 'materials' | 'flashcards' | 'microlearning' | 'infographics' | 'simulations' | 'quiz' | 'questions'

// ─── Main Component ───────────────────────────────────────────────────────────

export function AttendeePrepareDashboard({
  sessionId, sessionTitle, description, scheduledStart, presenterName,
  deck, studyMaterials, mcqs, openEnded, responseMap: initialResponseMap,
  viewedLinkIds, hasAskedQuestion, questionCount, currentUserId,
  flashcards, microlearning, infographics, preCases,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [responseMap, setResponseMap] = useState<QuizResponseMap>(initialResponseMap)
  const [openAnswers, setOpenAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set())
  const [expandedInfographic, setExpandedInfographic] = useState<number | null>(null)
  const [, startTransition] = useTransition()
  // Inline document viewer — shown in a full-screen overlay (no new tab)
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null)

  const totalQuestions   = mcqs.length + openEnded.length
  const answeredCount    = Object.keys(responseMap).length
  const totalMaterials   = studyMaterials.length + (deck ? 1 : 0)
  const materialsViewed  = viewedLinkIds.length
  const casesStarted     = preCases.filter((p) => p.myStatus !== null).length
  const casesCompleted   = preCases.filter((p) => p.myStatus === 'COMPLETED').length

  // Readiness checklist
  const checklist = [
    { label: `Viewed presentation`, done: !!deck && viewedLinkIds.includes('deck'), hidden: !deck },
    { label: `Study materials (${materialsViewed}/${totalMaterials})`, done: materialsViewed >= totalMaterials && totalMaterials > 0, hidden: totalMaterials === 0 },
    { label: `Flashcards (${flippedCards.size}/${flashcards.length})`, done: flippedCards.size >= flashcards.length && flashcards.length > 0, hidden: flashcards.length === 0 },
    { label: `Simulations (${casesCompleted}/${preCases.length})`, done: casesCompleted >= preCases.length && preCases.length > 0, hidden: preCases.length === 0 },
    { label: `Pre-quiz (${answeredCount}/${totalQuestions})`, done: answeredCount >= totalQuestions && totalQuestions > 0, hidden: totalQuestions === 0 },
    { label: 'Asked a question', done: hasAskedQuestion },
  ].filter((c) => !c.hidden)

  const readinessPct = checklist.length === 0 ? 100 : Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100)

  // ALL tabs always visible — empty states shown when no content yet
  const TABS: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'overview',      label: 'Overview',      icon: <Sparkles className="size-3.5" /> },
    { key: 'materials',     label: 'Study Pack',    icon: <BookOpen className="size-3.5" />, badge: totalMaterials || undefined },
    { key: 'flashcards',    label: 'Flashcards',    icon: <Layers className="size-3.5" />, badge: flashcards.length || undefined },
    { key: 'microlearning', label: 'Microlearning', icon: <Video className="size-3.5" />,  badge: microlearning.length || undefined },
    { key: 'infographics',  label: 'Infographics',  icon: <Image className="size-3.5" />,  badge: infographics.length || undefined },
    { key: 'simulations',   label: 'Simulations',   icon: <Brain className="size-3.5" />,  badge: preCases.length || undefined },
    { key: 'quiz',          label: 'Pre-Quiz',      icon: <Trophy className="size-3.5" />, badge: totalQuestions || undefined },
    { key: 'questions',     label: 'Questions',     icon: <MessageCircle className="size-3.5" />, badge: questionCount || undefined },
  ]

  const submitResponse = async (questionId: string, answer: number, answerText?: string) => {
    setSubmitting(questionId)
    try {
      const csrf = document.cookie.match(/vaidix-csrf=([^;]+)/)?.[1] ?? ''
      const res = await fetch(`/api/classroom/sessions/${sessionId}/learners/quiz-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) },
        body: JSON.stringify({ questionId, answer, answerText }),
      })
      const json = await res.json() as { ok: boolean; data?: { isCorrect?: boolean | null }; error?: { message: string } }
      if (!json.ok) { toast.error(json.error?.message ?? 'Failed to save'); return }
      setResponseMap((prev) => ({ ...prev, [questionId]: { answer, answerText, isCorrect: json.data?.isCorrect ?? null } }))
      toast.success('Answer saved!')
    } catch { toast.error('Network error — try again.') }
    finally { setSubmitting(null) }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <Clock className="size-3.5" />Pre-Conference Preparation
        </div>
        <h1 className="text-[26px] font-bold tracking-tight leading-tight">{sessionTitle}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
          <span>{formatDate(scheduledStart)} · {formatTime(scheduledStart)}</span>
          <span>·</span>
          <span>Presenter: <span className="font-medium text-foreground">{presenterName}</span></span>
          <span className="rounded-full bg-teal-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-teal-700 dark:text-teal-300">{countdown(scheduledStart)}</span>
        </div>
        {description && <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground leading-relaxed">{description}</p>}
      </div>

      {/* Readiness card */}
      <div className="mb-6 rounded-3xl border border-border/60 bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] font-semibold">Your Readiness</div>
          <div className="font-mono text-[24px] font-bold text-teal-700 dark:text-teal-300">{readinessPct}%</div>
        </div>
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-foreground/5">
          <div className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500 transition-[width] duration-700 ease-out" style={{ width: `${readinessPct}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {checklist.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-[12px]">
              {item.done ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" /> : <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className={item.done ? 'text-foreground' : 'text-muted-foreground'}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Inline document viewer overlay */}
      {viewer && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-card px-4">
            <button type="button" onClick={() => setViewer(null)} className="grid size-8 place-items-center rounded-full border border-border/60 hover:bg-foreground/5">
              <span className="text-[18px] leading-none text-muted-foreground">×</span>
            </button>
            <span className="truncate text-[13.5px] font-semibold">{viewer.title}</span>
          </div>
          <iframe src={viewer.url} className="flex-1 w-full border-0" title={viewer.title} allow="fullscreen" />
        </div>
      )}

      {/* Finalized deck banner */}
      {deck && (
        <button type="button"
          onClick={() => setViewer({ url: deck.viewUrl, title: deck.title })}
          className="mb-6 w-full flex items-center gap-4 rounded-3xl border border-teal-500/30 bg-teal-500/5 p-5 text-left transition-all hover:bg-teal-500/10">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-teal-500/15 text-teal-700 dark:text-teal-300"><FileText className="size-6" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-widest text-teal-600 dark:text-teal-400">Finalized Presentation</div>
            <div className="mt-0.5 truncate text-[15px] font-semibold">{deck.title}</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">By {presenterName} · Click to view inline</div>
          </div>
          <Play className="size-4 shrink-0 text-teal-600 dark:text-teal-400" />
        </button>
      )}

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-0.5 overflow-x-auto rounded-2xl border border-border/60 bg-card p-1 scrollbar-hide">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn('flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium transition-all',
              tab === t.key ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}>
            {t.icon}{t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', tab === t.key ? 'bg-background/20 text-background' : 'bg-foreground/10')}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ───────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {totalMaterials > 0 && <StatCard icon={<BookOpen className="size-4 text-blue-600" />} label="Study materials" value={`${materialsViewed}/${totalMaterials}`} sub="viewed" color="blue" onClick={() => setTab('materials')} />}
            {flashcards.length > 0 && <StatCard icon={<Layers className="size-4 text-violet-600" />} label="Flashcards" value={`${flippedCards.size}/${flashcards.length}`} sub="reviewed" color="violet" onClick={() => setTab('flashcards')} />}
            {microlearning.length > 0 && <StatCard icon={<Video className="size-4 text-rose-600" />} label="Microlearning" value={`${microlearning.length}`} sub="modules" color="rose" onClick={() => setTab('microlearning')} />}
            {infographics.length > 0 && <StatCard icon={<Image className="size-4 text-orange-600" />} label="Infographics" value={`${infographics.length}`} sub="charts" color="orange" onClick={() => setTab('infographics')} />}
            {preCases.length > 0 && <StatCard icon={<Brain className="size-4 text-indigo-600" />} label="Simulations" value={`${casesCompleted}/${preCases.length}`} sub="done" color="indigo" onClick={() => setTab('simulations')} />}
            {totalQuestions > 0 && <StatCard icon={<Trophy className="size-4 text-amber-600" />} label="Pre-Quiz" value={`${answeredCount}/${totalQuestions}`} sub="answered" color="amber" onClick={() => setTab('quiz')} />}
            <StatCard icon={<MessageCircle className="size-4 text-teal-600" />} label="Q&A" value={`${questionCount}`} sub={hasAskedQuestion ? 'question asked' : 'ask presenter'} color="teal" onClick={() => setTab('questions')} />
          </div>

          <div className="rounded-3xl border border-border/60 bg-card p-5">
            <h3 className="mb-3 text-[13.5px] font-semibold">Pre-session checklist</h3>
            <ol className="space-y-2.5">
              {deck && <CheckRow num={1} label="Read the finalized presentation" done={viewedLinkIds.includes('deck')} action={<button type="button" onClick={() => setViewer({ url: deck.viewUrl, title: deck.title })} className="text-[12px] text-teal-700 dark:text-teal-300 hover:underline flex items-center gap-1">View <Play className="size-3" /></button>} />}
              {totalMaterials > 0 && <CheckRow num={2} label={`Study ${totalMaterials} material${totalMaterials !== 1 ? 's' : ''}`} done={materialsViewed >= totalMaterials} action={<button type="button" onClick={() => setTab('materials')} className="text-[12px] text-teal-700 dark:text-teal-300 hover:underline">Open <ArrowRight className="size-3 inline" /></button>} />}
              {flashcards.length > 0 && <CheckRow num={3} label={`Review ${flashcards.length} flashcard${flashcards.length !== 1 ? 's' : ''}`} done={flippedCards.size >= flashcards.length} action={<button type="button" onClick={() => setTab('flashcards')} className="text-[12px] text-teal-700 dark:text-teal-300 hover:underline">Start <ArrowRight className="size-3 inline" /></button>} />}
              {preCases.length > 0 && <CheckRow num={4} label={`Complete ${preCases.length} simulation${preCases.length !== 1 ? 's' : ''}`} done={casesCompleted >= preCases.length} action={<button type="button" onClick={() => setTab('simulations')} className="text-[12px] text-teal-700 dark:text-teal-300 hover:underline">Start <ArrowRight className="size-3 inline" /></button>} />}
              {totalQuestions > 0 && <CheckRow num={5} label={`Answer ${totalQuestions} pre-quiz question${totalQuestions !== 1 ? 's' : ''}`} done={answeredCount >= totalQuestions} action={<button type="button" onClick={() => setTab('quiz')} className="text-[12px] text-teal-700 dark:text-teal-300 hover:underline">Start <ArrowRight className="size-3 inline" /></button>} />}
              <CheckRow num={6} label="Ask the presenter a question" done={hasAskedQuestion} action={<button type="button" onClick={() => setTab('questions')} className="text-[12px] text-teal-700 dark:text-teal-300 hover:underline">Ask <ArrowRight className="size-3 inline" /></button>} />
            </ol>
          </div>
        </div>
      )}

      {/* ── STUDY PACK ─────────────────────────────────────────────────────── */}
      {tab === 'materials' && (
        <div className="space-y-4">
          {deck && (
            <SectionBlock title="Presentation">
              <button type="button" onClick={() => setViewer({ url: deck.viewUrl, title: deck.title })}
                className="w-full flex items-center gap-3 rounded-2xl border border-teal-500/30 bg-teal-500/5 px-4 py-3.5 hover:bg-teal-500/10 transition text-left">
                <FileText className="size-5 text-teal-600 shrink-0" />
                <div className="flex-1 min-w-0"><div className="truncate text-[14px] font-semibold">{deck.title}</div><div className="text-[12px] text-muted-foreground">Finalized by {presenterName} · Opens inline</div></div>
                <Play className="size-4 text-teal-600 shrink-0" />
              </button>
            </SectionBlock>
          )}
          {studyMaterials.length > 0 ? (
            <SectionBlock title="Pre-reads & Videos">
              {studyMaterials.map((m) => {
                const viewed = viewedLinkIds.includes(m.linkId)
                return (
                  <button key={m.linkId} type="button"
                    onClick={() => setViewer({ url: m.viewUrl, title: m.title })}
                    className={cn('w-full flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition', viewed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/60 bg-card hover:bg-foreground/5')}>
                    {m.kind === 'VIDEO' ? <Play className="size-4 text-indigo-500 shrink-0" /> : <FileText className="size-4 text-blue-500 shrink-0" />}
                    <div className="flex-1 min-w-0"><div className="truncate text-[13.5px] font-medium">{m.title}</div><div className="text-[11.5px] text-muted-foreground">{m.kind} · Opens inline</div></div>
                    {viewed ? <CheckCircle2 className="size-4 text-emerald-500 shrink-0" /> : <Play className="size-3.5 text-muted-foreground shrink-0" />}
                  </button>
                )
              })}
            </SectionBlock>
          ) : totalMaterials === 0 && (
            <EmptyState>The presenter hasn&apos;t uploaded study materials yet. Check back closer to the session.</EmptyState>
          )}
        </div>
      )}

      {/* ── FLASHCARDS ─────────────────────────────────────────────────────── */}
      {tab === 'flashcards' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div><h2 className="text-[17px] font-semibold">Flashcards</h2>
              <p className="text-[12.5px] text-muted-foreground">
                {flashcards.length > 0 ? `Click a card to reveal the answer. ${flippedCards.size}/${flashcards.length} reviewed.` : 'AI-generated flashcards from the presenter\'s materials.'}
              </p>
            </div>
          </div>
          {flashcards.length === 0 ? (
            <EmptyState icon={<Layers className="size-8 opacity-30" />}>
              The presenter hasn&apos;t generated flashcards yet — they&apos;ll appear here once available. Check back closer to the session.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {flashcards.map((card, i) => {
                const flipped = flippedCards.has(i)
                return (
                  <button key={i} type="button" onClick={() => setFlippedCards((prev) => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })}
                    className={cn('rounded-3xl border p-5 text-left transition-all hover:shadow-md min-h-30', flipped ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/60 bg-card hover:border-violet-500/30')}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-2 text-muted-foreground">{flipped ? 'Answer' : 'Question'}</div>
                    <p className={cn('text-[13.5px] font-medium leading-snug', flipped ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground')}>{flipped ? card.a : card.q}</p>
                    <div className="mt-3 text-[11px] text-muted-foreground">{flipped ? '↩ Click to see question' : '→ Click to reveal answer'}</div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── MICROLEARNING ──────────────────────────────────────────────────── */}
      {tab === 'microlearning' && (
        <div className="space-y-4">
          <div><h2 className="text-[17px] font-semibold">Microlearning Modules</h2><p className="text-[12.5px] text-muted-foreground">Bite-sized learning prepared by the presenter.</p></div>
          {microlearning.length === 0 ? (
            <EmptyState icon={<Video className="size-8 opacity-30" />}>
              No microlearning modules yet — the presenter can generate these from the Prepare Learners step.
            </EmptyState>
          ) : microlearning.map((item, i) => (
            <div key={i} className="flex items-center gap-4 rounded-3xl border border-border/60 bg-card p-5">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-rose-500/10 text-rose-600"><Video className="size-6" /></div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-[14px] font-semibold">{item.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10.5px] capitalize">{item.kind}</span>
                  <span>{item.dur}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── INFOGRAPHICS ───────────────────────────────────────────────────── */}
      {tab === 'infographics' && (
        <div className="space-y-4">
          <div><h2 className="text-[17px] font-semibold">Infographics</h2><p className="text-[12.5px] text-muted-foreground">Visual summaries of key concepts for this session.</p></div>
          {infographics.length === 0 ? (
            <EmptyState icon={<Image className="size-8 opacity-30" />}>
              No infographics yet — the presenter can generate visual summaries from the Prepare Learners step.
            </EmptyState>
          ) : infographics.map((item, i) => (
            <button key={i} type="button" onClick={() => setExpandedInfographic(expandedInfographic === i ? null : i)}
              className="w-full flex items-center gap-4 rounded-3xl border border-border/60 bg-card p-5 text-left hover:border-orange-500/30 transition">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-orange-500/10 text-orange-600"><Image className="size-6" /></div>
              <div className="flex-1 min-w-0"><div className="truncate text-[14px] font-semibold">{item.title}</div><div className="text-[12px] text-muted-foreground">{item.sub}</div></div>
              {expandedInfographic === i ? <ChevronUp className="size-4 text-muted-foreground shrink-0" /> : <ChevronDown className="size-4 text-muted-foreground shrink-0" />}
            </button>
          ))}
        </div>
      )}

      {/* ── SIMULATIONS ────────────────────────────────────────────────────── */}
      {tab === 'simulations' && (
        <div className="space-y-4">
          <div><h2 className="text-[17px] font-semibold">Case Simulations</h2><p className="text-[12.5px] text-muted-foreground">Work through these cases before the session to build clinical reasoning.</p></div>
          {preCases.map((c) => {
            const done = c.myStatus === 'COMPLETED'
            const started = c.myStatus !== null && !done
            return (
              <div key={c.id} className={cn('rounded-3xl border p-5', done ? 'border-emerald-500/30 bg-emerald-500/5' : started ? 'border-teal-500/30 bg-teal-500/5' : 'border-border/60 bg-card')}>
                <div className="flex items-start gap-4">
                  <div className={cn('grid size-11 shrink-0 place-items-center rounded-2xl', done ? 'bg-emerald-500 text-white' : 'bg-indigo-500/10 text-indigo-600')}>
                    {done ? <CheckCircle2 className="size-5" /> : <Brain className="size-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-[14.5px] font-semibold">{c.title}</span>
                      {c.required && <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">Required</span>}
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', DIFFICULTY_COLOR[c.difficulty] ?? 'bg-foreground/8 text-muted-foreground')}>{c.difficulty}</span>
                    </div>
                    <div className="text-[12.5px] text-muted-foreground">{c.condition}</div>
                    <div className="mt-1 text-[11.5px] text-muted-foreground">~{c.estimatedMinutes} min · Bloom&apos;s L{c.bloomsLevel}</div>
                  </div>
                  <Link href={`/cases/${c.caseTemplateId}`} className={cn('shrink-0 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium transition-all', done ? 'border border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10' : 'bg-slate-700 text-white shadow-sm hover:scale-[1.02]')}>
                    {done ? 'Revisit' : started ? 'Continue' : 'Start'}
                  </Link>
                </div>
              </div>
            )
          })}
          {preCases.length === 0 && <EmptyState>No case simulations linked to this session.</EmptyState>}
        </div>
      )}

      {/* ── PRE-QUIZ ───────────────────────────────────────────────────────── */}
      {tab === 'quiz' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div><h2 className="text-[17px] font-semibold">Knowledge Priming Quiz</h2>
              <p className="text-[12.5px] text-muted-foreground">{totalQuestions > 0 ? `Set by ${presenterName} · ${answeredCount}/${totalQuestions} answered` : 'Questions set by the presenter to test your readiness.'}</p>
            </div>
          </div>
          {totalQuestions === 0 && (
            <EmptyState icon={<Trophy className="size-8 opacity-30" />}>
              No quiz questions yet — the presenter can configure a Knowledge Priming Quiz in the Prepare Learners step.
            </EmptyState>
          )}
          {mcqs.map((q, qi) => {
            const resp = responseMap[q.id]
            const answered = resp !== undefined
            return (
              <div key={q.id} className={cn('rounded-3xl border p-5', answered ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/60 bg-card')}>
                <div className="mb-3 flex items-start gap-3">
                  <div className={cn('grid size-7 shrink-0 place-items-center rounded-xl text-[12px] font-bold', answered ? 'bg-emerald-500 text-white' : 'bg-foreground/8 text-muted-foreground')}>
                    {answered ? <CheckCircle2 className="size-4" /> : qi + 1}
                  </div>
                  <p className="text-[14.5px] font-medium leading-snug flex-1">{q.q}</p>
                </div>
                <div className="space-y-2 pl-10">
                  {q.options.map((opt, oi) => {
                    const selected = resp?.answer === oi
                    const correct = answered && selected && resp?.isCorrect === true
                    const wrong   = answered && selected && resp?.isCorrect === false
                    return (
                      <button key={oi} type="button" disabled={submitting === q.id}
                        onClick={() => void submitResponse(q.id, oi)}
                        className={cn('w-full flex items-center gap-3 rounded-2xl border px-4 py-2.5 text-left text-[13px] transition-all',
                          correct ? 'border-emerald-500/50 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300' :
                          wrong   ? 'border-rose-500/50 bg-rose-500/10 text-rose-600' :
                          selected ? 'border-teal-500/50 bg-teal-500/8 font-medium' :
                          'border-border/60 hover:border-teal-500/40 hover:bg-teal-500/5')}>
                        <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold',
                          correct ? 'border-emerald-500 bg-emerald-500 text-white' :
                          wrong   ? 'border-rose-500 bg-rose-500 text-white' :
                          selected ? 'border-teal-500 bg-teal-500/20 text-teal-700' : 'border-border/60')}>
                          {String.fromCharCode(65 + oi)}
                        </span>
                        {opt}
                      </button>
                    )
                  })}
                  {answered && resp?.isCorrect !== null && (
                    <p className={cn('text-[12px] font-medium mt-1 pl-1', resp.isCorrect ? 'text-emerald-600' : 'text-rose-600')}>
                      {resp.isCorrect ? '✓ Correct!' : `✗ Not quite — the answer was submitted. Review during the session.`}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
          {openEnded.map((q, qi) => {
            const resp  = responseMap[q.id]
            const draft = openAnswers[q.id] ?? resp?.answerText ?? ''
            return (
              <div key={q.id} className={cn('rounded-3xl border p-5', resp ? 'border-blue-500/30 bg-blue-500/5' : 'border-border/60 bg-card')}>
                <div className="mb-3 flex items-start gap-3">
                  <div className={cn('grid size-7 shrink-0 place-items-center rounded-xl text-[12px] font-bold', resp ? 'bg-blue-500 text-white' : 'bg-foreground/8 text-muted-foreground')}>
                    {resp ? <CheckCircle2 className="size-4" /> : mcqs.length + qi + 1}
                  </div>
                  <p className="text-[14.5px] font-medium leading-snug flex-1">{q.q}</p>
                </div>
                <div className="pl-10 space-y-2">
                  <textarea rows={3} value={draft} onChange={(e) => setOpenAnswers((p) => ({ ...p, [q.id]: e.target.value }))} placeholder="Type your answer…"
                    className="w-full resize-none rounded-2xl border border-border/60 bg-background px-4 py-3 text-[13px] outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/30" />
                  <button type="button" disabled={!draft.trim() || submitting === q.id} onClick={() => void submitResponse(q.id, -1, draft.trim())}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-700 px-4 text-[12.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-40">
                    {resp ? 'Update answer' : 'Submit answer'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── QUESTIONS ──────────────────────────────────────────────────────── */}
      {tab === 'questions' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-[17px] font-semibold">Pre-Session Questions</h2>
            <p className="text-[13px] text-muted-foreground">Your questions go directly to the presenter&apos;s dashboard — they&apos;re ranked by votes.</p>
          </div>
          <PreQuestionsBoard sessionId={sessionId} currentUserId={currentUserId} />
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color, onClick }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string; onClick?: () => void
}) {
  const bg: Record<string, string> = { blue: 'bg-blue-500/8 hover:border-blue-500/40', violet: 'bg-violet-500/8 hover:border-violet-500/40', rose: 'bg-rose-500/8 hover:border-rose-500/40', orange: 'bg-orange-500/8 hover:border-orange-500/40', indigo: 'bg-indigo-500/8 hover:border-indigo-500/40', amber: 'bg-amber-500/8 hover:border-amber-500/40', teal: 'bg-teal-500/8 hover:border-teal-500/40' }
  return (
    <button type="button" onClick={onClick} className={cn('flex items-start gap-2.5 rounded-2xl border border-border/60 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm', bg[color] ?? '')}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div><div className="text-[11px] font-medium text-muted-foreground">{label}</div><div className="text-[18px] font-bold tabular-nums">{value}</div><div className="text-[11px] text-muted-foreground">{sub}</div></div>
    </button>
  )
}

function CheckRow({ num, label, done, action }: { num: number; label: string; done: boolean; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <div className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold', done ? 'bg-emerald-500 text-white' : 'bg-foreground/8 text-muted-foreground')}>
        {done ? <CheckCircle2 className="size-3.5" /> : num}
      </div>
      <span className={cn('flex-1 text-[13px]', done ? 'line-through text-muted-foreground' : 'text-foreground')}>{label}</span>
      {!done && action}
    </li>
  )
}

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function EmptyState({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-border/60 p-10 text-center text-[13px] text-muted-foreground">
      <div className="mx-auto mb-3 flex justify-center">{icon ?? <HelpCircle className="size-8 opacity-30" />}</div>
      {children}
    </div>
  )
}
