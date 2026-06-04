'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  WifiOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ensureCsrfHeaders } from '@/lib/csrf-client'
import { SessionHeader } from '@/components/medlearn/session-header'
import type { SessionView } from '@/lib/medlearn/session-view'

type Format = 'flyer' | 'teaser' | 'whatsapp' | 'instagram' | 'reels'

// The image generator (promo-service) produces these three SVG templates.
export type PromoTemplate = 'flyer' | 'whatsapp_banner' | 'instagram_card'

// The two VIDEO formats are backed by the async PROMO_TEASER_VIDEO render. Both
// the demo "teaser" and "reels" formats POST { video } and poll one Document.
const VIDEO_FORMATS = ['teaser', 'reels'] as const
type VideoFormat = (typeof VIDEO_FORMATS)[number]
function isVideoFormat(f: Format): f is VideoFormat {
  return (VIDEO_FORMATS as readonly string[]).includes(f)
}
// Demo format → the route's video id (the route knows 'teaser' | 'reel').
const VIDEO_REQUEST: Record<VideoFormat, 'teaser' | 'reel'> = {
  teaser: 'teaser',
  reels: 'reel',
}

type TeaserStatus = 'RENDERING' | 'READY' | 'FAILED'

export interface TeaserVideoAsset {
  format: 'teaser' | 'reel'
  documentId: string
  title: string
  status: TeaserStatus
  videoUrl: string | null
  failureReason: string | null
  createdAt: string
}

export interface PromoMeta {
  selected: PromoTemplate[]
  approved: PromoTemplate[]
  sent: boolean
  updatedAt: string
}

export interface PromoAsset {
  template: PromoTemplate
  documentId: string
  title: string
  svgUrl: string
  createdAt: string
}

export interface PromoBootstrap {
  meta: PromoMeta
  assets: PromoAsset[]
  teaserVideo: TeaserVideoAsset | null
  storageOffline: boolean
}

// Demo format ↔ real template bridge. Video formats have no IMAGE template.
const FORMAT_TEMPLATE: Record<Format, PromoTemplate | null> = {
  flyer: 'flyer',
  whatsapp: 'whatsapp_banner',
  instagram: 'instagram_card',
  teaser: null,
  reels: null,
}
const TEMPLATE_FORMAT: Record<PromoTemplate, Format> = {
  flyer: 'flyer',
  whatsapp_banner: 'whatsapp',
  instagram_card: 'instagram',
}

const FORMATS: { id: Format; label: string; sub: string; icon: React.ReactNode; aspect: string }[] = [
  { id: 'flyer', label: 'Flyer', sub: 'A4 print + share', icon: <FileText className="size-4" />, aspect: 'aspect-[3/4]' },
  { id: 'teaser', label: 'Promo Teaser Video', sub: '30-sec vertical', icon: <Video className="size-4" />, aspect: 'aspect-[9/16]' },
  { id: 'whatsapp', label: 'WhatsApp Banner', sub: '1:1 square', icon: <MessageCircle className="size-4" />, aspect: 'aspect-square' },
  { id: 'instagram', label: 'Instagram Post', sub: '4:5 portrait', icon: <Camera className="size-4" />, aspect: 'aspect-[4/5]' },
  { id: 'reels', label: 'Instagram Reel', sub: '15-sec vertical', icon: <Video className="size-4" />, aspect: 'aspect-[9/16]' },
]

export function PromoClient({ session, bootstrap }: { session: SessionView; bootstrap: PromoBootstrap }) {
  const router = useRouter()

  // Selection is tracked in demo-Format space (covers the coming-soon formats
  // too). Seed from saved templates; if nothing saved, fall back to the demo's
  // default picks so the picker never starts empty.
  const seededSelected = bootstrap.meta.selected.map((t) => TEMPLATE_FORMAT[t])
  const [selected, setSelected] = useState<Format[]>(
    seededSelected.length > 0 ? seededSelected : ['flyer', 'whatsapp']
  )
  const [approved, setApproved] = useState<Set<Format>>(
    () => new Set(bootstrap.meta.approved.map((t) => TEMPLATE_FORMAT[t]))
  )
  const [sent, setSent] = useState(bootstrap.meta.sent)

  // Real generated assets, keyed by demo Format for easy lookup in the grid.
  const [assets, setAssets] = useState<Record<Format, PromoAsset | undefined>>(() => {
    const m = {} as Record<Format, PromoAsset | undefined>
    for (const a of bootstrap.assets) m[TEMPLATE_FORMAT[a.template]] = a
    return m
  })

  // The single PROMO_TEASER_VIDEO Document backs BOTH video formats (teaser +
  // reels). One piece of state, shared by both cards.
  const [teaserVideo, setTeaserVideo] = useState<TeaserVideoAsset | null>(bootstrap.teaserVideo)

  const [busy, setBusy] = useState<Format | null>(null)
  const [variant, setVariant] = useState(0)
  const [offline, setOffline] = useState(bootstrap.storageOffline)
  const [saving, setSaving] = useState(false)

  // Light poll of GET while a teaser render is in flight, so RENDERING flips to
  // READY (or FAILED) without a manual refresh. Stops as soon as it settles.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (teaserVideo?.status !== 'RENDERING') {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${session.id}/promo`, {
          method: 'GET',
          credentials: 'include',
        })
        if (!res.ok) return
        const json = (await res.json()) as { data?: { teaserVideo?: TeaserVideoAsset | null } }
        const tv = json.data?.teaserVideo ?? null
        if (tv) setTeaserVideo(tv)
      } catch {
        // Transient — keep polling; offline banner already covers hard failures.
      }
    }, 5000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [teaserVideo?.status, session.id])

  // Persist the current select/approve/sent flags (template-space) via PATCH.
  const persist = async (next: {
    selected?: Format[]
    approved?: Set<Format>
    sent?: boolean
  }) => {
    const toTemplates = (fs: Format[]) =>
      fs.map((f) => FORMAT_TEMPLATE[f]).filter((t): t is PromoTemplate => t !== null)
    const payload: Record<string, unknown> = {}
    if (next.selected) payload.selected = toTemplates(next.selected)
    if (next.approved) payload.approved = toTemplates([...next.approved])
    if (typeof next.sent === 'boolean') payload.sent = next.sent
    if (Object.keys(payload).length === 0) return
    try {
      setSaving(true)
      const headers = await ensureCsrfHeaders()
      await fetch(`/api/classroom/sessions/${session.id}/promo`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...headers },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
    } catch {
      // Persistence is best-effort here; UI state already reflects the change.
    } finally {
      setSaving(false)
    }
  }

  const toggle = (f: Format) => {
    setSelected((prev) => {
      const next = prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]
      void persist({ selected: next })
      return next
    })
  }

  const selectAll = () => {
    const next = FORMATS.map((f) => f.id)
    setSelected(next)
    void persist({ selected: next })
  }

  // Generate / regenerate a REAL asset via POST. Image formats render an SVG
  // template synchronously; VIDEO formats (teaser/reels) enqueue the async
  // PROMO_TEASER_VIDEO render and return a RENDERING Document the poll tracks.
  // On 503/offline, flip the honest "AI generator offline" banner.
  const generate = async (f: Format) => {
    if (isVideoFormat(f)) return generateVideo(f)
    const template = FORMAT_TEMPLATE[f]
    if (!template) return
    setBusy(f)
    try {
      const headers = await ensureCsrfHeaders()
      const res = await fetch(`/api/classroom/sessions/${session.id}/promo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        credentials: 'include',
        body: JSON.stringify({ templates: [template] }),
      })
      if (res.status === 503) {
        setOffline(true)
        return
      }
      if (!res.ok) return
      const json = (await res.json()) as { data?: { assets?: PromoAsset[] } }
      const fresh = json.data?.assets ?? []
      setAssets((prev) => {
        const m = { ...prev }
        for (const a of fresh) m[TEMPLATE_FORMAT[a.template]] = a
        return m
      })
      setOffline(false)
      setVariant((v) => (v + 1) % 3)
    } catch {
      setOffline(true)
    } finally {
      setBusy(null)
    }
  }

  // Enqueue the async teaser/reel render. Returns a RENDERING Document; the
  // useEffect poll then flips it to READY (renders the MP4) or FAILED.
  const generateVideo = async (f: VideoFormat) => {
    setBusy(f)
    try {
      const headers = await ensureCsrfHeaders()
      const res = await fetch(`/api/classroom/sessions/${session.id}/promo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        credentials: 'include',
        body: JSON.stringify({ video: VIDEO_REQUEST[f] }),
      })
      if (res.status === 503) {
        setOffline(true)
        return
      }
      if (!res.ok) return
      const json = (await res.json()) as { data?: { teaserVideo?: TeaserVideoAsset | null } }
      if (json.data?.teaserVideo) setTeaserVideo(json.data.teaserVideo)
      setOffline(false)
    } catch {
      setOffline(true)
    } finally {
      setBusy(null)
    }
  }

  const approve = (f: Format) => {
    setApproved((s) => {
      const n = new Set(s).add(f)
      void persist({ approved: n })
      return n
    })
  }

  const unapprove = (f: Format) => {
    setApproved((s) => {
      const n = new Set(s)
      n.delete(f)
      void persist({ approved: n })
      return n
    })
  }

  const send = async () => {
    setSent(true)
    await persist({ sent: true })
    setTimeout(() => router.push(`/session/${session.id}/pre`), 600)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <SessionHeader session={session} backHref={`/session/${session.id}/pre`} eyebrow="Step 3 · Invitations & Teasers" />

      {offline && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12.5px] font-medium text-amber-700 dark:text-amber-300">
          <WifiOff className="size-4 shrink-0" />
          AI generator offline — the promo backend (AI / object storage) is unreachable right now. Previews below are
          mockups; generation will resume once it is back online.
        </div>
      )}

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
            const isVideo = isVideoFormat(f.id)
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
                  <div className={cn('flex items-center gap-1.5 text-[12.5px] font-semibold', on && 'text-teal-700 dark:text-teal-300')}>
                    {f.label}
                    {isVideo && (
                      <span className="rounded-full bg-violet-500/12 px-1.5 py-px text-[9px] font-semibold tracking-wide text-violet-700 uppercase dark:text-violet-300">
                        Video
                      </span>
                    )}
                  </div>
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
          const comingSoon = FORMAT_TEMPLATE[f] === null
          const asset = assets[f]
          const generating = busy === f
          return (
            <article key={f} className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[0_1px_2px_oklch(0.85_0.01_200/0.4)]">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                  <span className="text-teal-700 dark:text-teal-300">{fmt.icon}</span>
                  {fmt.label}
                  {asset ? (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:text-teal-300">
                      <Sparkles className="size-3" /> Generated
                    </span>
                  ) : !comingSoon ? (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-foreground/8 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      Preview only
                    </span>
                  ) : null}
                  {approved.has(f) && (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-3" /> Approved
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => generate(f)}
                    disabled={generating || comingSoon}
                    title={comingSoon ? 'Video formats are coming soon' : undefined}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    {asset ? 'Regenerate' : 'Generate'}
                  </button>
                  {!approved.has(f) ? (
                    <button
                      type="button"
                      onClick={() => approve(f)}
                      disabled={comingSoon}
                      title={comingSoon ? 'Video formats are coming soon' : undefined}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-emerald-500 px-2.5 text-[11px] font-medium text-white hover:bg-emerald-500/90 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => unapprove(f)}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-foreground/5"
                    >
                      Undo
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4">
                <div className={cn('relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl shadow-md', fmt.aspect)}>
                  {asset ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.svgUrl}
                        alt={`${fmt.label} promo for ${session.title}`}
                        className="absolute inset-0 size-full object-cover"
                      />
                      {generating && (
                        <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-sm">
                          <Loader2 className="size-6 animate-spin text-white" />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <PromoMock format={f} session={session} variant={variant} regenerating={generating} />
                      {/* Honest label: this is a mockup, not a generated asset. */}
                      <div className="absolute inset-x-0 bottom-0 bg-black/45 px-3 py-1.5 text-center text-[10px] font-medium text-white backdrop-blur">
                        {comingSoon
                          ? 'Preview mockup · video formats coming soon'
                          : generating
                            ? 'Generating…'
                            : 'Preview mockup · not generated yet'}
                      </div>
                    </>
                  )}
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
          disabled={approved.size === 0 || sent || saving}
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
  session: SessionView
  variant: number
  regenerating: boolean
}) {
  const palettes: { from: string; to: string; accent: string; tag: string }[] = [
    { from: 'from-teal-500', to: 'to-emerald-600', accent: 'text-teal-100', tag: 'Vaidix Live' },
    { from: 'from-sky-600', to: 'to-indigo-600', accent: 'text-sky-100', tag: 'Vaidix Live' },
    { from: 'from-emerald-500', to: 'to-cyan-600', accent: 'text-emerald-50', tag: 'Vaidix Live' },
  ]
  const p = palettes[variant % palettes.length]

  const dateStr = useMemo(() => {
    try {
      return new Date(session.date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    } catch {
      return session.date
    }
  }, [session.date])

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
