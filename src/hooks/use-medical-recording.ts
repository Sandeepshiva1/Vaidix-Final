'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseMedicalRecordingOptions {
  /** Topic ID — forwarded to /api/voice so the right keyword glossary is
   *  applied for biasing. */
  topicId?: string
  /** Hard cap on a single recording session in milliseconds. Default 30s.
   *  Mirrors the old Web Speech hook so the UI countdown stays unchanged. */
  maxDurationMs?: number
}

/**
 * VAIDIX MEDICAL RECORDING HOOK
 *
 * Records audio in the browser via MediaRecorder, then POSTs the blob to
 * /api/voice (which forwards to Deepgram Nova-2 Medical with topic-specific
 * keyword biasing). Replaces the old browser-native useSpeechRecognition hook
 * for medical contexts where domain accuracy matters more than live partials.
 *
 * Key differences vs. useSpeechRecognition:
 *  - No `interimTranscript`. Deepgram batch mode returns the final transcript
 *    once recording stops. The UI shows a "Transcribing..." state in the gap.
 *  - Audio is sent server-side, so the resident's voice never hits a generic
 *    Web Speech model — Deepgram's medical model is the only thing that
 *    decides what was said.
 *  - `isListening` stays true during the post-recording transcription wait,
 *    so the existing button rendering continues to feel responsive. A
 *    separate `isTranscribing` flag is exposed for finer-grained UI.
 *
 * Drop-in compatible with the old useSpeechRecognition return shape — the
 * page can swap one for the other with only the import line changing.
 */
export function useMedicalRecording(options: UseMedicalRecordingOptions = {}) {
  const { topicId, maxDurationMs = 30_000 } = options

  const [isSupported, setIsSupported] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number>(
    Math.floor(maxDurationMs / 1000)
  )

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const cutoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number | null>(null)

  // Detect support on mount. We need both MediaRecorder and getUserMedia.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hasRecorder = typeof window.MediaRecorder !== 'undefined'
    const hasGetUserMedia = !!navigator.mediaDevices?.getUserMedia
    setIsSupported(hasRecorder && hasGetUserMedia)
  }, [])

  const cleanupTimers = useCallback(() => {
    if (cutoffTimerRef.current) {
      clearTimeout(cutoffTimerRef.current)
      cutoffTimerRef.current = null
    }
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = null
    }
  }, [])

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        // ignore
      }
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setTranscript('')
    chunksRef.current = []

    if (!isSupported) {
      setError('MediaRecorder not supported in this browser')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Pick a MIME type the browser actually supports. Chrome/Edge/Firefox
      // all support webm/opus; Safari prefers mp4. Deepgram accepts both.
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ]
      const mimeType = candidates.find((c) =>
        typeof MediaRecorder.isTypeSupported === 'function'
          ? MediaRecorder.isTypeSupported(c)
          : false
      )

      const rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = rec

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      rec.onstart = () => {
        setIsListening(true)
        startedAtRef.current = Date.now()
        setSecondsLeft(Math.floor(maxDurationMs / 1000))

        cutoffTimerRef.current = setTimeout(() => {
          stop()
        }, maxDurationMs)

        tickIntervalRef.current = setInterval(() => {
          if (!startedAtRef.current) return
          const elapsed = Date.now() - startedAtRef.current
          const remaining = Math.max(
            0,
            Math.ceil((maxDurationMs - elapsed) / 1000)
          )
          setSecondsLeft(remaining)
          if (remaining === 0 && tickIntervalRef.current) {
            clearInterval(tickIntervalRef.current)
            tickIntervalRef.current = null
          }
        }, 250)
      }

      rec.onerror = (e: Event) => {
        const errEvent = e as Event & { error?: { message?: string } }
        setError(errEvent.error?.message ?? 'recording-error')
        setIsListening(false)
        cleanupTimers()
        releaseStream()
      }

      rec.onstop = async () => {
        cleanupTimers()
        // Hold isListening=true through the network round-trip so the UI
        // doesn't flicker back to the idle "Speak" state mid-transcription.
        setIsTranscribing(true)
        startedAtRef.current = null

        try {
          const blob = new Blob(chunksRef.current, {
            type: rec.mimeType || 'audio/webm',
          })
          chunksRef.current = []

          const fd = new FormData()
          // Pick file extension from MIME type so the server's content-type
          // detection stays consistent with what Deepgram expects.
          const ext = (rec.mimeType || 'audio/webm').includes('mp4')
            ? 'mp4'
            : 'webm'
          fd.append('file', blob, `recording.${ext}`)
          if (topicId) fd.append('topicId', topicId)

          const res = await fetch('/api/voice', { method: 'POST', body: fd })
          if (!res.ok) {
            const detail = await res.text().catch(() => '')
            throw new Error(`STT failed (${res.status}): ${detail.slice(0, 200)}`)
          }
          const data = await res.json()
          const finalText: string = (data?.transcript ?? '').trim()
          setTranscript(finalText)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'transcription-failed'
          setError(msg)
        } finally {
          setIsTranscribing(false)
          setIsListening(false)
          setSecondsLeft(Math.floor(maxDurationMs / 1000))
          releaseStream()
        }
      }

      rec.start()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'mic-access-denied'
      setError(msg)
      setIsListening(false)
      releaseStream()
    }
  }, [isSupported, maxDurationMs, topicId, stop, cleanupTimers, releaseStream])

  const toggle = useCallback(() => {
    if (isListening) stop()
    else void start()
  }, [isListening, start, stop])

  const reset = useCallback(() => {
    setTranscript('')
    setError(null)
  }, [])

  // Cleanup on unmount: stop recorder + release mic + clear timers.
  useEffect(() => {
    return () => {
      const rec = mediaRecorderRef.current
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop()
        } catch {
          // ignore
        }
      }
      cleanupTimers()
      releaseStream()
    }
  }, [cleanupTimers, releaseStream])

  return {
    isSupported,
    isListening,
    isTranscribing,
    transcript,
    /** Always empty — Deepgram batch mode has no partials. Kept for API
     *  compatibility with the old useSpeechRecognition hook. */
    interimTranscript: '',
    error,
    secondsLeft,
    maxDurationSeconds: Math.floor(maxDurationMs / 1000),
    start,
    stop,
    toggle,
    reset,
  }
}
