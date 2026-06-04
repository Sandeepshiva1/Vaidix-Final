'use client'

// RecordingReplayLayer — replays SessionAuditEvent overlays on top of the
// recorded video.
//
// Loads all replayable events for the session once on mount, then watches
// the player's currentTimeSec. When the playhead crosses an event's tMs we
// render the corresponding overlay:
//   • REACTION  → floating emoji bubble (matches live UX)
//   • FILE_SHARE → toast chip "<file> shared by <user>"
//   • SPOTLIGHT_SET / SPOTLIGHT_CLEAR → toast "Spotlight changed"
//   • NOTE_EDIT → no-op visually here; the recording-viewer's notes tab can
//     scrub the SharedNoteEdit log directly using the version in details
//
// Scrubbing backwards resets the fired set so re-playing a portion fires
// the same overlays again — critical for review use cases where a learner
// rewinds to study a specific moment.

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paperclip, Star } from 'lucide-react'

interface ReplayEvent {
  id: string
  eventType: string
  actorId: string | null
  targetUserId: string | null
  details: Record<string, unknown> | null
  tMs: number | null
  createdAt: string
}

interface AnnotationStroke {
  id: string
  authorId: string | null
  colour: string
  points: Array<{ x: number; y: number }>
}

interface ToastChip {
  id: string
  icon: 'file' | 'star'
  text: string
}

const REACTION_TTL_MS = 3500
const TOAST_TTL_MS = 4000
const TIME_WINDOW_MS = 250 // crossing tolerance — accounts for player tick rate

interface FloatingReaction {
  id: string
  emoji: string
  x: number
}

export function RecordingReplayLayer({
  sessionId,
  currentTimeSec,
}: {
  sessionId: string
  currentTimeSec: number
}) {
  const [events, setEvents] = useState<ReplayEvent[]>([])
  const [bubbles, setBubbles] = useState<FloatingReaction[]>([])
  const [toasts, setToasts] = useState<ToastChip[]>([])
  const [annotations, setAnnotations] = useState<AnnotationStroke[]>([])
  const firedRef = useRef<Set<string>>(new Set())
  const lastTimeRef = useRef<number>(0)

  // Load replay events.
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(
      `/api/classroom/sessions/${sessionId}/events?kinds=REACTION,FILE_SHARE,SPOTLIGHT_SET,SPOTLIGHT_CLEAR,ANNOTATION_DRAW,ANNOTATION_CLEAR&limit=2000`,
      { credentials: 'include', signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return
        setEvents(
          (json.data.events as ReplayEvent[]).filter(
            (e) => typeof e.tMs === 'number' && (e.tMs ?? -1) >= 0
          )
        )
      })
      .catch(() => {/* component unmounted */})
    return () => ctrl.abort()
  }, [sessionId])

  // Sync fired set with playhead. Resets on backwards seek.
  useEffect(() => {
    const tMs = currentTimeSec * 1000
    if (tMs + TIME_WINDOW_MS < lastTimeRef.current) {
      // Backwards seek — replay the audit log up to the new playhead so the
      // annotation canvas reflects exactly what was on screen at that point.
      // Reactions/toasts are time-windowed and self-clear, so resetting the
      // fired set covers them.
      firedRef.current = new Set(
        events.filter((e) => (e.tMs ?? Infinity) <= tMs).map((e) => e.id)
      )
      const rebuilt: AnnotationStroke[] = []
      for (const e of events) {
        if (e.tMs == null) continue
        if (e.tMs > tMs) break
        if (e.eventType === 'ANNOTATION_CLEAR') {
          rebuilt.length = 0
        } else if (e.eventType === 'ANNOTATION_DRAW') {
          const shape = (e.details as { shape?: AnnotationStroke } | null)?.shape
          if (shape) rebuilt.push(shape)
        }
      }
      setAnnotations(rebuilt)
    }
    lastTimeRef.current = tMs

    for (const e of events) {
      if (e.tMs == null) continue
      if (firedRef.current.has(e.id)) continue
      if (Math.abs(e.tMs - tMs) > TIME_WINDOW_MS) continue
      firedRef.current.add(e.id)
      fireEvent(e)
    }
    // Intentionally exclude bubbles/toasts from deps — they reset their own
    // state via setTimeout. We only re-evaluate on time changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTimeSec, events])

  function fireEvent(e: ReplayEvent) {
    if (e.eventType === 'REACTION') {
      const emoji = (e.details as { emoji?: string } | null)?.emoji
      if (!emoji) return
      const bubble: FloatingReaction = {
        id: e.id,
        emoji,
        x: 0.18 + Math.random() * 0.64,
      }
      setBubbles((prev) => [...prev, bubble])
      window.setTimeout(() => {
        setBubbles((prev) => prev.filter((b) => b.id !== bubble.id))
      }, REACTION_TTL_MS)
      return
    }
    if (e.eventType === 'FILE_SHARE') {
      const name = (e.details as { name?: string } | null)?.name ?? 'a file'
      pushToast({ id: e.id, icon: 'file', text: `Shared: ${name}` })
      return
    }
    if (e.eventType === 'SPOTLIGHT_SET') {
      pushToast({ id: e.id, icon: 'star', text: 'Spotlight set' })
      return
    }
    if (e.eventType === 'SPOTLIGHT_CLEAR') {
      pushToast({ id: e.id, icon: 'star', text: 'Spotlight cleared' })
      return
    }
    if (e.eventType === 'ANNOTATION_DRAW') {
      const shape = (e.details as { shape?: AnnotationStroke } | null)?.shape
      if (shape) {
        setAnnotations((prev) =>
          prev.some((s) => s.id === shape.id) ? prev : [...prev, shape]
        )
      }
      return
    }
    if (e.eventType === 'ANNOTATION_CLEAR') {
      setAnnotations([])
    }
  }

  function pushToast(t: ToastChip) {
    setToasts((prev) => [...prev, t])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id))
    }, TOAST_TTL_MS)
  }

  return (
    <>
      {/* Annotation strokes — same SVG approach as live AnnotationOverlay,
          read-only here. Coordinates are normalised so they map across the
          recording's letterboxing exactly as they did live. */}
      {annotations.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 z-20 w-full h-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          {annotations.map((s) => (
            <path
              key={s.id}
              d={pointsToPath(s.points)}
              stroke={s.colour}
              strokeWidth={3.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}

      {/* Floating reactions overlay — pointer-events-none, layered over video */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        <AnimatePresence>
          {bubbles.map((b) => (
            <motion.div
              key={b.id}
              initial={{ y: 0, opacity: 0, scale: 0.6 }}
              animate={{ y: -300, opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 0.9] }}
              exit={{ opacity: 0 }}
              transition={{ duration: REACTION_TTL_MS / 1000, ease: 'easeOut' }}
              style={{ left: `${b.x * 100}%`, bottom: '15%' }}
              className="absolute text-3xl select-none"
            >
              {b.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Toast chips for non-reaction events */}
      <div className="pointer-events-none absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ x: 80, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 80, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="flex items-center gap-1.5 rounded-full bg-black/70 backdrop-blur-md border border-white/10 px-3 py-1.5 text-xs font-medium text-white"
            >
              {t.icon === 'file' ? (
                <Paperclip className="w-3.5 h-3.5 opacity-80" />
              ) : (
                <Star className="w-3.5 h-3.5 opacity-80" />
              )}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}

/// Same path-builder as the live AnnotationOverlay — kept duplicated here
/// (rather than imported) because the recording-viewer is a separate route
/// chunk and we don't want to drag the live overlay's LiveKit deps into it.
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
