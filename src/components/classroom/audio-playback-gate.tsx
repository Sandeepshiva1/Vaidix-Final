'use client'

// ════════════════════════════════════════════════════════════════════════════
// Audio playback gate + audio-device settings  (Zoom / Google Meet parity)
// ════════════════════════════════════════════════════════════════════════════
// THE BUG THIS FIXES
//   Remote audio is rendered by <RoomAudioRenderer/>, which creates one
//   <audio> element per remote track and calls .play() on it. Browsers BLOCK
//   .play() for media not started by a user gesture (Safari/iOS + mobile
//   Chrome are strict; desktop Chrome depends on the site's media-engagement
//   score). When a play() is blocked, livekit-client sets
//   `room.canPlaybackAudio = false` and fires `AudioPlaybackStatusChanged`.
//
//   Because each remote track gets its OWN element created at the moment that
//   participant's track is subscribed, the failure is SELECTIVE and
//   INTERMITTENT: you hear people whose tracks attached around your last
//   gesture, but silently miss anyone who joins / unmutes later. Without a
//   recovery path the listener stays partially deaf for the rest of the call.
//
// THE FIX (matches how Zoom / Meet behave)
//   1. First-gesture auto-resume: the first pointer/key/touch ANYWHERE in the
//      room silently calls room.startAudio(), so the vast majority of users
//      never even see a prompt — exactly like clicking "Join" in Meet.
//   2. Explicit recovery banner: if audio is still blocked (no gesture yet, or
//      a late track re-triggers the block), a prominent but dismissible
//      "Enable audio" affordance lets the user unblock with one click.
//   3. <AudioOutputButton/> lets a listener pick which speaker to route to —
//      the real-world escape hatch when the OS default output is a
//      disconnected / Bluetooth / HDMI sink and they "can't hear anyone".
//
// Both pieces must render INSIDE <LiveKitRoom> (they read the room context).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { useRoomContext, useMediaDeviceSelect } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { motion, AnimatePresence } from 'framer-motion'
import { Volume2, VolumeX, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ----------------------------------------------------------------------------
// AudioPlaybackGate — silent first-gesture resume + visible recovery banner
// ----------------------------------------------------------------------------
export function AudioPlaybackGate() {
  const room = useRoomContext()
  // Seed from the live value so a gate that mounts AFTER playback was already
  // blocked still shows immediately (don't assume `true`).
  const [canPlay, setCanPlay] = useState(() => room.canPlaybackAudio)

  // Track room's playback-permission changes. livekit-client optimistically
  // tries to resume on every new track; this event is the authoritative signal
  // for whether that succeeded.
  useEffect(() => {
    const sync = () => setCanPlay(room.canPlaybackAudio)
    sync()
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync)
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, sync)
    }
  }, [room])

  const start = useCallback(() => {
    // startAudio() resumes the shared AudioContext and replays every attached
    // element. Safe to call when already allowed — it no-ops. Swallow the
    // rejection: a reject just means the gesture wasn't accepted, the banner
    // (driven by canPlay) stays up for another try.
    room.startAudio().catch(() => {/* still blocked — banner stays */})
  }, [room])

  // (1) First-gesture auto-resume. While blocked, ANY interaction anywhere in
  // the document unblocks audio — the same "your first click fixes it" UX as
  // Meet/Zoom. Capture phase + passive so we never interfere with the click's
  // real target (mute button, chat, etc.).
  useEffect(() => {
    if (canPlay) return
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    const onGesture = () => start()
    window.addEventListener('pointerdown', onGesture, opts)
    window.addEventListener('keydown', onGesture, opts)
    window.addEventListener('touchend', onGesture, opts)
    return () => {
      window.removeEventListener('pointerdown', onGesture, opts)
      window.removeEventListener('keydown', onGesture, opts)
      window.removeEventListener('touchend', onGesture, opts)
    }
  }, [canPlay, start])

  // Intentionally not dismissible: the banner vanishes the instant audio
  // resumes (the first gesture anywhere does that), so it never lingers — and
  // keeping it up while audio is genuinely blocked is the correct, Meet-like
  // behaviour. A dismiss button would just let users hide a real problem.
  return (
    <AnimatePresence>
      {!canPlay && (
        <motion.div
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -16, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          // Top-center, above the room chrome. pointer-events on the button
          // only — the wrapper doesn't trap clicks elsewhere.
          className="pointer-events-none absolute inset-x-0 top-4 z-60 flex justify-center px-4"
          role="alert"
          aria-live="assertive"
        >
          <button
            type="button"
            onClick={start}
            data-testid="enable-audio-banner"
            className="pointer-events-auto flex items-center gap-3 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-semibold text-amber-950 shadow-xl shadow-black/40 ring-1 ring-amber-300/50 hover:bg-amber-400 transition-colors"
          >
            <VolumeX className="h-4.5 w-4.5 shrink-0" />
            <span>Audio is blocked by your browser — click to hear everyone</span>
            <span className="rounded-full bg-amber-950/15 px-2.5 py-0.5 text-xs font-bold">
              Enable audio
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ----------------------------------------------------------------------------
// AudioOutputButton — speaker (audiooutput) picker.
// Renders as a control-pill button with a popover device list. Output-device
// selection (HTMLMediaElement.setSinkId) is Chromium-only; on browsers that
// don't expose output devices the list is empty and we show a hint instead of
// a broken control.
// ----------------------------------------------------------------------------
export function AudioOutputButton({ className }: { className?: string }) {
  const room = useRoomContext()
  const [open, setOpen] = useState(false)
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind: 'audiooutput',
    room,
  })

  const supported = devices.length > 0
  const activeLabel =
    devices.find((d) => d.deviceId === activeDeviceId)?.label?.replace(/\s*\(.*?\)\s*$/, '') ??
    'Speaker'

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="audio-output-button"
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur-md transition-all duration-150 hover:bg-white/10 hover:text-white"
        title="Choose which speaker plays the call audio"
      >
        <Volume2 className="h-3.5 w-3.5" />
        <span className="hidden max-w-30 truncate sm:inline">{activeLabel}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.12 }}
            role="listbox"
            className="absolute bottom-full right-0 z-50 mb-2 max-h-64 w-64 overflow-auto rounded-xl border border-white/8 bg-zinc-900/95 p-1 shadow-2xl shadow-black/60 backdrop-blur-xl"
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
              Speaker
            </div>
            {!supported && (
              <div className="px-3 py-2 text-xs text-white/50">
                Your browser doesn&apos;t allow choosing the speaker here. Pick the
                output device in your OS sound settings.
              </div>
            )}
            {devices.map((d) => {
              const active = d.deviceId === activeDeviceId
              return (
                <button
                  key={d.deviceId}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={async () => {
                    try {
                      await setActiveMediaDevice(d.deviceId)
                    } catch {/* device vanished — list re-syncs on devicechange */}
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all duration-100',
                    active ? 'bg-white/8 text-white' : 'text-white/70 hover:bg-white/6 hover:text-white'
                  )}
                >
                  <Check className={cn('h-3.5 w-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{d.label || 'System default'}</span>
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}
