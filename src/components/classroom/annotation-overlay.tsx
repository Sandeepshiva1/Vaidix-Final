'use client'

// AnnotationOverlay — host-only drawing surface that activates while a
// screen-share is live.
//
// Architecture: same SessionAuditEvent → useSessionEvents pipeline as the
// the live collaboration tools. Each completed stroke fires ANNOTATION_DRAW (server-gated to
// HOST/CO_HOST), broadcast via the LiveKit data channel for instant peer
// rendering and persisted with a tMs offset so the recording-viewer can
// replay it. Clearing the canvas fires ANNOTATION_CLEAR. We deliberately do
// NOT use tldraw here — tldraw's UI chrome would compete with the video
// underneath, and ophthalmology annotations are typically pen + arrow scope,
// which a custom 150-line SVG overlay handles cleanly.
//
// Coordinates are normalised (0–1) to the overlay bounds so every client
// renders the same stroke shape regardless of their tile size or DPR.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { motion, AnimatePresence } from 'framer-motion'
import { Pen, Eraser, Trash2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionEvents, type SessionEvent } from '@/hooks/use-session-events'

const COLOURS = [
  { id: 'red', value: '#f43f5e' },
  { id: 'amber', value: '#f59e0b' },
  { id: 'teal', value: '#14b8a6' },
  { id: 'sky', value: '#38bdf8' },
  { id: 'white', value: '#f8fafc' },
] as const

const STROKE_PX = 3.5

interface Stroke {
  /// Stable id — persisted with the audit row, used to correlate live and
  /// replay copies.
  id: string
  authorId: string | null
  colour: string
  /// Array of normalised points (0..1, 0..1). Pen down → first point; pointer
  /// move → appended; pointer up → finalised + emitted.
  points: Array<{ x: number; y: number }>
}

interface AnnotationOverlayProps {
  sessionId: string
  isHostish: boolean
}

export function AnnotationOverlay({ sessionId, isHostish }: AnnotationOverlayProps) {
  // Only render when a screen-share track is published. We never draw over
  // bare camera tiles — Teams parity, and avoids "why are there scribbles
  // on Dr Sharma's face" feedback.
  const screenShares = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  })
  const screenShareActive = screenShares.length > 0

  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [colour, setColour] = useState<string>(COLOURS[0].value)
  const [colourMenuOpen, setColourMenuOpen] = useState(false)
  const [drawingActive, setDrawingActive] = useState(false)
  const drawingStrokeRef = useRef<Stroke | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Apply incoming events to the local strokes list.
  const onIncomingEvent = useCallback((e: SessionEvent) => {
    if (e.eventType === 'ANNOTATION_CLEAR') {
      setStrokes([])
      return
    }
    if (e.eventType !== 'ANNOTATION_DRAW') return
    const payload = e.details as { shape?: Stroke } | null
    if (!payload?.shape) return
    setStrokes((prev) => {
      // Dedupe by stroke id — local echo and remote arrival can race.
      if (prev.some((s) => s.id === payload.shape!.id)) return prev
      return [...prev, payload.shape!]
    })
  }, [])

  const { emit } = useSessionEvents({
    sessionId,
    filter: ['ANNOTATION_DRAW', 'ANNOTATION_CLEAR'],
    onEvent: onIncomingEvent,
  })

  // Hydrate from REST so late joiners see existing strokes.
  useEffect(() => {
    if (!screenShareActive) return
    const ctrl = new AbortController()
    fetch(
      `/api/classroom/sessions/${sessionId}/events?kinds=ANNOTATION_DRAW,ANNOTATION_CLEAR&limit=500`,
      { credentials: 'include', signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return
        const events = json.data.events as Array<{
          eventType: string
          details: { shape?: Stroke } | null
        }>
        // Replay the audit log linearly: a CLEAR truncates the canvas.
        let canvas: Stroke[] = []
        for (const ev of events) {
          if (ev.eventType === 'ANNOTATION_CLEAR') {
            canvas = []
          } else if (ev.eventType === 'ANNOTATION_DRAW' && ev.details?.shape) {
            canvas.push(ev.details.shape)
          }
        }
        setStrokes(canvas)
      })
      .catch(() => {/* component unmounted */})
    return () => ctrl.abort()
  }, [sessionId, screenShareActive])

  // When the share ends, drop strokes (they replay from audit if the share
  // resumes — but a clean canvas is the right default for a fresh share).
  // The lint rule prefers setState inside subscription callbacks; here the
  // LiveKit `useTracks` hook itself IS the subscription and `screenShareActive`
  // is the derived signal. Resetting local state when that signal flips is
  // the intended pattern (see React's "Subscribing to an external store").
  useEffect(() => {
    if (!screenShareActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStrokes([])
      setDrawingActive(false)
    }
  }, [screenShareActive])

  function clientToNormalised(clientX: number, clientY: number): { x: number; y: number } {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }

  // Pointer handlers. Only mounted on the host's overlay (we render the SVG
  // for everyone but only attach drawing handlers when isHostish).
  function onPointerDown(e: React.PointerEvent) {
    if (!isHostish) return
    if (tool === 'eraser') return // erasers wipe per-stroke on click; handled in stroke onClick
    e.preventDefault()
    overlayRef.current?.setPointerCapture(e.pointerId)
    const stroke: Stroke = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      authorId: null, // server stamps actorId; the wire copy gets it via emit
      colour,
      points: [clientToNormalised(e.clientX, e.clientY)],
    }
    drawingStrokeRef.current = stroke
    setDrawingActive(true)
  }
  function onPointerMove(e: React.PointerEvent) {
    const draft = drawingStrokeRef.current
    if (!draft) return
    const next = clientToNormalised(e.clientX, e.clientY)
    draft.points.push(next)
    // Capture `draft` outside the updater. Under React 19's concurrent
    // rendering the updater can be re-invoked after the event handler returns;
    // if pointerup has nulled the ref by then, reading `.id` inside the
    // updater crashes (`Cannot read properties of null (reading 'id')`).
    const draftId = draft.id
    const pointsSnapshot = [...draft.points]
    setStrokes((prev) => {
      const existingIdx = prev.findIndex((s) => s.id === draftId)
      const next = { ...draft, points: pointsSnapshot }
      if (existingIdx === -1) return [...prev, next]
      const copy = [...prev]
      copy[existingIdx] = next
      return copy
    })
  }
  function onPointerUp(e: React.PointerEvent) {
    overlayRef.current?.releasePointerCapture?.(e.pointerId)
    const stroke = drawingStrokeRef.current
    drawingStrokeRef.current = null
    setDrawingActive(false)
    if (!stroke) return
    if (stroke.points.length < 2) return // ignore taps
    void emit('ANNOTATION_DRAW', { details: { shape: stroke } })
  }

  function eraseStroke(id: string) {
    if (!isHostish) return
    if (tool !== 'eraser') return
    setStrokes((prev) => prev.filter((s) => s.id !== id))
    // No replay event for individual stroke erasure — we emit a full CLEAR
    // when the host wipes everything. Per-stroke erase is host-local and
    // intentionally NOT broadcast (Teams behaviour).
  }

  function clearAll() {
    if (!isHostish) return
    setStrokes([])
    void emit('ANNOTATION_CLEAR')
  }

  if (!screenShareActive) return null

  return (
    <>
      <div
        ref={overlayRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'absolute inset-0 z-20',
          isHostish ? 'cursor-crosshair' : 'pointer-events-none'
        )}
      >
        <svg
          className="w-full h-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          {strokes.map((s) => (
            <path
              key={s.id}
              d={pointsToPath(s.points)}
              stroke={s.colour}
              // strokeWidth is in viewBox units (which are normalised 0..1).
              // We use vectorEffect="non-scaling-stroke" so the visual width
              // stays constant regardless of overlay size, sidestepping any
              // need to read DOM measurements at render time.
              strokeWidth={STROKE_PX}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: tool === 'eraser' && isHostish ? 'stroke' : 'none' }}
              onClick={() => eraseStroke(s.id)}
            />
          ))}
        </svg>
      </div>

      {/* Toolbar — host-only. Anchored bottom-center above the control bar. */}
      {isHostish && (
        <div className="absolute bottom-22 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-zinc-900/90 backdrop-blur-2xl border border-white/8 rounded-2xl px-2 py-1.5 shadow-2xl shadow-black/70">
          <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} label="Pen">
            <Pen className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} label="Erase">
            <Eraser className="w-3.5 h-3.5" />
          </ToolButton>
          <Divider />
          <div className="relative">
            <button
              type="button"
              onClick={() => setColourMenuOpen((v) => !v)}
              title="Pen colour"
              className="flex items-center gap-1 rounded-xl px-2 py-1 hover:bg-white/8"
            >
              <span
                className="w-3 h-3 rounded-full border border-white/30"
                style={{ background: colour }}
              />
              <ChevronDown className={cn('w-3 h-3 text-white/45', colourMenuOpen && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {colourMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 flex gap-1 bg-zinc-900/97 border border-white/8 rounded-xl px-1.5 py-1"
                >
                  {COLOURS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setColour(c.value)
                        setColourMenuOpen(false)
                      }}
                      className={cn(
                        'w-5 h-5 rounded-full border transition-all',
                        colour === c.value
                          ? 'border-white scale-110'
                          : 'border-white/15 hover:scale-105'
                      )}
                      style={{ background: c.value }}
                      aria-label={c.id}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Divider />
          <ToolButton onClick={clearAll} label="Clear all">
            <Trash2 className="w-3.5 h-3.5" />
          </ToolButton>
        </div>
      )}

      {/* Subtle "drawing" indicator for host */}
      {isHostish && drawingActive && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30 rounded-full bg-amber-400/80 text-zinc-900 text-[10px] font-bold px-2 py-0.5 shadow-md">
          Drawing
        </div>
      )}
    </>
  )
}

function ToolButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-xl transition-all',
        active ? 'bg-teal-500/25 text-teal-200' : 'text-white/65 hover:bg-white/8 hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-5 bg-white/10 mx-0.5" />
}

/// Converts an array of normalised points into an SVG `d` attribute. We use
/// a quadratic curve through the midpoints for a smooth pen feel — straight
/// segments look jaggy at low pointer-sample rates.
function pointsToPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const p = points[0]
    return `M ${p.x} ${p.y} L ${p.x} ${p.y}`
  }
  const head = `M ${points[0].x} ${points[0].y}`
  const rest = []
  for (let i = 1; i < points.length - 1; i++) {
    const mid = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    }
    rest.push(`Q ${points[i].x} ${points[i].y}, ${mid.x} ${mid.y}`)
  }
  const last = points[points.length - 1]
  rest.push(`L ${last.x} ${last.y}`)
  return `${head} ${rest.join(' ')}`
}

