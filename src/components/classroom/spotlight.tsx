'use client'

// Spotlight controller + state hook.
//
// Spotlight is a HOST/CO_HOST-only feature. The host clicks a participant
// tile and picks "Spotlight" — the event is broadcast via the data channel
// (live for everyone) and persisted as a SPOTLIGHT_SET audit event for the
// recording-viewer replay. Late-joiners read the latest SPOTLIGHT_* event
// from the REST GET to derive the current state.
//
// The grid in live-session.tsx checks `useSpotlight()` to decide whether to
// switch from grid layout to a single-tile focus mode.

import { useEffect, useState } from 'react'
import { Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionEvents, type SessionEvent } from '@/hooks/use-session-events'

export interface SpotlightState {
  targetIdentity: string | null
}

export function useSpotlight(sessionId: string): SpotlightState & {
  setSpotlight: (identity: string | null) => void
} {
  const [target, setTarget] = useState<string | null>(null)

  // Hydrate from REST on mount — covers late-joiners who missed the live
  // event. We only care about the most recent SPOTLIGHT_*.
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(
      `/api/classroom/sessions/${sessionId}/events?kinds=SPOTLIGHT_SET,SPOTLIGHT_CLEAR&limit=50`,
      { credentials: 'include', signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return
        const events: { eventType: string; targetUserId: string | null }[] = json.data.events
        // Server returns ascending; the last entry is the current state.
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i]
          if (e.eventType === 'SPOTLIGHT_CLEAR') {
            setTarget(null)
            return
          }
          if (e.eventType === 'SPOTLIGHT_SET' && e.targetUserId) {
            setTarget(e.targetUserId)
            return
          }
        }
      })
      .catch(() => {
        /* no spotlight on init */
      })
    return () => ctrl.abort()
  }, [sessionId])

  // Live updates via the events channel.
  const onEvent = (e: SessionEvent) => {
    if (e.eventType === 'SPOTLIGHT_SET') setTarget(e.targetUserId)
    else if (e.eventType === 'SPOTLIGHT_CLEAR') setTarget(null)
  }

  const { emit } = useSessionEvents({
    sessionId,
    filter: ['SPOTLIGHT_SET', 'SPOTLIGHT_CLEAR'],
    onEvent,
  })

  function setSpotlight(identity: string | null) {
    // Optimistic update: the host sees the change instantly rather than
    // waiting for the SSE round-trip (emit → server → broadcast → onEvent).
    setTarget(identity)
    if (identity) {
      void emit('SPOTLIGHT_SET', { targetUserId: identity })
    } else {
      void emit('SPOTLIGHT_CLEAR')
    }
  }

  return { targetIdentity: target, setSpotlight }
}

/// Small overlay button shown on a participant tile (HOST/CO_HOST only).
export function SpotlightButton({
  participantIdentity,
  isSpotlighted,
  onToggle,
}: {
  participantIdentity: string
  isSpotlighted: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isSpotlighted ? 'Remove spotlight' : `Spotlight ${participantIdentity}`}
      className={cn(
        'rounded-full p-1.5 backdrop-blur-md border transition-all duration-150',
        isSpotlighted
          ? 'bg-amber-400/85 text-zinc-900 border-amber-300 shadow-md shadow-amber-500/40'
          : 'bg-black/45 text-white/85 border-white/10 hover:bg-black/70'
      )}
    >
      {isSpotlighted ? <X className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
    </button>
  )
}
