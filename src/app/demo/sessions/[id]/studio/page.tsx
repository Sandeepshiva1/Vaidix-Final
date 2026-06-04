'use client'

import { useParams, useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Bold,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  FileType,
  Image as ImageIcon,
  Italic,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquareQuote,
  Music,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Type,
  Underline,
  Upload,
  Video,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDemoState } from '@/components/demo/demo-state'
import { SessionHeader } from '@/components/demo/session-header'

// ─── Mock slides ────────────────────────────────────────────────────────────
interface Slide {
  id: string
  title: string
  bullets: string[]
  /** Visually flag a balance issue */
  hint?: 'text-heavy' | 'visual-imbalance' | 'add-poll' | 'add-clinical-q'
}

const MOCK_SLIDES: Slide[] = [
  {
    id: 's1',
    title: 'Diabetic Retinopathy',
    bullets: ['Microvascular complication of DM', 'Leading cause of preventable blindness 25–74y', 'Two main stages: NPDR & PDR'],
  },
  {
    id: 's2',
    title: 'Pathogenesis — Hyperglycaemia cascade',
    bullets: [
      'Loss of pericytes → microaneurysms',
      'Capillary occlusion → ischaemia → VEGF',
      'Neovascularisation → vitreous haemorrhage',
      'BRB breakdown → diabetic macular oedema',
      'Glial activation amplifies inflammation',
      'Long sentence that probably should be split for readability and impact',
    ],
    hint: 'text-heavy',
  },
  {
    id: 's3',
    title: 'NPDR — Staging snapshot',
    bullets: ['Mild: microaneurysms only', 'Moderate: between mild and severe', 'Severe: 4-2-1 rule'],
    hint: 'add-clinical-q',
  },
  {
    id: 's4',
    title: 'Imaging: OCT macula',
    bullets: ['Cystoid spaces', 'Hyperreflective foci', 'DRIL — disorganised retinal inner layers'],
    hint: 'visual-imbalance',
  },
  {
    id: 's5',
    title: 'When to treat?',
    bullets: ['Anti-VEGF first line for centre-involving DME', 'PRP for high-risk PDR', 'Vitrectomy for non-clearing VH'],
    hint: 'add-poll',
  },
  {
    id: 's6',
    title: 'Key takeaways',
    bullets: ['Annual screening saves vision', 'Glycaemic control matters more than any laser', 'Refer early if VA < 6/9'],
  },
]

const MOCK_SCORES = [
  { label: 'Readability', value: 78, hint: 'Could shorten 2 long sentences' },
  { label: 'Text density', value: 64, hint: 'Slide 2 is dense' },
  { label: 'Visual balance', value: 82, hint: 'Slide 4 is left-heavy' },
  { label: 'Font legibility', value: 91, hint: 'Excellent contrast' },
  { label: 'Interaction', value: 42, hint: 'Add at least one poll' },
]

const MOCK_SUGGESTIONS = [
  { title: 'Split slide 2 into 2 slides', body: 'Group pathogenesis into "vascular" and "neovascular" halves.', kind: 'split' },
  { title: 'Add retinal image to slide 4', body: 'Embed an OCT B-scan with DRIL — improves visual balance.', kind: 'image' },
  { title: 'Reduce text density on slide 2', body: 'Convert bullets 4–6 into speaker notes.', kind: 'density' },
  { title: 'Add poll on slide 5', body: '"In your practice, what is your first-line for centre-involving DME?"', kind: 'poll' },
  { title: 'Add clinical question on slide 3', body: 'Show a case photo and ask learners to stage NPDR.', kind: 'clinical' },
  { title: 'Improve hierarchy on slide 6', body: 'Lead with the single most important takeaway in larger type.', kind: 'hierarchy' },
]


const ACCEPTED_TYPES: { kind: 'pdf' | 'pptx' | 'docx' | 'notes'; label: string; ext: string; icon: React.ReactNode }[] = [
  { kind: 'pdf', label: 'PDF', ext: '.pdf', icon: <FileText className="size-4" /> },
  { kind: 'pptx', label: 'PowerPoint', ext: '.pptx', icon: <FileType className="size-4" /> },
  { kind: 'docx', label: 'Word', ext: '.docx', icon: <FileText className="size-4" /> },
  { kind: 'notes', label: 'Notes / Articles', ext: '.txt', icon: <FileText className="size-4" /> },
]

type StudioMode = 'choose' | 'upload' | 'create' | 'myppts'

interface SavedPpt {
  id: string
  name: string
  slides: number
  savedAt: string
  source: 'uploaded' | 'ai-generated'
}

const MOCK_SAVED_PPTS: SavedPpt[] = [
  { id: 'ppt1', name: 'DR Staging & Management — v2.pptx',    slides: 6, savedAt: '2026-05-24', source: 'uploaded' },
  { id: 'ppt2', name: 'Diabetic Maculopathy — AI Enhanced.pptx', slides: 8, savedAt: '2026-05-25', source: 'ai-generated' },
]

// ─── Component ──────────────────────────────────────────────────────────────
export default function StudioPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()
  const { getSession, uploadSources, updateSession, markStep } = useDemoState()
  const session = id ? getSession(id) : undefined

  const [studioMode, setStudioMode] = useState<StudioMode>('choose')
  const [activeTab, setActiveTab] = useState<'analysis' | 'suggestions' | 'ai-slides' | 'hooks'>('analysis')
  const [activeSlideIdx, setActiveSlideIdx] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState(false)
  const [appliedFixes, setAppliedFixes] = useState(false)
  const [ribbonTab, setRibbonTab] = useState<'Home' | 'Insert' | 'Draw' | 'Design' | 'Animations'>('Home')
  const [showPreview, setShowPreview] = useState(false)
  const [docQuery, setDocQuery] = useState('')
  const [docResult, setDocResult] = useState<string | null>(null)
  const [docReaderOpen, setDocReaderOpen] = useState(true)
  const pptInputRef = useRef<HTMLInputElement>(null)
  const keynoteInputRef = useRef<HTMLInputElement>(null)

  const slides = useMemo(() => (generated || session?.hasSources ? MOCK_SLIDES : []), [generated, session?.hasSources])

  if (!session) return null

  if (studioMode === 'choose') {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="border-b border-border/60 bg-background/50 px-0 py-4 backdrop-blur">
          <SessionHeader session={session} backHref={`/demo/sessions/${session.id}/prepare`} eyebrow="Step 1 · My Presentation" />
        </div>
        <div className={cn('mt-8 grid grid-cols-1 gap-5', session.steps.studio ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
          <button
            type="button"
            onClick={() => setStudioMode('upload')}
            className="group relative overflow-hidden rounded-3xl border-2 border-border/60 bg-card p-7 text-left transition-all hover:-translate-y-1 hover:border-teal-500/50 hover:shadow-[0_12px_40px_-15px_oklch(0.45_0.15_165/0.3)]"
          >
            <div className="absolute -top-8 -right-8 size-28 rounded-full bg-teal-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300">
                <Upload className="size-7" />
              </div>
              <h2 className="mt-4 text-[19px] font-semibold tracking-tight">Upload PPT / Keynote</h2>
              <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                Have an existing presentation? Upload it and let Vaidix&apos;s AI enhance readability, add interactions, and flag clinical compliance issues.
              </p>
              <ul className="mt-4 space-y-1.5 text-[12px] text-muted-foreground">
                {['Accepts .pptx, .key, .pdf', 'AI readability & density scoring', '18-rule clinical compliance check', 'One-click fix suggestions'].map((f) => (
                  <li key={f} className="flex items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-teal-500" />{f}</li>
                ))}
              </ul>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStudioMode('create')}
            className="group relative overflow-hidden rounded-3xl border-2 border-border/60 bg-card p-7 text-left transition-all hover:-translate-y-1 hover:border-indigo-500/50 hover:shadow-[0_12px_40px_-15px_oklch(0.45_0.1_260/0.3)]"
          >
            <div className="absolute -top-8 -right-8 size-28 rounded-full bg-indigo-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative">
              <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-indigo-500/15 to-violet-500/10 text-indigo-700 dark:text-indigo-300">
                <Wand2 className="size-7" />
              </div>
              <h2 className="mt-4 text-[19px] font-semibold tracking-tight">Create PPT with AI</h2>
              <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                Upload your source documents — guidelines, journal articles, notes — and let Vaidix build a complete, evidence-grounded presentation for you.
              </p>
              <ul className="mt-4 space-y-1.5 text-[12px] text-muted-foreground">
                {['Grounded in your uploaded sources', 'Custom AI prompt for structure & depth', 'Never hallucinates — cites only your docs', 'Fully editable output'].map((f) => (
                  <li key={f} className="flex items-center gap-2"><span className="size-1.5 shrink-0 rounded-full bg-indigo-500" />{f}</li>
                ))}
              </ul>
            </div>
          </button>

          {session.steps.studio && (
            <button
              type="button"
              onClick={() => setStudioMode('myppts')}
              className="group relative overflow-hidden rounded-3xl border-2 border-emerald-500/40 bg-card p-7 text-left transition-all hover:-translate-y-1 hover:border-emerald-500/70 hover:shadow-[0_12px_40px_-15px_oklch(0.55_0.16_155/0.35)]"
            >
              <div className="absolute -top-8 -right-8 size-28 rounded-full bg-emerald-400/10 opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="relative">
                <div className="flex items-center gap-2">
                  <div className="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-emerald-500/15 to-teal-500/10 text-emerald-700 dark:text-emerald-300">
                    <FileType className="size-7" />
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                    {MOCK_SAVED_PPTS.length} saved
                  </span>
                </div>
                <h2 className="mt-4 text-[19px] font-semibold tracking-tight">My PPTs</h2>
                <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
                  {MOCK_SAVED_PPTS.length} presentation{MOCK_SAVED_PPTS.length !== 1 ? 's' : ''} saved. Edit any version, apply new AI suggestions, or download the enhanced slides.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {MOCK_SAVED_PPTS.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span className="truncate font-medium text-foreground/80">{p.name}</span>
                      <span className="ml-auto shrink-0 tabular-nums">{p.slides} slides</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-3 py-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
                    <Edit3 className="size-3.5" />
                    Edit &amp; manage
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[12px] font-medium text-muted-foreground">
                    <Download className="size-3.5" />
                    Download
                  </span>
                </div>
              </div>
            </button>
          )}
        </div>
      </div>
    )
  }
  if (studioMode === 'myppts') {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="border-b border-border/60 bg-background/50 px-0 py-4 backdrop-blur">
          <SessionHeader session={session} backHref={`/demo/sessions/${session.id}/prepare`} eyebrow="Step 1 · My Presentation" />
        </div>

        <div className="mt-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-[20px] font-semibold tracking-tight">My PPTs</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{MOCK_SAVED_PPTS.length} saved presentations for this session</p>
            </div>
            <button
              type="button"
              onClick={() => setStudioMode('choose')}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[13px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            >
              <Plus className="size-3.5" />
              Add new
            </button>
          </div>

          <div className="space-y-3">
            {MOCK_SAVED_PPTS.map((ppt) => (
              <div
                key={ppt.id}
                className="group flex items-center gap-4 rounded-2xl border border-border/60 bg-card p-4 transition-all hover:border-teal-500/40 hover:shadow-sm"
              >
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-emerald-500/15 to-teal-500/10 text-emerald-700 dark:text-emerald-300">
                  <FileType className="size-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <div className="truncate text-[14px] font-semibold">{ppt.name}</div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      ppt.source === 'ai-generated'
                        ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                        : 'bg-teal-500/10 text-teal-700 dark:text-teal-300'
                    )}>
                      {ppt.source === 'ai-generated' ? 'AI Generated' : 'Uploaded'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11.5px] text-muted-foreground">
                    <span>{ppt.slides} slides</span>
                    <span>·</span>
                    <span>Last saved {ppt.savedAt}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStudioMode('upload')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/8 px-3.5 text-[12px] font-medium text-teal-700 transition-colors hover:bg-teal-500/15 dark:text-teal-300"
                  >
                    <Edit3 className="size-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    <Download className="size-3.5" />
                    Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const activeSlide = slides[activeSlideIdx]
  const hasSources = session.sourceFiles.length > 0
  const canGenerate = hasSources && prompt.trim().length > 5

  const onUploadModeFile = (fileName: string) => {
    uploadSources(session.id, [{ name: fileName, size: '11.8 MB', kind: 'pptx' }])
    setGenerated(true)
    updateSession(session.id, { hasSources: true })
  }

  const onUpload = (kind: 'pdf' | 'pptx' | 'docx' | 'notes') => {
    const fakeName: Record<typeof kind, string> = {
      pdf: 'AAO PPP — Diabetic Retinopathy 2024.pdf',
      pptx: 'My DR lecture v2.pptx',
      docx: 'Departmental DR protocol.docx',
      notes: 'Journal Club notes — Protocol AC.txt',
    }
    const fakeSize: Record<typeof kind, string> = {
      pdf: '4.2 MB',
      pptx: '11.8 MB',
      docx: '0.9 MB',
      notes: '0.1 MB',
    }
    uploadSources(session.id, [{ name: fakeName[kind], size: fakeSize[kind], kind }])
  }

  const generate = () => {
    if (!canGenerate) return
    setGenerating(true)
    setTimeout(() => {
      setGenerating(false)
      setGenerated(true)
      updateSession(session.id, { hasSources: true })
    }, 1600)
  }

  const applyFixes = () => {
    setAppliedFixes(true)
  }

  const finalize = () => {
    markStep(session.id, 'studio', true)
    router.push(`/demo/sessions/${session.id}/prepare`)
  }

  return (
    <div className="-mx-6 -my-8">
      <div className="border-b border-border/60 bg-background/50 px-6 py-4 backdrop-blur">
        <SessionHeader session={session} backHref={`/demo/sessions/${session.id}/prepare`} eyebrow="Step 1 · My Presentation" />
      </div>

      <div className="grid h-[calc(100vh-180px)] min-h-[640px] grid-cols-[300px_1fr_360px] gap-0">
        {/* ── LEFT panel ─────────────────────────────────────────────── */}
        <aside className="flex h-full flex-col border-r border-border/60 bg-background/30">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="text-[12.5px] font-semibold">Source material</div>
            {hasSources && <span className="text-[11px] text-emerald-600 dark:text-emerald-300">{session.sourceFiles.length} file{session.sourceFiles.length > 1 ? 's' : ''}</span>}
          </div>

          {/* Upload */}
          <div className="space-y-3 border-b border-border/60 p-4">
            {studioMode === 'upload' ? (
              <div className="space-y-2">
                <div className="text-[11.5px] font-medium text-muted-foreground">Choose your presentation file</div>
                <input
                  type="file"
                  accept=".pptx,.ppt"
                  ref={pptInputRef}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadModeFile(f.name) }}
                />
                <button
                  type="button"
                  onClick={() => pptInputRef.current?.click()}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-border/60 bg-background/70 px-3 py-2.5 text-[12.5px] font-medium text-foreground/80 transition-colors hover:border-teal-500/40 hover:bg-teal-500/5"
                >
                  <FileType className="size-4 text-orange-500" />
                  PowerPoint (.pptx)
                  <Upload className="ml-auto size-3.5 opacity-50" />
                </button>
                <input
                  type="file"
                  accept=".key"
                  ref={keynoteInputRef}
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadModeFile(f.name) }}
                />
                <button
                  type="button"
                  onClick={() => keynoteInputRef.current?.click()}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-border/60 bg-background/70 px-3 py-2.5 text-[12.5px] font-medium text-foreground/80 transition-colors hover:border-teal-500/40 hover:bg-teal-500/5"
                >
                  <FileType className="size-4 text-blue-500" />
                  Keynote (.key)
                  <Upload className="ml-auto size-3.5 opacity-50" />
                </button>
              </div>
            ) : (
              <div className="group relative rounded-2xl border-2 border-dashed border-border/60 bg-foreground/[0.02] p-4 text-center transition-colors hover:border-teal-500/40 hover:bg-teal-500/5">
                <Upload className="mx-auto size-6 text-muted-foreground group-hover:text-teal-600 dark:group-hover:text-teal-300" />
                <div className="mt-2 text-[12.5px] font-medium">Drop files or pick a type</div>
                <div className="text-[10.5px] text-muted-foreground">PDF · PPT · Word · Notes · Guidelines</div>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {ACCEPTED_TYPES.map((t) => (
                    <button
                      key={t.kind}
                      type="button"
                      onClick={() => onUpload(t.kind)}
                      className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 px-2 py-1.5 text-[11.5px] font-medium text-foreground/80 transition-colors hover:bg-foreground/5"
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Uploaded list */}
            {session.sourceFiles.length > 0 && (
              <ul className="space-y-1.5">
                {session.sourceFiles.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-2.5 py-2 text-[12px]"
                  >
                    <div className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground/5 text-muted-foreground">
                      <FileText className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate font-medium">{f.name}</div>
                      <div className="text-[10.5px] text-muted-foreground">{f.size} · {f.kind.toUpperCase()}</div>
                    </div>
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Slide thumbs */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <div className="text-[12.5px] font-semibold">Slides</div>
              <span className="text-[11px] text-muted-foreground">{slides.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {slides.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 bg-foreground/[0.02] p-4 text-center">
                  <Wand2 className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-2 text-[11.5px] text-muted-foreground">Slides appear here once you upload sources and prompt Vaidix to generate.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {slides.map((s, i) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setActiveSlideIdx(i)}
                        className={cn(
                          'group relative w-full overflow-hidden rounded-xl border text-left transition-all',
                          activeSlideIdx === i
                            ? 'border-teal-500/50 ring-2 ring-teal-500/20'
                            : 'border-border/60 hover:border-foreground/20'
                        )}
                      >
                        <div className="flex aspect-video items-start gap-1.5 bg-linear-to-br from-white via-teal-50/30 to-emerald-50/20 p-2.5 dark:from-card dark:to-card">
                          <span className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[9.5px] font-semibold tabular-nums">{i + 1}</span>
                          <span className="line-clamp-3 text-[10.5px] font-medium leading-tight text-foreground/80">{s.title}</span>
                        </div>
                        {s.hint && (
                          <span className="absolute right-1.5 bottom-1.5 size-2 rounded-full bg-amber-400 ring-2 ring-background" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Document Reader */}
          {session.sourceFiles.length > 0 && (
            <div className="shrink-0 border-t border-border/60">
              <button
                type="button"
                onClick={() => setDocReaderOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-foreground/4"
              >
                <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                  <BookOpen className="size-3.5 text-indigo-600 dark:text-indigo-300" />
                  Document Reader
                </div>
                <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', docReaderOpen && 'rotate-180')} />
              </button>
              {docReaderOpen && (
                <div className="space-y-2 px-3 pb-3">
                  <div className="flex gap-1.5">
                    <input
                      value={docQuery}
                      onChange={(e) => setDocQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        const q = docQuery.toLowerCase()
                        const match = Object.entries(DOC_RESULTS).find(([k]) => q.includes(k))
                        setDocResult(match ? match[1] : 'No matching content found. Try keywords like "VEGF", "NPDR", "treatment", or "staging".')
                      }}
                      placeholder="Find page, paragraph… (press Enter)"
                      className="flex-1 rounded-xl border border-border/60 bg-background/60 px-2.5 py-1.5 text-[11.5px] outline-none focus:border-teal-500/50"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const q = docQuery.toLowerCase()
                        const match = Object.entries(DOC_RESULTS).find(([k]) => q.includes(k))
                        setDocResult(match ? match[1] : 'No matching content found. Try keywords like "VEGF", "NPDR", "treatment", or "staging".')
                      }}
                      className="grid size-8 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20 dark:text-indigo-300"
                    >
                      <Search className="size-3.5" />
                    </button>
                  </div>
                  {docResult && (
                    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-2.5 text-[11px] leading-snug text-foreground/80">
                      <p>{docResult}</p>
                      <button
                        type="button"
                        onClick={() => setDocResult(null)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-indigo-700"
                      >
                        <Plus className="size-3" />
                        Add to slide
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ── CENTER ─────────────────────────────────────────────────── */}
        <section className="flex h-full min-w-0 flex-col bg-linear-to-br from-slate-50/60 via-background to-teal-50/30 dark:from-background dark:to-background">
          {/* Prompt bar / upload status */}
          <div className="border-b border-border/60 bg-background/60 px-6 py-4 backdrop-blur">
            {studioMode === 'upload' ? (
              hasSources ? (
                <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
                    Presentation uploaded — Vaidix is analysing your slides
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background px-3.5 py-2.5">
                  <Upload className="size-4 shrink-0 text-muted-foreground" />
                  <span className="text-[13px] text-muted-foreground">
                    Upload your PPT or Keynote in the left panel — slides will appear here instantly
                  </span>
                </div>
              )
            ) : (
              <>
                <div className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background p-1.5 pl-3.5 shadow-sm focus-within:border-teal-500/50 focus-within:ring-3 focus-within:ring-teal-500/15">
                  <Sparkles className="size-4 shrink-0 text-teal-600 dark:text-teal-300" />
                  <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      hasSources
                        ? 'Create presentation on diabetic retinopathy using uploaded source material…'
                        : 'Upload source material first to unlock prompting'
                    }
                    disabled={!hasSources}
                    className="h-9 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={generate}
                    disabled={!canGenerate || generating}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium transition-all',
                      canGenerate && !generating
                        ? 'bg-slate-700 text-white shadow-sm hover:scale-[1.02]'
                        : 'cursor-not-allowed bg-foreground/10 text-muted-foreground'
                    )}
                  >
                    {generating ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Generating
                      </>
                    ) : (
                      <>
                        <Wand2 className="size-3.5" />
                        Generate
                      </>
                    )}
                  </button>
                </div>
                {!hasSources && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">
                    <Lightbulb className="size-3.5" />
                    Vaidix only generates from your verified sources — clinical guidelines, journal articles, your notes.
                  </p>
                )}
              </>
            )}
          </div>

          {/* PowerPoint-style ribbon */}
          {slides.length > 0 && (
            <div className="shrink-0 border-b border-border/60 bg-white/95 dark:bg-background/95">
              <div className="flex items-center gap-0 border-b border-border/40 px-2">
                {(['Home', 'Insert', 'Draw', 'Design', 'Animations'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setRibbonTab(tab)}
                    className={cn(
                      'px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-foreground/5',
                      ribbonTab === tab ? 'border-b-2 border-teal-500 text-teal-700 dark:text-teal-300' : 'text-muted-foreground'
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {ribbonTab === 'Home' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5">
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <RibbonBtn icon={<Bold className="size-3.5" />} label="Bold" />
                  <RibbonBtn icon={<Italic className="size-3.5" />} label="Italic" />
                  <RibbonBtn icon={<Underline className="size-3.5" />} label="Underline" />
                </div>
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <RibbonBtn icon={<Type className="size-3.5" />} label="Font" />
                  <select className="h-6 rounded border border-border/60 bg-background px-1 text-[10.5px] text-foreground/80 outline-none">
                    <option>24</option><option>28</option><option>32</option><option>36</option>
                  </select>
                </div>
                <div className="flex items-center gap-0.5 border-r border-border/60 pr-2">
                  <RibbonBtn icon={<ImageIcon className="size-3.5" />} label="Insert image" />
                  <RibbonBtn icon={<BarChart3 className="size-3.5" />} label="Insert chart" />
                  <RibbonBtn icon={<Zap className="size-3.5" />} label="Insert hook" active onClick={() => setActiveTab('hooks')} />
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button type="button" className="inline-flex h-6 items-center gap-1 rounded border border-border/60 bg-background/60 px-2 text-[10.5px] font-medium text-muted-foreground hover:bg-foreground/5">
                    <Eye className="size-3" />
                    Present
                  </button>
                </div>
              </div>
              )}
              {ribbonTab === 'Insert' && (
              <div className="flex items-center gap-2 px-3 py-1.5">
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex items-center gap-0.5">
                    <RibbonBtn icon={<ImageIcon className="size-3.5" />} label="Image" />
                    <RibbonBtn icon={<Video className="size-3.5" />} label="Video" />
                    <RibbonBtn icon={<Music className="size-3.5" />} label="Audio" />
                    <RibbonBtn icon={<ExternalLink className="size-3.5" />} label="Hyperlink" />
                  </div>
                  <div className="flex gap-2 text-[9px] text-muted-foreground">
                    <span className="w-6 text-center">Image</span>
                    <span className="w-6 text-center">Video</span>
                    <span className="w-6 text-center">Audio</span>
                    <span className="w-9 text-center">Hyperlink</span>
                  </div>
                </div>
                <div className="mx-2 h-8 w-px bg-border/60" />
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex items-center gap-0.5">
                    <RibbonBtn icon={<BarChart3 className="size-3.5" />} label="Chart" />
                    <RibbonBtn icon={<Type className="size-3.5" />} label="Text box" />
                    <RibbonBtn icon={<Zap className="size-3.5" />} label="Hook" onClick={() => setActiveTab('hooks')} />
                  </div>
                  <div className="flex gap-2 text-[9px] text-muted-foreground">
                    <span className="w-6 text-center">Chart</span>
                    <span className="w-6 text-center">Text</span>
                    <span className="w-6 text-center">Hook</span>
                  </div>
                </div>
              </div>
              )}
              {(ribbonTab === 'Draw' || ribbonTab === 'Design' || ribbonTab === 'Animations') && (
              <div className="flex h-9 items-center px-3 text-[11.5px] text-muted-foreground">
                {ribbonTab} tools coming soon
              </div>
              )}
            </div>
          )}

          {/* Canvas */}
          <div className="min-h-0 flex-1 overflow-auto p-8">
            {slides.length === 0 ? (
              <div className="grid h-full place-items-center">
                <div className="max-w-md text-center">
                  <div className="mx-auto grid size-14 place-items-center rounded-3xl bg-linear-to-br from-teal-500/15 to-emerald-500/10 text-teal-700 dark:text-teal-300">
                    <Wand2 className="size-7" />
                  </div>
                  <h3 className="mt-4 text-[18px] font-semibold tracking-tight">Upload source material to begin</h3>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    Vaidix uses your guidelines, notes, and references to generate a presentation grounded in evidence — never hallucinated content.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl">
                <div className="mb-3 flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>Slide {activeSlideIdx + 1} of {slides.length}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveSlideIdx((i) => Math.max(0, i - 1))}
                      className="grid size-7 place-items-center rounded-md border border-border/60 bg-background/60 hover:bg-foreground/5 disabled:opacity-30"
                      disabled={activeSlideIdx === 0}
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
                      className="grid size-7 place-items-center rounded-md border border-border/60 bg-background/60 hover:bg-foreground/5 disabled:opacity-30"
                      disabled={activeSlideIdx === slides.length - 1}
                    >
                      <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </div>

                <div className="relative aspect-video overflow-hidden rounded-3xl border border-border/60 bg-white p-8 shadow-[0_30px_60px_-30px_oklch(0.45_0.15_165/0.25)] dark:bg-card">
                  {/* slide content */}
                  <div className="flex h-full flex-col">
                    <div className="text-[11px] font-semibold tracking-widest text-teal-700/80 uppercase dark:text-teal-300/80">
                      {session.specialty}
                    </div>
                    <h2 className="mt-1 text-[26px] font-semibold tracking-tight">{activeSlide.title}</h2>
                    <ul className="mt-5 space-y-2.5 text-[15px] text-foreground/85">
                      {activeSlide.bullets.map((b, i) => (
                        <li key={i} className="flex gap-2.5">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-500" />
                          {b}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-3 text-[10.5px] text-muted-foreground">
                      <span>{session.title}</span>
                      <span>Slide {activeSlideIdx + 1} / {slides.length}</span>
                    </div>
                  </div>

                  {/* Floating AI annotations */}
                  {activeSlide.hint === 'text-heavy' && !appliedFixes && (
                    <FloatingAnnotation
                      position="top-right"
                      color="amber"
                      icon={<BarChart3 className="size-3.5" />}
                      label="Text density high"
                      hint="Move bullets 4–6 to speaker notes"
                    />
                  )}
                  {activeSlide.hint === 'visual-imbalance' && !appliedFixes && (
                    <FloatingAnnotation
                      position="middle-left"
                      color="indigo"
                      icon={<ImageIcon className="size-3.5" />}
                      label="Balance left-heavy"
                      hint="Add an OCT image on the right"
                    />
                  )}
                  {activeSlide.hint === 'add-poll' && !appliedFixes && (
                    <FloatingAnnotation
                      position="bottom-right"
                      color="teal"
                      icon={<MessageSquareQuote className="size-3.5" />}
                      label="Suggest poll here"
                      hint='"First-line for centre-involving DME?"'
                    />
                  )}
                  {activeSlide.hint === 'add-clinical-q' && !appliedFixes && (
                    <FloatingAnnotation
                      position="top-left"
                      color="emerald"
                      icon={<ListChecks className="size-3.5" />}
                      label="Add clinical question"
                      hint="Show a fundus photo, ask learners to stage"
                    />
                  )}

                  {appliedFixes && (
                    <div className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-3" />
                      AI fixes applied
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="border-t border-border/60 bg-background/80 px-6 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Eye className="size-3.5" />
                Faculty preview mode
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={applyFixes}
                  disabled={slides.length === 0 || appliedFixes}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/8 px-3.5 text-[12.5px] font-medium text-teal-700 transition-colors hover:bg-teal-500/15 disabled:opacity-50 dark:text-teal-300"
                >
                  <Wand2 className="size-3.5" />
                  Apply AI Fixes
                </button>
                <button className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3.5 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
                  <Download className="size-3.5" />
                  Export Enhanced
                </button>
                <button className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3.5 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
                  <Save className="size-3.5" />
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  disabled={slides.length === 0}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-700 px-4 text-[12.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                >
                  Finalize Slides
                  <ArrowRight className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── RIGHT panel ────────────────────────────────────────────── */}
        <aside className="flex h-full flex-col border-l border-border/60 bg-background/30">
          {/* Tabs */}
          <div className="flex items-center gap-0 border-b border-border/60 px-2 pt-2">
            {([
              { key: 'analysis',  label: 'Analysis' },
              { key: 'suggestions', label: 'Fixes' },
              { key: 'ai-slides', label: 'AI Slides' },
              { key: 'hooks',     label: 'Hooks' },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  'relative flex items-center gap-1 px-2.5 pb-2.5 pt-1 text-[12px] font-medium transition-colors',
                  activeTab === t.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t.key === 'hooks' && <Zap className="size-3 text-amber-500" />}
                {t.key === 'ai-slides' && <Sparkles className="size-3 text-indigo-500" />}
                {t.label}
                {activeTab === t.key && <span className="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-linear-to-r from-teal-500 to-emerald-500" />}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {slides.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-foreground/[0.02] p-5 text-center text-[12px] text-muted-foreground">
                Once Vaidix generates your deck, AI analysis appears here.
              </div>
            ) : activeTab === 'analysis' ? (
              <AnalysisTab />
            ) : activeTab === 'suggestions' ? (
              <SuggestionsTab onApply={applyFixes} appliedAll={appliedFixes} />
            ) : activeTab === 'ai-slides' ? (
              <AISlidesTab />
            ) : (
              <HooksTab activeSlideIdx={activeSlideIdx} />
            )}
          </div>
        </aside>
      </div>

      {/* ── FINALIZE PREVIEW MODAL ─────────────────────────────────────── */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-white shadow-2xl dark:bg-card" style={{ maxHeight: '90vh' }}>
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-6 py-4">
              <div>
                <div className="text-[17px] font-semibold tracking-tight">Preview — {session.title}</div>
                <div className="text-[12px] text-muted-foreground">{slides.length} slides · Review before finalising</div>
              </div>
              <button type="button" onClick={() => setShowPreview(false)} className="grid size-8 place-items-center rounded-full hover:bg-foreground/8">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4 overflow-y-auto p-6">
              {slides.map((s, i) => (
                <div
                  key={s.id}
                  onClick={() => { setActiveSlideIdx(i); setShowPreview(false) }}
                  className={cn('cursor-pointer overflow-hidden rounded-2xl border transition-all hover:border-teal-500/50 hover:shadow-md', activeSlideIdx === i ? 'border-teal-500/60 ring-2 ring-teal-500/20' : 'border-border/60')}
                >
                  <div className="flex aspect-video flex-col bg-linear-to-br from-white via-teal-50/30 to-emerald-50/20 p-3 dark:from-card dark:to-card">
                    <div className="text-[8px] font-semibold tracking-widest text-teal-700/70 uppercase dark:text-teal-300/70">{session.specialty}</div>
                    <div className="mt-0.5 text-[11px] font-semibold leading-tight">{s.title}</div>
                    <ul className="mt-1.5 space-y-0.5">
                      {s.bullets.slice(0, 3).map((b, j) => (
                        <li key={j} className="flex gap-1.5 text-[8.5px] text-foreground/70">
                          <span className="mt-1 size-1 shrink-0 rounded-full bg-teal-500" />{b}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto text-[7.5px] text-muted-foreground">Slide {i + 1} / {slides.length}</div>
                  </div>
                  {s.hint && !appliedFixes && (
                    <div className="border-t border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                      AI suggestion pending
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border/60 px-6 py-4">
              <button type="button" onClick={() => setShowPreview(false)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-4 text-[13px] font-medium text-muted-foreground hover:bg-foreground/5">
                Back to edit
              </button>
              <button
                type="button"
                onClick={() => { setShowPreview(false); finalize() }}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-700 px-5 text-[13px] font-medium text-white shadow-sm hover:bg-slate-600"
              >
                <CheckCircle2 className="size-4" />
                Confirm &amp; Finalise
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const AI_RULES: { category: string; rules: { label: string; pass: boolean }[] }[] = [
  {
    category: 'Readability',
    rules: [
      { label: 'Max 6 lines per slide', pass: false },
      { label: 'Sentence length ≤ 20 words', pass: false },
      { label: 'Font size ≥ 24pt for body text', pass: true },
      { label: 'No jargon without definition', pass: true },
    ],
  },
  {
    category: 'Cognitive Load',
    rules: [
      { label: 'One concept per slide', pass: false },
      { label: 'Bullet count ≤ 5 per slide', pass: false },
      { label: 'Consistent visual hierarchy', pass: true },
      { label: 'Progressive disclosure used', pass: false },
    ],
  },
  {
    category: 'Engagement',
    rules: [
      { label: 'At least 1 poll per 10 slides', pass: false },
      { label: 'Clinical Q present on case slides', pass: false },
      { label: 'Reflection prompt at end', pass: true },
    ],
  },
  {
    category: 'Visual Balance',
    rules: [
      { label: 'Images on >40% of slides', pass: false },
      { label: 'No left-only text layout', pass: false },
      { label: 'Consistent colour palette', pass: true },
    ],
  },
  {
    category: 'Clinical Compliance',
    rules: [
      { label: 'Drug doses cite a reference', pass: true },
      { label: 'Guidelines named with year', pass: true },
      { label: 'No unapproved off-label claims', pass: true },
    ],
  },
]

// ─── Right-panel tab contents ──────────────────────────────────────────────
function AnalysisTab() {
  const [showRules, setShowRules] = useState(false)
  return (
    <div className="space-y-3.5">
      <div>
        <div className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">Deck-level metrics</div>
        <div className="space-y-2.5">
          {MOCK_SCORES.map((m) => (
            <div key={m.label} className="rounded-2xl border border-border/60 bg-background/60 p-3.5">
              <div className="flex items-center justify-between">
                <div className="text-[12.5px] font-medium">{m.label}</div>
                <div className="font-mono text-[13px] font-semibold tabular-nums">{m.value}</div>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/5">
                <div
                  className={cn(
                    'h-full rounded-full',
                    m.value >= 80
                      ? 'bg-linear-to-r from-emerald-500 to-teal-500'
                      : m.value >= 60
                        ? 'bg-linear-to-r from-amber-400 to-amber-500'
                        : 'bg-linear-to-r from-rose-400 to-rose-500'
                  )}
                  style={{ width: `${m.value}%` }}
                />
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">{m.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 18 AI Rules */}
      <div>
        <button
          type="button"
          onClick={() => setShowRules((v) => !v)}
          className="flex w-full items-center justify-between rounded-2xl border border-border/60 bg-background/60 px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/4"
        >
          <div className="flex items-center gap-2 text-[12.5px] font-semibold">
            <Sparkles className="size-3.5 text-teal-600 dark:text-teal-300" />
            18 AI Rules Check
            <span className="ml-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300">8 failed</span>
          </div>
          <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        </button>

        {showRules && (
          <div className="mt-2 space-y-3">
            {AI_RULES.map((cat) => (
              <div key={cat.category} className="rounded-2xl border border-border/60 bg-background/60 p-3">
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{cat.category}</div>
                <ul className="space-y-1.5">
                  {cat.rules.map((r) => (
                    <li key={r.label} className="flex items-center gap-2 text-[11.5px]">
                      {r.pass
                        ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                        : <span className="size-3.5 shrink-0 rounded-full border-2 border-rose-400" />}
                      <span className={r.pass ? 'text-foreground/80' : 'text-rose-700 dark:text-rose-300'}>{r.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-3.5">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-teal-700 dark:text-teal-300" />
          <div>
            <div className="text-[12.5px] font-semibold">Vaidix summary</div>
            <p className="mt-1 text-[12px] leading-snug text-foreground/80">
              Strong content, clear hierarchy. Two slides feel text-heavy and you have zero interactive moments —
              your learners will disengage around slide 4. We&apos;ve queued 6 specific fixes for you.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function SuggestionsTab({ onApply, appliedAll }: { onApply: () => void; appliedAll: boolean }) {
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onApply}
        disabled={appliedAll}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-linear-to-r from-teal-500 to-emerald-500 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
      >
        <Wand2 className="size-3.5" />
        {appliedAll ? 'All fixes applied' : 'Apply all AI fixes'}
      </button>

      <div className="space-y-2.5">
        {MOCK_SUGGESTIONS.map((s, i) => {
          const ok = accepted[i] || appliedAll
          return (
            <div
              key={i}
              className={cn(
                'rounded-2xl border bg-background/60 p-3 transition-all',
                ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/60'
              )}
            >
              <div className="flex items-start gap-2">
                <div
                  className={cn(
                    'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md',
                    ok ? 'bg-emerald-500 text-white' : 'bg-foreground/5 text-muted-foreground'
                  )}
                >
                  {ok ? <CheckCircle2 className="size-3.5" /> : <Lightbulb className="size-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold leading-snug">{s.title}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{s.body}</div>
                  {!ok && (
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setAccepted((m) => ({ ...m, [i]: true }))}
                        className="inline-flex h-7 items-center gap-1 rounded-lg bg-slate-700 px-2.5 text-[11px] font-medium text-white"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-foreground/5"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AISlidesTab() {
  const [added, setAdded] = useState<Record<string, boolean>>({})
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-[11px] text-indigo-700 dark:text-indigo-300">
        <Sparkles className="mr-1 inline-block size-3" />
        AI-generated slides based on your source material — click to add any to your deck.
      </div>

      {AI_SLIDE_SUGGESTIONS.map((s) => {
        const isAdded = added[s.id]
        return (
          <div
            key={s.id}
            className={cn(
              'rounded-2xl border bg-background/60 p-3 transition-all',
              isAdded ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/60'
            )}
          >
            <div className="flex items-start gap-2">
              <div className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-[9px] font-semibold', isAdded ? 'bg-emerald-500 text-white' : 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300')}>
                {isAdded ? <CheckCircle2 className="size-3.5" /> : <Sparkles className="size-3" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold leading-snug">{s.title}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{s.layout} layout</div>
                <div className="mt-1 text-[11px] leading-snug text-foreground/70">{s.description}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-foreground/6 px-2 py-0.5 text-[9.5px] font-medium text-muted-foreground">{tag}</span>
                  ))}
                </div>
                {!isAdded && (
                  <button
                    type="button"
                    onClick={() => setAdded((m) => ({ ...m, [s.id]: true }))}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
                  >
                    <Plus className="size-3" />
                    Add to deck
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const HOOK_TYPES = [
  { kind: 'poll',       label: 'Live Poll',       color: 'bg-teal-500/10 text-teal-700 dark:text-teal-300' },
  { kind: 'tf',         label: 'True / False',     color: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  { kind: 'open',       label: 'Open question',    color: 'bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  { kind: 'reflection', label: 'Reflection',       color: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
]

const MOCK_HOOKS: { slide: number; kind: string; label: string }[] = [
  { slide: 5, kind: 'poll', label: 'First-line therapy for centre-involving DME?' },
  { slide: 3, kind: 'tf',   label: 'Severe NPDR always requires immediate PRP — True or False?' },
]

const AI_SLIDE_SUGGESTIONS = [
  {
    id: 'ai1',
    title: 'Pathogenesis — Simplified',
    layout: 'Two-column',
    description: 'VEGF cascade on left · clinical correlate fundus image on right',
    tags: ['Slide 2', 'Visual fix'],
  },
  {
    id: 'ai2',
    title: 'DME Grading (ETDRS)',
    layout: 'Table',
    description: 'Mild / moderate / severe criteria with OCT icons per row',
    tags: ['New slide', 'Evidence-based'],
  },
  {
    id: 'ai3',
    title: 'When to Refer — Decision Tree',
    layout: 'Flowchart',
    description: 'VA threshold → DME status → PDR staging → action',
    tags: ['Slide 5', 'Clinical Q'],
  },
  {
    id: 'ai4',
    title: 'Anti-VEGF Comparison',
    layout: 'Table',
    description: 'Ranibizumab vs Bevacizumab vs Aflibercept — efficacy, cost, dosing',
    tags: ['New slide', 'Guidelines 2024'],
  },
]

const DOC_RESULTS: Record<string, string> = {
  vegf:       '"Vascular endothelial growth factor (VEGF) is the primary mediator of neovascularisation in PDR, upregulated by retinal ischaemia." — Page 14, AAO PPP 2024',
  npdr:       '"The 4-2-1 rule defines severe NPDR: haemorrhages in all 4 quadrants, venous beading in ≥2 quadrants, or IRMA in ≥1 quadrant." — Page 8, AAO PPP 2024',
  treatment:  '"Anti-VEGF agents (ranibizumab, bevacizumab, aflibercept) are first-line for centre-involving DME with vision loss." — Page 22, AAO PPP 2024',
  staging:    '"DR staging follows the ETDRS classification: mild NPDR (microaneurysms only) → moderate → severe → PDR." — Page 6, AAO PPP 2024',
  dme:        '"Diabetic macular oedema is defined as retinal thickening within 500 µm of the foveal centre on stereoscopic fundus photography or OCT." — Page 11, AAO PPP 2024',
}

function HooksTab({ activeSlideIdx }: { activeSlideIdx: number }) {
  const [hooks, setHooks] = useState(MOCK_HOOKS)
  const [adding, setAdding] = useState(false)
  const [newKind, setNewKind] = useState('poll')
  const [newLabel, setNewLabel] = useState('')
  const slideNum = activeSlideIdx + 1

  const addHook = () => {
    if (!newLabel.trim()) return
    setHooks((h) => [...h, { slide: slideNum, kind: newKind, label: newLabel.trim() }])
    setNewLabel('')
    setAdding(false)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
        <Zap className="mr-1 inline-block size-3" />
        Hooks trigger real-time learner responses during your live session.
      </div>

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-amber-500/30 bg-amber-500/[0.02] px-3 py-2.5 text-[12.5px] font-medium text-amber-700 hover:bg-amber-500/5 dark:text-amber-300"
      >
        <Plus className="size-3.5" />
        Add hook to slide {slideNum}
      </button>

      {adding && (
        <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-[11.5px] font-semibold">New hook — Slide {slideNum}</div>
          <div className="flex flex-wrap gap-1.5">
            {HOOK_TYPES.map((ht) => (
              <button
                key={ht.kind}
                type="button"
                onClick={() => setNewKind(ht.kind)}
                className={cn('rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors', newKind === ht.kind ? ht.color + ' border-current/30' : 'border-border/60 text-muted-foreground')}
              >
                {ht.label}
              </button>
            ))}
          </div>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Enter your question…"
            className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-[12px] outline-none focus:border-teal-500/50"
          />
          <div className="flex gap-1.5">
            <button type="button" onClick={addHook} className="flex-1 rounded-xl bg-slate-700 py-1.5 text-[12px] font-medium text-white hover:bg-slate-600">Save hook</button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-xl border border-border/60 px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-foreground/5">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {hooks.map((h, i) => {
          const ht = HOOK_TYPES.find((t) => t.kind === h.kind)
          return (
            <div key={i} className={cn('rounded-2xl border border-border/60 bg-background/60 p-3', h.slide !== slideNum && 'opacity-50')}>
              <div className="flex items-center gap-2">
                <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase', ht?.color ?? '')}>{ht?.label ?? h.kind}</span>
                <span className="text-[11px] text-muted-foreground">Slide {h.slide}</span>
              </div>
              <div className="mt-1.5 text-[12.5px] font-medium">{h.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Ribbon button ─────────────────────────────────────────────────────────
function RibbonBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-6 place-items-center rounded transition-colors',
        active ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      )}
    >
      {icon}
    </button>
  )
}

// ─── Floating annotation ───────────────────────────────────────────────────
function FloatingAnnotation({
  position,
  color,
  icon,
  label,
  hint,
}: {
  position: 'top-left' | 'top-right' | 'middle-left' | 'bottom-right'
  color: 'amber' | 'indigo' | 'teal' | 'emerald'
  icon: React.ReactNode
  label: string
  hint?: string
}) {
  const posClass: Record<typeof position, string> = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'middle-left': 'top-1/2 left-4 -translate-y-1/2',
    'bottom-right': 'bottom-6 right-6',
  }
  const colorClass: Record<typeof color, string> = {
    amber: 'bg-amber-50 ring-amber-500/30 text-amber-800',
    indigo: 'bg-indigo-50 ring-indigo-500/30 text-indigo-800',
    teal: 'bg-teal-50 ring-teal-500/30 text-teal-800',
    emerald: 'bg-emerald-50 ring-emerald-500/30 text-emerald-800',
  }
  return (
    <div
      className={cn(
        'absolute z-10 flex max-w-[210px] animate-in fade-in items-start gap-2 rounded-2xl px-3 py-2 shadow-md ring-1 ring-inset backdrop-blur',
        posClass[position],
        colorClass[color]
      )}
    >
      <div className="mt-0.5">{icon}</div>
      <div className="min-w-0 leading-tight">
        <div className="text-[11px] font-semibold">{label}</div>
        {hint && <div className="mt-0.5 text-[10.5px] opacity-80">{hint}</div>}
      </div>
      <button className="-mt-1 -mr-1 ml-auto opacity-60 hover:opacity-100">
        <X className="size-3" />
      </button>
    </div>
  )
}
