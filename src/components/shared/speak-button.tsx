'use client'

/**
 * SpeakButton — text-to-speech for patient voice blocks.
 *
 * uses the browser's Web Speech Synthesis API (free, zero latency,
 * works offline). Picks an Indian English voice if available, otherwise
 * falls back to default.
 *
 * Phase B swap point: replace the synth call with a fetch to /api/tts which
 * uses Sarvam Bulbul TTS for higher quality Indian-accented voices in
 * Telugu / Hindi / Tamil. The component API does not change.
 */

import { useEffect, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SpeakButtonProps {
  text: string
  /** Hint about preferred language: 'en-IN' (default), 'hi-IN', 'te-IN', etc. */
  lang?: string
  className?: string
  size?: 'sm' | 'default'
}

export function SpeakButton({ text, lang = 'en-IN', className, size = 'sm' }: SpeakButtonProps) {
  const [supported, setSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only browser capability + voice detection (speechSynthesis)
      setSupported(false)
      return
    }
    setSupported(true)

    // Voice loading is async on most browsers
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      // Prefer en-IN, then any English, then any voice
      const preferred =
        voices.find((v) => v.lang === lang) ||
        voices.find((v) => v.lang.startsWith(lang.split('-')[0])) ||
        voices.find((v) => v.lang.startsWith('en-IN')) ||
        voices.find((v) => v.lang.startsWith('en')) ||
        voices[0] ||
        null
      setVoice(preferred)
    }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices

    return () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel()
      }
    }
  }, [lang])

  const handleSpeak = () => {
    if (!supported) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const utt = new SpeechSynthesisUtterance(text)
    if (voice) utt.voice = voice
    utt.lang = voice?.lang || lang
    utt.rate = 0.95 // slightly slower for clinical clarity
    utt.pitch = 1.0
    utt.onend = () => setSpeaking(false)
    utt.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utt)
    setSpeaking(true)
  }

  if (!supported) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size={size === 'sm' ? 'icon-sm' : 'icon'}
      onClick={handleSpeak}
      aria-label={speaking ? 'Stop reading' : 'Read aloud'}
      className={cn(
        'shrink-0 transition-colors',
        speaking && 'bg-rose-500/15 text-rose-600 hover:bg-rose-500/20',
        className
      )}
    >
      {speaking ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
    </Button>
  )
}
