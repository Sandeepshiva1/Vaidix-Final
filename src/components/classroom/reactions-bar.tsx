'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SmilePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionEvents, type SessionEvent } from '@/hooks/use-session-events'

// 8 × 3 grid. Row 1 = applause / hand variants, row 2 = positive / energy,
// row 3 = emotion / mind. Ordered so the most-used reactions sit on the
// left edge (closest to the trigger button reading direction).
const REACTIONS = [
  // Row 1 — applause family
  { emoji: '👏', label: 'Clap' },
  { emoji: '🙌', label: 'Raise hands' },
  { emoji: '👐', label: 'Open hands' },
  { emoji: '🤲', label: 'Palms up' },
  { emoji: '🤝', label: 'Handshake' },
  { emoji: '💪', label: 'Muscle' },
  { emoji: '✊', label: 'Raised fist' },
  { emoji: '🤗', label: 'Hug' },
  // Row 2 — positive / energy
  { emoji: '👍', label: 'Thumbs up' },
  { emoji: '❤️', label: 'Heart' },
  { emoji: '🎉', label: 'Tada' },
  { emoji: '🎊', label: 'Confetti' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '✨', label: 'Sparkle' },
  { emoji: '🌟', label: 'Star' },
  { emoji: '💯', label: 'Hundred' },
  // Row 3 — emotion / mind
  { emoji: '😂', label: 'Laugh' },
  { emoji: '😮', label: 'Wow' },
  { emoji: '🤯', label: 'Mind blown' },
  { emoji: '🥺', label: 'Pleading' },
  { emoji: '😍', label: 'Love' },
  { emoji: '💡', label: 'Idea' },
  { emoji: '🙏', label: 'Pray' },
  { emoji: '🚀', label: 'Rocket' },
] as const

export function ReactionsBar({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false)
  const { emit } = useSessionEvents({ sessionId, filter: ['REACTION'] })

  function pick(emoji: string) {
    void emit('REACTION', { details: { emoji } })
    setOpen(false)
  }

  return (
    <div className="relative flex flex-col items-center gap-1.5 group">
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="React"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.91 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        className={cn(
          'w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200',
          open
            ? 'bg-amber-500/30 text-amber-200 shadow-[0_0_0_1px_rgba(245,158,11,0.5),0_0_18px_rgba(245,158,11,0.4)]'
            : 'bg-amber-500/20 text-amber-300 shadow-[0_0_0_1px_rgba(245,158,11,0.25)] hover:bg-amber-500/32 hover:text-amber-200'
        )}
      >
        <SmilePlus className="w-5 h-5" />
      </motion.button>
      <span className="text-[11px] text-white/40 group-hover:text-white/70 transition-colors leading-none">
        React
      </span>

      <AnimatePresence>
        {open && (
          <>
            {/* Click-outside dismissal */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.85 }}
              transition={{ type: 'spring', damping: 22, stiffness: 320 }}
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 grid grid-cols-[repeat(8,2.75rem)] gap-1 p-2 bg-zinc-950/90 backdrop-blur-2xl border border-white/12 rounded-2xl shadow-2xl shadow-black/80"
            >
              {REACTIONS.map((r, i) => (
                <motion.button
                  key={r.emoji}
                  type="button"
                  onClick={() => pick(r.emoji)}
                  title={r.label}
                  initial={{ opacity: 0, scale: 0.4, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: i * 0.025, type: 'spring', stiffness: 420, damping: 18 }}
                  whileHover={{ scale: 1.45, y: -6 }}
                  whileTap={{ scale: 0.8 }}
                  className="w-11 h-11 text-2xl rounded-xl hover:bg-white/8 flex items-center justify-center transition-colors duration-100"
                >
                  {r.emoji}
                </motion.button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Mobile reactions row ────────────────────────────────────────────────────
// On phones the desktop popover (an 8-wide emoji grid) is wider than the
// viewport, so the live-room "More" sheet renders this horizontally-scrollable
// single row instead. Same emit path as ReactionsBar — picking one fires the
// REACTION event and notifies the parent so it can close the sheet.
export function MobileReactionsRow({
  sessionId,
  onPicked,
}: {
  sessionId: string
  onPicked?: () => void
}) {
  const { emit } = useSessionEvents({ sessionId, filter: ['REACTION'] })

  function pick(emoji: string) {
    void emit('REACTION', { details: { emoji } })
    onPicked?.()
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {REACTIONS.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => pick(r.emoji)}
          title={r.label}
          aria-label={r.label}
          className="shrink-0 w-11 h-11 text-2xl rounded-xl bg-white/5 active:bg-white/15 flex items-center justify-center transition-colors duration-100"
        >
          {r.emoji}
        </button>
      ))}
    </div>
  )
}

// ─── Floating overlay ────────────────────────────────────────────────────────
// Each reaction lands at a column derived from the actor's identity (so two
// users clapping at once spawn from different horizontal positions, not on
// top of each other) plus small per-bubble jitter for variety. Vertical start
// height + drift distance are randomized so simultaneous claps from the same
// person don't stack into a single visual line.

interface FloatingBubble {
  id: string
  emoji: string
  x: number
  bottomPct: number
  rotate: number
  rise: number
  duration: number
}

/// Hash actorId → stable [0.15, 0.85] horizontal column. Same person's
/// reactions consistently launch from roughly the same column, so the grid
/// reads as "this user is reacting from over there".
function actorColumn(actorId: string | null): number {
  if (!actorId) return 0.15 + Math.random() * 0.7
  let h = 0
  for (let i = 0; i < actorId.length; i++) {
    h = ((h << 5) - h + actorId.charCodeAt(i)) | 0
  }
  return 0.12 + (Math.abs(h) % 1000) / 1000 * 0.76
}

export function FloatingReactionsLayer({ sessionId }: { sessionId: string }) {
  const [bubbles, setBubbles] = useState<FloatingBubble[]>([])

  const onEvent = (e: SessionEvent) => {
    if (e.eventType !== 'REACTION') return
    const emoji = (e.details as { emoji?: string } | null)?.emoji
    if (!emoji) return
    const baseX = actorColumn(e.actorId)
    const jitter = (Math.random() - 0.5) * 0.1
    const bubble: FloatingBubble = {
      id: e.id,
      emoji,
      x: Math.max(0.04, Math.min(0.96, baseX + jitter)),
      bottomPct: 12 + Math.random() * 14,
      rotate: -20 + Math.random() * 40,
      rise: 320 + Math.random() * 140,
      duration: 3.2 + Math.random() * 0.8,
    }
    setBubbles((prev) => [...prev, bubble])
    window.setTimeout(() => {
      setBubbles((prev) => prev.filter((b) => b.id !== bubble.id))
    }, (bubble.duration + 0.2) * 1000)
  }

  useSessionEvents({ sessionId, filter: ['REACTION'], onEvent })

  return (
    <div className="pointer-events-none absolute inset-0 z-15 overflow-hidden">
      <AnimatePresence>
        {bubbles.map((b) => (
          <motion.div
            key={b.id}
            initial={{ y: 0, opacity: 0, scale: 0.4, rotate: b.rotate }}
            animate={{
              y: -b.rise,
              opacity: [0, 1, 1, 0],
              scale: [0.4, 1.25, 1.1, 0.8],
              rotate: [b.rotate, b.rotate * 0.4, -b.rotate * 0.5, b.rotate * 0.2],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: b.duration, ease: 'easeOut' }}
            style={{ left: `${b.x * 100}%`, bottom: `${b.bottomPct}%` }}
            className="absolute text-5xl select-none drop-shadow-lg"
          >
            {b.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
