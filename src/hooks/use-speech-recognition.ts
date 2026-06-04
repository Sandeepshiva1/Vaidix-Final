'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Web Speech API types (not in default DOM lib)
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}
interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionResult {
  readonly length: number
  readonly isFinal: boolean
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}
interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}
interface ISpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
interface SpeechRecognitionConstructor {
  new (): ISpeechRecognition
}
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

interface UseSpeechRecognitionOptions {
  lang?: string
  continuous?: boolean
  /** Hard cap on a single recording session in milliseconds. Default: 30000 (30s).
   *  Mirrors Sarvam Saaras v3's max audio length and prevents accidentally
   *  long recordings. */
  maxDurationMs?: number
  onResult?: (transcript: string, isFinal: boolean) => void
}

/**
 * Browser-native speech-to-text via Web Speech API.
 * Works in Chrome/Edge/Safari. Returns a transcript stream + start/stop controls.
 *
 * Has a 30-second hard cap by default (configurable). The cap auto-stops
 * the recognition and exposes a `secondsLeft` value so the UI can render a
 * countdown.
 */
export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const { lang = 'en-IN', continuous = true, maxDurationMs = 30_000, onResult } = options
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [isSupported, setIsSupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number>(Math.floor(maxDurationMs / 1000))
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const accumulatedRef = useRef('')
  const cutoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Ctor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time SpeechRecognition browser-capability detection (client-only API)
      setIsSupported(false)
      return
    }
    setIsSupported(true)

    const rec = new Ctor()
    rec.continuous = continuous
    rec.interimResults = true
    rec.lang = lang

    rec.onstart = () => {
      setIsListening(true)
      startedAtRef.current = Date.now()
      setSecondsLeft(Math.floor(maxDurationMs / 1000))

      // Auto-stop hard cap
      if (cutoffTimerRef.current) clearTimeout(cutoffTimerRef.current)
      cutoffTimerRef.current = setTimeout(() => {
        try {
          rec.stop()
        } catch {}
      }, maxDurationMs)

      // Tick down for the UI countdown
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = setInterval(() => {
        if (!startedAtRef.current) return
        const elapsed = Date.now() - startedAtRef.current
        const remaining = Math.max(0, Math.ceil((maxDurationMs - elapsed) / 1000))
        setSecondsLeft(remaining)
        if (remaining === 0 && tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current)
          tickIntervalRef.current = null
        }
      }, 250)
    }
    rec.onend = () => {
      setIsListening(false)
      startedAtRef.current = null
      if (cutoffTimerRef.current) {
        clearTimeout(cutoffTimerRef.current)
        cutoffTimerRef.current = null
      }
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current)
        tickIntervalRef.current = null
      }
      setSecondsLeft(Math.floor(maxDurationMs / 1000))
    }
    rec.onerror = (e) => {
      setError(e.error || 'speech-error')
      setIsListening(false)
    }
    rec.onresult = (event) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          final += text
        } else {
          interim += text
        }
      }
      if (final) {
        accumulatedRef.current += final
        setTranscript(accumulatedRef.current)
        setInterimTranscript('')
        onResult?.(accumulatedRef.current, true)
      }
      if (interim) {
        setInterimTranscript(interim)
        onResult?.(accumulatedRef.current + interim, false)
      }
    }

    recognitionRef.current = rec
    return () => {
      try {
        rec.abort()
      } catch {}
      if (cutoffTimerRef.current) clearTimeout(cutoffTimerRef.current)
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
      recognitionRef.current = null
    }
  }, [lang, continuous, maxDurationMs, onResult])

  const start = useCallback(() => {
    setError(null)
    accumulatedRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    try {
      recognitionRef.current?.start()
    } catch (_e) {
      // Already running — ignore
    }
  }, [])

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop()
    } catch {}
  }, [])

  const toggle = useCallback(() => {
    if (isListening) stop()
    else start()
  }, [isListening, start, stop])

  const reset = useCallback(() => {
    accumulatedRef.current = ''
    setTranscript('')
    setInterimTranscript('')
  }, [])

  return {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    error,
    secondsLeft,
    maxDurationSeconds: Math.floor(maxDurationMs / 1000),
    start,
    stop,
    toggle,
    reset,
  }
}
