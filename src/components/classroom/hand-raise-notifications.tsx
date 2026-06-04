'use client'

// HandRaiseNotifications — transient floating toasts when someone raises
// their hand.
//
// We subscribe directly to the LiveKit room's ParticipantMetadataChanged
// event rather than reading from useParticipants(). The hook returns the
// same array reference even when an individual participant's metadata
// flips, so our effect would otherwise miss the change. Using the room
// event guarantees we see every false → true transition, including the
// local user's own hand-raise.

import { useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, type Participant } from 'livekit-client'
import { motion, AnimatePresence } from 'framer-motion'
import { Hand } from 'lucide-react'
import { playHandRaise } from './notification-sounds'

const TOAST_TTL_MS = 4500

interface Notif {
  id: string
  name: string
  isSelf: boolean
}

function isHandRaised(metadata: string | undefined): boolean {
  if (!metadata) return false
  try {
    const parsed = JSON.parse(metadata) as { handRaised?: unknown }
    return parsed?.handRaised === true
  } catch {
    return false
  }
}

function displayName(p: Participant): string {
  const n = (p.name ?? '').trim()
  if (n) return n
  const id = (p.identity ?? '').trim()
  if (id) return `User ${id.slice(0, 4)}`
  return 'Someone'
}

export function HandRaiseNotifications() {
  const room = useRoomContext()
  const [notifs, setNotifs] = useState<Notif[]>([])
  const lastStateRef = useRef<Map<string, boolean>>(new Map())

  useEffect(() => {
    // Seed initial state so users joining a room with hands already raised
    // don't get spammed with stale toasts.
    const seed = (p: Participant) => {
      lastStateRef.current.set(p.identity, isHandRaised(p.metadata))
    }
    seed(room.localParticipant)
    room.remoteParticipants.forEach(seed)

    const handleMetadata = (_prev: string | undefined, p: Participant) => {
      const wasRaised = lastStateRef.current.get(p.identity) ?? false
      const isRaised = isHandRaised(p.metadata)
      lastStateRef.current.set(p.identity, isRaised)
      if (wasRaised || !isRaised) return
      const isSelf = p.identity === room.localParticipant.identity
      const id = `${p.identity}-${Date.now()}`
      setNotifs((prev) => [...prev, {
        id,
        name: isSelf ? 'You' : displayName(p),
        isSelf,
      }])
      // Audible cue for everyone EXCEPT the local user — they already see
      // the toast immediately on click and don't need to be chimed at by
      // their own action. Remote raises trigger the chime (subject to the
      // shared notification-sounds mute pref). Mirrors Teams' behaviour.
      if (!isSelf) playHandRaise()
      window.setTimeout(() => {
        setNotifs((prev) => prev.filter((n) => n.id !== id))
      }, TOAST_TTL_MS)
    }

    // Some LiveKit builds also fire a generic ParticipantAttributesChanged
    // event for metadata; handler signature differs. We register both for
    // resilience — the lastStateRef gate de-dupes.
    room.on(RoomEvent.ParticipantMetadataChanged, handleMetadata)
    return () => {
      room.off(RoomEvent.ParticipantMetadataChanged, handleMetadata)
    }
  }, [room])

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex flex-col gap-2 items-center pointer-events-none">
      <AnimatePresence>
        {notifs.map((n) => (
          <motion.div
            key={n.id}
            initial={{ y: -16, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 360, damping: 24 }}
            className="bg-amber-500/25 backdrop-blur-xl border border-amber-400/40 rounded-full px-4 py-2 shadow-xl shadow-amber-500/25 flex items-center gap-2"
          >
            <motion.span
              animate={{ rotate: [0, -22, 22, -18, 0] }}
              transition={{ duration: 0.9, ease: 'easeInOut', repeat: 1 }}
              className="origin-bottom inline-block"
            >
              <Hand className="w-4 h-4 text-amber-200" />
            </motion.span>
            <span className="text-sm text-white font-medium">
              <span className="text-amber-200">{n.name}</span>
              <span className="text-white/80">
                {n.isSelf ? ' raised your hand' : ' raised their hand'}
              </span>
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
