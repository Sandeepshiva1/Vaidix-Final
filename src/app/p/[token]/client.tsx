'use client'

// Client-side promo share renderer.
//
// Inlines each SVG asset into the DOM (via fetch + <img> with object URL) so:
//   1) the canvas SVG→PNG conversion works without CORS issues
//   2) WhatsApp / IG users can long-press to save direct from the page
//   3) the page is light: a single API call + presigned MinIO URLs do the rest

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Calendar, Clock, Download, Share2, Copy, Check, Loader2, Lock, ArrowRight } from 'lucide-react'

type AssetTemplate = 'flyer' | 'whatsapp_banner' | 'instagram_card'

interface PublicPromoView {
  session: {
    title: string
    description: string | null
    scheduledStart: string
    scheduledEnd: string
    hostName: string
    hostRole: string | null
    programLabel: string | null
    objectives: Array<{ text: string; blooms: number }>
    tags: string[]
    openToAll: boolean
  }
  assets: Array<{
    template: AssetTemplate
    title: string
    svgUrl: string
  }>
}

const TEMPLATE_META: Record<AssetTemplate, { label: string; dim: string; aspect: string }> = {
  flyer: { label: 'Conference Flyer', dim: '1200×1500', aspect: 'aspect-[4/5]' },
  whatsapp_banner: { label: 'WhatsApp Banner', dim: '1080×1920', aspect: 'aspect-[9/16]' },
  instagram_card: { label: 'Instagram Card', dim: '1080×1080', aspect: 'aspect-square' },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

async function svgUrlToPng(svgUrl: string, scale = 2): Promise<Blob> {
  const res = await fetch(svgUrl)
  if (!res.ok) throw new Error('Could not fetch image')
  const svgText = await res.text()
  // viewBox tells us the intrinsic size for the canvas.
  const vbMatch = svgText.match(/viewBox=["']([^"']+)["']/)
  let w = 1080
  let h = 1080
  if (vbMatch) {
    const parts = vbMatch[1].split(/\s+/).map(Number)
    if (parts.length === 4) {
      w = parts[2]
      h = parts[3]
    }
  }
  const blob = new Blob([svgText], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('SVG render failed'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = '#0E1730'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(url)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png', 0.95)
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 0)
}

export function PromoShareClient({ view }: { view: PublicPromoView }) {
  const dateStr = useMemo(() => fmtDate(view.session.scheduledStart), [view.session.scheduledStart])
  const startTime = useMemo(() => fmtTime(view.session.scheduledStart), [view.session.scheduledStart])
  const endTime = useMemo(() => fmtTime(view.session.scheduledEnd), [view.session.scheduledEnd])
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const isOpen = view.session.openToAll

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      },
      () => {}
    )
  }

  // Use the OS-native share sheet when available (mobile + recent desktop
  // Chromium); fall back to clipboard copy. Native share gives WhatsApp /
  // Telegram / email as a single tap — far better than Copy + Paste.
  async function nativeShare() {
    if (sharing) return
    const payload: ShareData = {
      title: view.session.title,
      text: `${view.session.title} · ${dateStr}`,
      url: window.location.href,
    }
    if (typeof navigator.share === 'function') {
      try {
        setSharing(true)
        await navigator.share(payload)
      } catch {
        // User cancelled, or share not allowed — silent.
      } finally {
        setSharing(false)
      }
      return
    }
    copyLink()
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#F5F4F0] to-[#E6F4F2] text-[#1A202C]">
      {/* Top strap */}
      <header className="bg-[#1B2B4B] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0A7C6E] text-white text-[11px] font-extrabold">V</div>
            <span className="font-bold tracking-wide">VAIDIX</span>
            <span className="text-[10px] uppercase tracking-widest text-white/50 ml-2">LXS</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void nativeShare()}
              disabled={sharing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10 disabled:opacity-60"
            >
              <Share2 className="size-3.5" /> Share
            </button>
            <button
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10"
            >
              {copied ? <><Check className="size-3.5" /> Copied</> : <><Copy className="size-3.5" /> Copy link</>}
            </button>
          </div>
        </div>
      </header>

      {/* Compact hero — speaker, host role, and all per-asset repetitions
          live on the share cards themselves. The hero only carries info the
          asset images cannot: program label, scannable date/time, and the
          one piece of UI that absolutely can't be on an image — the
          Join / Invite-only action. */}
      <section className="mx-auto max-w-6xl px-6 pt-8 pb-2">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {view.session.programLabel && (
            <span className="mb-3 inline-flex items-center gap-1 rounded-full border border-[#0A7C6E]/30 bg-[#E6F4F2] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#065A50]">
              {view.session.programLabel}
            </span>
          )}
          <h1 className="text-3xl md:text-4xl font-extrabold leading-tight tracking-tight text-[#1B2B4B]">
            {view.session.title}
          </h1>
          {view.session.description && (
            <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-[#4A5568]">
              {view.session.description}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] font-semibold text-[#1B2B4B] shadow-sm ring-1 ring-black/5">
              <Calendar className="size-4 text-[#0A7C6E]" /> {dateStr}
            </span>
            <span className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] font-semibold text-[#1B2B4B] shadow-sm ring-1 ring-black/5">
              <Clock className="size-4 text-[#0A7C6E]" /> {startTime} – {endTime}
            </span>
            {isOpen ? (
              <a
                href="/login"
                className="ml-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#F0A500] px-5 py-2 text-[13px] font-extrabold uppercase tracking-wider text-white shadow-sm transition hover:bg-[#dd9900]"
              >
                Join session <ArrowRight className="size-4" />
              </a>
            ) : (
              <span className="ml-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#F0F3F8] px-5 py-2 text-[13px] font-bold text-[#4A5568]">
                <Lock className="size-4" /> Invite-only
              </span>
            )}
          </div>
          {view.session.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {view.session.tags.map((t) => (
                <span key={t} className="rounded-full bg-[#FEF3DC] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#8A5E00]">
                  {t}
                </span>
              ))}
            </div>
          )}
          {isOpen ? (
            <p className="mt-3 text-[11px] text-[#718096]">
              Open to anyone with this link.{' '}
              <a href="/login" className="font-semibold text-[#0A7C6E] underline-offset-2 hover:underline">Sign in</a>
              {' '}to attend.
            </p>
          ) : (
            <p className="mt-3 text-[11px] text-[#718096]">Ask the host or your program director for access.</p>
          )}
        </motion.div>
      </section>

      {/* Objectives */}
      {view.session.objectives.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 pt-8">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#718096]">What you will learn</h2>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {view.session.objectives.map((o, i) => (
              <li key={i} className="flex items-start gap-2 rounded-xl border border-black/5 bg-white px-3 py-2.5 shadow-sm">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#E6F4F2] text-[10px] font-extrabold text-[#065A50]">
                  {i + 1}
                </span>
                <span className="text-[14px] leading-relaxed text-[#1A202C]">{o.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Assets — clickable to open full-size, plus per-card PNG download. */}
      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-[#718096]">Share these</h2>
            <p className="text-sm text-[#4A5568]">Tap a card to view full-size, or download as PNG. On mobile, long-press to save direct.</p>
          </div>
          <button
            onClick={() => void nativeShare()}
            disabled={sharing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#0A7C6E]/30 bg-[#E6F4F2] px-3 py-1.5 text-[12px] font-bold text-[#065A50] transition hover:bg-[#D0EDE9] disabled:opacity-60"
            title="Share via WhatsApp, email, or other apps"
          >
            <Share2 className="size-3.5" /> Share session
          </button>
        </div>
        <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {view.assets.map((a) => (
            <AssetCard key={a.template} asset={a} when={`${dateStr} · ${startTime}`} />
          ))}
          {view.assets.length === 0 && (
            <div className="md:col-span-2 lg:col-span-3 rounded-2xl border border-dashed border-black/10 bg-white/60 p-8 text-center text-sm text-[#718096]">
              No promo images are attached to this session yet.
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-black/5 bg-white/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-[11px] text-[#718096]">
          <span>VAIDIX · LV Prasad Eye Institute</span>
          <span>Generated for share — verify date/time with the host before forwarding.</span>
        </div>
      </footer>
    </main>
  )
}

function AssetCard({ asset, when }: { asset: PublicPromoView['assets'][number]; when: string }) {
  const meta = TEMPLATE_META[asset.template]
  const [busy, setBusy] = useState(false)
  const [sharing, setSharing] = useState(false)

  async function makePng(): Promise<Blob> {
    return await svgUrlToPng(asset.svgUrl, 2)
  }

  async function onDownload(e: React.MouseEvent) {
    e.stopPropagation()
    setBusy(true)
    try {
      const blob = await makePng()
      downloadBlob(blob, `${asset.title.replace(/[^\w-]+/g, '-').slice(0, 60)}.png`)
    } catch {
      window.open(asset.svgUrl, '_blank', 'noopener,noreferrer')
    } finally {
      setBusy(false)
    }
  }

  // Share THIS asset (the rendered PNG) using the OS-native share sheet.
  // Web Share API Level 2 supports files — WhatsApp / Instagram show up as
  // share targets with the image attached, not just a link. Falls back to
  // copying the public-page URL when files-share isn't available.
  async function onShare(e: React.MouseEvent) {
    e.stopPropagation()
    if (sharing) return
    setSharing(true)
    try {
      const blob = await makePng()
      const file = new File([blob], `${asset.title.replace(/[^\w-]+/g, '-').slice(0, 60)}.png`, { type: 'image/png' })
      const canShareFiles =
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
      if (canShareFiles && typeof navigator.share === 'function') {
        try {
          await navigator.share({ files: [file], title: meta.label, text: `${meta.label} · ${when}` })
          return
        } catch {
          // user cancelled or share rejected — fall through to link-share fallback
        }
      }
      // Fallback: try sharing the page URL, or as a last resort copy it.
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: meta.label, text: `${meta.label} · ${when}`, url: window.location.href })
          return
        } catch { /* cancelled */ }
      }
      navigator.clipboard.writeText(window.location.href).catch(() => {})
    } finally {
      setSharing(false)
    }
  }

  function openFullSize() {
    window.open(asset.svgUrl, '_blank', 'noopener,noreferrer')
  }

  // Note: no role=button on the outer wrapper. Nesting an interactive
  // wrapper with two more buttons (Share, PNG) inside violates the no-
  // nested-interactives rule and confuses screen readers + Playwright's
  // accessible-name flattening (it'd report "Share PNG" as part of the
  // card's name). Instead the image preview area gets its own button.
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2 border-b border-black/5 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-bold text-[#1B2B4B]">{meta.label}</div>
          <div className="truncate text-[10px] text-[#718096]">{meta.dim} · {when}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={onShare}
            disabled={sharing}
            className="inline-flex items-center gap-1 rounded-lg bg-[#F0A500] px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-[#dd9900] disabled:opacity-60"
            title="Share this image to WhatsApp, Instagram, etc."
          >
            {sharing ? <Loader2 className="size-3 animate-spin" /> : <Share2 className="size-3" />}
            Share
          </button>
          <button
            onClick={onDownload}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-[#E6F4F2] px-2.5 py-1 text-[11px] font-bold text-[#065A50] transition hover:bg-[#D0EDE9] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
            PNG
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={openFullSize}
        aria-label={`Open ${meta.label} full-size`}
        className={`relative bg-[#0E1730] ${meta.aspect} flex w-full items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#0A7C6E]/40`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.svgUrl}
          alt={asset.title}
          className="h-full w-full object-contain"
          loading="lazy"
        />
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/40 px-2 py-0.5 text-[10px] font-bold text-white opacity-0 transition group-hover:opacity-100">
          Tap to expand
        </span>
      </button>
    </motion.div>
  )
}

