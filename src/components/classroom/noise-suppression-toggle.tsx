'use client'

// Headless always-on noise suppression.
//
// Automatically applies the best available tier once the local microphone
// track publishes. No toggle UI — noise suppression is always enabled.
//
//   Tier 1 — @livekit/krisp-noise-filter (ML WASM, ~4MB). Loaded lazily.
//   Tier 2 — browser-native noiseSuppression + echoCancellation constraints.
//             Instant fallback when Krisp is unavailable or fails to load.
//
// The NOISE_SUPPRESSION_TOGGLE event is still emitted so recording playback
// can correlate audio quality with session start.

import { useCallback, useEffect, useRef } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { LocalAudioTrack, Track } from 'livekit-client'
import type { TrackProcessor } from 'livekit-client'
import { useSessionEvents } from '@/hooks/use-session-events'

async function tryAttachKrisp(
  track: LocalAudioTrack
): Promise<TrackProcessor<Track.Kind.Audio> | null> {
  try {
    const mod = await import('@livekit/krisp-noise-filter')
    if (!mod.isKrispNoiseFilterSupported()) return null
    const processor = mod.KrispNoiseFilter()
    await track.setProcessor(processor)
    return processor as unknown as TrackProcessor<Track.Kind.Audio>
  } catch (err) {
    console.warn('[NoiseSuppression] Krisp unavailable, falling back:', err)
    return null
  }
}

export function NoiseSuppressionToggle({ sessionId }: { sessionId: string }) {
  const { localParticipant } = useLocalParticipant()
  const { emit } = useSessionEvents({ sessionId, filter: ['NOISE_SUPPRESSION_TOGGLE'] })
  const krispBlockedRef = useRef(false)
  const doneRef = useRef(false)

  const apply = useCallback(async () => {
    if (doneRef.current) return
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone)
    const track = pub?.track
    if (!(track instanceof LocalAudioTrack)) return
    doneRef.current = true

    let tier: 'krisp' | 'browser' = 'browser'
    if (!krispBlockedRef.current) {
      const krisp = await tryAttachKrisp(track)
      if (krisp) {
        tier = 'krisp'
      } else {
        krispBlockedRef.current = true
      }
    }

    if (tier === 'browser') {
      const mediaTrack = track.mediaStreamTrack
      const caps = mediaTrack.getCapabilities?.()
      if (caps && 'noiseSuppression' in caps) {
        await mediaTrack.applyConstraints({ noiseSuppression: true, echoCancellation: true })
      }
    }

    void emit('NOISE_SUPPRESSION_TOGGLE', { details: { enabled: true, tier } })
  }, [localParticipant, emit])

  useEffect(() => {
    const handler = () => void apply()
    // LiveKit's typed event-emitter overloads `on/off` per event name, and the
    // `localTrackPublished` overload's handler signature `(publication,
    // participant) => void` collapses our nullary handler to `never` when the
    // event-name itself is cast. Use `EventEmitter`-shaped any to keep the
    // wiring at runtime without contorting the typed overloads.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(localParticipant as any).on('localTrackPublished', handler)
    void apply()
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(localParticipant as any).off('localTrackPublished', handler)
    }
  }, [localParticipant, apply])

  return null
}
