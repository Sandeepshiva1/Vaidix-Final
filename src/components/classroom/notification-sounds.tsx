'use client'

// Notification sounds for the live room — short Web Audio chimes that play
// when remote participants join or leave. No audio asset bundled; the tone
// is synthesised in-browser via Web Audio API so it works offline and
// avoids licensing concerns.
//
// Default ON, persisted to localStorage. The toolbar exposes a
// `NotificationSoundsToggle` button so the user can mute the alerts
// (matches the equivalent toggle in Teams Settings → Notifications).
//
// Why two notes?  The single-note "ding" feels harsh in a meeting context;
// a brief ascending arpeggio (lower → higher) reads as "someone arrived",
// and an inverted descending pair reads as "left". Same pattern Meet and
// Teams use.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'vaidix.notificationSounds'
// Skip the first MOUNT_GRACE_MS — without this, every participant who was
// already in the room when YOU joined would each fire a chime, which feels
// like the room is yelling at you on entry.
const MOUNT_GRACE_MS = 1500

// Read once at module load. Stored as 'on' / 'off' (default 'on').
function readPref(): boolean {
  if (typeof window === 'undefined') return true
  return window.localStorage.getItem(STORAGE_KEY) !== 'off'
}

// Lazy-init shared AudioContext. Browsers gate AudioContext creation
// behind a user gesture (autoplay policy); since the user clicked Join to
// reach this room, the context unlocks on first chime call without any
// extra UI prompt.
let _ctx: AudioContext | null = null
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (_ctx) return _ctx
  try {
    const Ctor = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    _ctx = new Ctor()
    return _ctx
  } catch {
    return null
  }
}

/**
 * Play a tone. `freq` in Hz, `at` in seconds from the current AudioContext
 * time, `dur` in seconds. Soft attack/release envelope so the tone feels
 * like a chime, not a beep.
 */
function tone(ctx: AudioContext, freq: number, at: number, dur: number, peak = 0.12) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(peak, at + 0.015)        // 15ms attack
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)   // exp decay = chimey
  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + dur + 0.05)
}

/// Two-note ascending major third — "someone arrived". Frequencies chosen
/// to be cheerful but not piercing: C5 (523 Hz) → G5 (784 Hz), perfect 5th.
function playJoin() {
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  const t = ctx.currentTime
  tone(ctx, 523.25, t, 0.18)
  tone(ctx, 783.99, t + 0.1, 0.22)
}

/// Two-note descending — "someone left". G5 → C5 (inverted from join).
function playLeave() {
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  const t = ctx.currentTime
  tone(ctx, 783.99, t, 0.16, 0.09)
  tone(ctx, 523.25, t + 0.1, 0.22, 0.09)
}

/// Bright two-note "ping" — "someone raised their hand."
/// Pitches sit higher than join/leave (A5 → C6) so the chime cuts through
/// any ongoing chatter and reads as an attention call rather than a
/// presence event. Same localStorage mute gate so users only need one
/// toggle to silence ALL room chimes.
export function playHandRaise() {
  if (!readPref()) return
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  const t = ctx.currentTime
  tone(ctx, 880.0, t, 0.12, 0.11)        // A5 — short attention tone
  tone(ctx, 1046.5, t + 0.07, 0.18, 0.11) // C6 — bright resolution
}

/// Three-note arpeggio — "knock-knock, someone is in the waiting room."
/// Distinct from playJoin so a moderator can tell the difference between
/// "a participant entered the room" and "a guest is waiting to be admitted."
/// Pattern E5 → A5 → E5 (octave bookends + a perfect-fourth in the middle)
/// is short enough to not be intrusive when several admissions queue up.
/// Respects the same localStorage mute that gates join/leave chimes — one
/// toggle silences everything, which is the behaviour users expect.
export function playWaitingRoomKnock() {
  if (!readPref()) return
  const ctx = audio()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  const t = ctx.currentTime
  tone(ctx, 659.25, t, 0.14, 0.1)        // E5
  tone(ctx, 880.0, t + 0.08, 0.16, 0.1)  // A5
  tone(ctx, 659.25, t + 0.2, 0.2, 0.1)   // E5
}

/// Subscribes the live room to ParticipantConnected/Disconnected events
/// and plays the corresponding chime. Mount-grace silences the initial
/// burst when a user enters a room with existing participants.
export function NotificationSounds() {
  const room = useRoomContext()
  const mountedAtRef = useRef(0)

  useEffect(() => {
    mountedAtRef.current = Date.now()
    function onConnected() {
      if (!readPref()) return
      if (Date.now() - mountedAtRef.current < MOUNT_GRACE_MS) return
      playJoin()
    }
    function onDisconnected() {
      if (!readPref()) return
      if (Date.now() - mountedAtRef.current < MOUNT_GRACE_MS) return
      playLeave()
    }
    room.on(RoomEvent.ParticipantConnected, onConnected)
    room.on(RoomEvent.ParticipantDisconnected, onDisconnected)
    return () => {
      room.off(RoomEvent.ParticipantConnected, onConnected)
      room.off(RoomEvent.ParticipantDisconnected, onDisconnected)
    }
  }, [room])

  return null
}

/// Toolbar button to mute / unmute notification chimes. Persists to
/// localStorage so the choice carries across sessions.
export function NotificationSoundsToggle() {
  const [enabled, setEnabled] = useState<boolean>(() => readPref())

  // Keep state in sync if another tab toggles it (rare but cheap).
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setEnabled(e.newValue !== 'off')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
      // Brief preview when turning back on, so the user knows it works.
      if (next) playJoin()
      return next
    })
  }, [])

  return (
    <button
      type="button"
      onClick={toggle}
      title={enabled ? 'Mute notification sounds' : 'Unmute notification sounds'}
      aria-label={enabled ? 'Mute notification sounds' : 'Unmute notification sounds'}
      className={cn(
        'flex items-center justify-center w-9 h-9 rounded-full border transition-all duration-150',
        enabled
          ? 'bg-white/8 text-white/70 border-white/10 hover:bg-white/14'
          : 'bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/28',
      )}
    >
      {enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
    </button>
  )
}
