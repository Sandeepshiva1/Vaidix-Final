'use client'

import { notFound, useParams, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Camera,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDemoState, type DemoSession } from '@/components/demo/demo-state'
import { SessionHeader } from '@/components/demo/session-header'
import { formatDemoDate } from '@/components/demo/date'

type Format = 'flyer' | 'teaser' | 'whatsapp' | 'instagram' | 'reels'

const FORMATS: { id: Format; label: string; sub: string; icon: React.ReactNode; aspect: string }[] = [
  { id: 'flyer', label: 'Flyer', sub: 'A4 print + share', icon: <FileText className="size-4" />, aspect: 'aspect-[3/4]' },
  { id: 'teaser', label: 'Promo Teaser Video', sub: '30-sec vertical', icon: <Video className="size-4" />, aspect: 'aspect-[9/16]' },
  { id: 'whatsapp', label: 'WhatsApp Banner', sub: '1:1 square', icon: <MessageCircle className="size-4" />, aspect: 'aspect-square' },
  { id: 'instagram', label: 'Instagram Post', sub: '4:5 portrait', icon: <Camera className="size-4" />, aspect: 'aspect-[4/5]' },
  { id: 'reels', label: 'Instagram Reel', sub: '15-sec vertical', icon: <Video className="size-4" />, aspect: 'aspect-[9/16]' },
]

export default function PromoPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()
  const { getSession, updateSession, markStep } = useDemoState()
  const session = id ? getSession(id) : undefined

  const [selected, setSelected] = useState<Format[]>(['flyer', 'whatsapp'])
  const [regenerating, setRegenerating] = useState<Format | null>(null)
  const [variant, setVariant] = useState(0)
  const [approved, setApproved] = useState<Set<Format>>(new Set(session?.promoApproved as Format[] ?? []))
  const [sent, setSent] = useState(session?.promoSent ?? false)

  if (!session) {
    if (typeof window !== 'undefined') return null
    return notFound()
  }

  const toggle = (f: Format) =>
    setSelected((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))

  const selectAll = () => setSelected(FORMATS.map((f) => f.id))

  const regen = (f: Format) => {
    setRegenerating(f)
    setTimeout(() => {
      setVariant((v) => (v + 1) % 3)
      setRegenerating(null)
    }, 900)
  }

  const approve = (f: Format) => setApproved((s) => new Set(s).add(f))

  const send = () => {
    setSent(true)
    updateSession(session.id, { promoSent: true, promoApproved: Array.from(approved) })
    markStep(session.id, 'promo', true)
    setTimeout(() => router.push(`/demo/sessions/${session.id}/prepare`), 600)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <SessionHeader session={session} backHref={`/demo/sessions/${session.id}/prepare`} eyebrow="Step 3 · Invitations & Teasers" />

      {/* Format selector */}
      <div className="mb-6 rounded-3xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[14.5px] font-semibold tracking-tight">Choose promo formats</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Vaidix generates each from your session details. Pick one, several, or all.
            </p>
          </div>
          <button
            type="button"
            onClick={selectAll}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3.5 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <Sparkles className="size-3.5" />
            Select all
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {FORMATS.map((f) => {
            const on = selected.includes(f.id)
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                className={cn(
                  'flex items-start gap-2.5 rounded-2xl border p-3 text-left transition-all',
                  on
                    ? 'border-teal-500/50 bg-teal-500/8 ring-1 ring-teal-500/20'
                    : 'border-border/60 bg-background/60 hover:border-foreground/15'
                )}
              >
                <div
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-xl',
                    on ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300' : 'bg-foreground/5 text-muted-foreground'
                  )}
                >
                  {f.icon}
                </div>
                <div className="min-w-0">
                  <div className={cn('text-[12.5px] font-semibold', on && 'text-teal-700 dark:text-teal-300')}>{f.label}</div>
                  <div className="text-[10.5px] text-muted-foreground">{f.sub}</div>
                </div>
                {on && (
                  <CheckCircle2 className="ml-auto size-4 shrink-0 text-teal-600 dark:text-teal-300" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Preview grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
        {selected.map((f) => {
          const fmt = FORMATS.find((x) => x.id === f)!
          return (
            <article key={f} className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                  <span className="text-teal-700 dark:text-teal-300">{fmt.icon}</span>
                  {fmt.label}
                  {approved.has(f) && (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-3" /> Approved
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => regen(f)}
                    disabled={regenerating === f}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
                  >
                    {regenerating === f ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    Regenerate
                  </button>
                  {!approved.has(f) ? (
                    <button
                      type="button"
                      onClick={() => approve(f)}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-emerald-500 px-2.5 text-[11px] font-medium text-white hover:bg-emerald-500/90"
                    >
                      Approve
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setApproved((s) => {
                          const n = new Set(s)
                          n.delete(f)
                          return n
                        })
                      }
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-foreground/5"
                    >
                      Undo
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4">
                <div className={cn('relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl shadow-md', fmt.aspect)}>
                  <PromoMock format={f} session={session} variant={variant} regenerating={regenerating === f} />
                </div>
              </div>
            </article>
          )
        })}

        {selected.length === 0 && (
          <div className="col-span-full grid h-48 place-items-center rounded-3xl border-2 border-dashed border-border/60 bg-foreground/[0.02] text-center text-[13px] text-muted-foreground">
            <div>
              <ImageIcon className="mx-auto size-7" />
              <p className="mt-2">Pick at least one format above to see AI-generated previews.</p>
            </div>
          </div>
        )}
      </div>

      {/* Send */}
      <div className="mt-6 flex flex-col gap-3 rounded-3xl border border-teal-500/20 bg-linear-to-br from-white via-teal-50/30 to-emerald-50/30 p-5 dark:from-card dark:via-card dark:to-card md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[14px] font-semibold tracking-tight">{sent ? 'Promo sent to learners ✓' : 'Ready to share?'}</div>
          <p className="text-[12px] text-muted-foreground">
            {approved.size > 0
              ? `${approved.size} approved · will go to 142 learners across 3 cohorts.`
              : 'Approve at least one asset above to enable Send.'}
          </p>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={approved.size === 0 || sent}
          className={cn(
            'inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-medium transition-all',
            approved.size === 0 || sent
              ? 'cursor-not-allowed bg-foreground/10 text-muted-foreground'
              : 'bg-slate-700 text-white shadow-sm hover:scale-[1.02]'
          )}
        >
          {sent ? <CheckCircle2 className="size-4" /> : <Send className="size-4" />}
          {sent ? 'Sent — continue' : 'Send to learners'}
          {!sent && <ArrowRight className="size-4" />}
        </button>
      </div>
    </div>
  )
}

// ─── Mock promo artwork (pure SVG/CSS so it feels real) ───────────────────
function PromoMock({
  format,
  session,
  variant,
  regenerating,
}: {
  format: Format
  session: DemoSession
  variant: number
  regenerating: boolean
}) {
  const palettes: { from: string; to: string; accent: string; tag: string }[] = [
    { from: 'from-teal-500', to: 'to-emerald-600', accent: 'text-teal-100', tag: 'Vaidix Live' },
    { from: 'from-sky-600', to: 'to-indigo-600', accent: 'text-sky-100', tag: 'Vaidix Live' },
    { from: 'from-emerald-500', to: 'to-cyan-600', accent: 'text-emerald-50', tag: 'Vaidix Live' },
  ]
  const p = palettes[variant % palettes.length]

  const dateStr = useMemo(
    () => formatDemoDate(session.date, { weekday: 'short', day: 'numeric', month: 'short' }),
    [session.date],
  )

  const titleLine = session.title.split('—')[0].trim()

  return (
    <div className={cn('absolute inset-0 flex flex-col justify-between bg-linear-to-br p-5 text-white', p.from, p.to, regenerating && 'animate-pulse')}>
      {/* shimmering grid pattern */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.12]" style={{ backgroundImage: 'radial-gradient(circle at 20px 20px, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      <div className="pointer-events-none absolute -top-12 -right-12 size-44 rounded-full bg-white/10 blur-3xl" />

      <div className="relative">
        <div className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[9.5px] font-semibold tracking-wider uppercase backdrop-blur">
          <Sparkles className="size-2.5" />
          {p.tag}
        </div>
        <div className="mt-3 text-[10px] font-semibold tracking-widest uppercase opacity-80">{session.specialty}</div>
        <h3 className={cn('mt-1 leading-[1.05] font-semibold tracking-tight', format === 'flyer' ? 'text-[28px]' : 'text-[22px]')}>
          {titleLine}
        </h3>
      </div>

      <div className="relative space-y-2">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-1 text-[10px] font-medium backdrop-blur">
          <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          {dateStr} · {session.time} · {session.duration} min
        </div>
        <div className="text-[10.5px] opacity-85">{session.type} · Hosted on Vaidix</div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] font-semibold tracking-wider uppercase opacity-70">vaidix.live/{session.id}</span>
          <div className="grid size-8 place-items-center rounded-md bg-white/95 p-1">
            <svg viewBox="0 0 32 32" className="size-full text-foreground">
              {/* fake QR */}
              {[...Array(64)].map((_, i) => {
                const x = (i % 8) * 4
                const y = Math.floor(i / 8) * 4
                const on = (i * 7 + variant) % 3 === 0
                return on ? <rect key={i} x={x} y={y} width="3" height="3" fill="currentColor" /> : null
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
