'use client'

import { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Loader2, Languages } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CaptionTrack {
  language: string
  source: string
  vttUrl: string | null
}

interface VttCue {
  startSec: number
  endSec: number
  text: string
}

interface Props {
  tracks: CaptionTrack[]
  currentTimeSec: number
  onSeek: (sec: number) => void
}

const LANGUAGE_LABEL: Record<string, string> = {
  en: 'English', hi: 'Hindi', te: 'Telugu', ta: 'Tamil', kn: 'Kannada',
  ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', ur: 'Urdu',
}

function parseTimestamp(ts: string): number {
  const clean = ts.trim().replace(',', '.')
  const parts = clean.split(':')
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
  }
  return parseFloat(parts[0]) * 60 + parseFloat(parts[1])
}

function parseVtt(content: string): VttCue[] {
  const cues: VttCue[] = []
  const lines = content.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.includes('-->')) {
      const arrowIdx = line.indexOf('-->')
      const startStr = line.slice(0, arrowIdx)
      const endStr = line.slice(arrowIdx + 3).split(' ')[0] ?? ''
      const startSec = parseTimestamp(startStr)
      const endSec = parseTimestamp(endStr)
      const textLines: string[] = []
      i++
      while (i < lines.length && (lines[i] ?? '').trim() !== '') {
        textLines.push((lines[i] ?? '').replace(/<[^>]+>/g, ''))
        i++
      }
      const text = textLines.join(' ').trim()
      if (text) cues.push({ startSec, endSec, text })
    }
    i++
  }
  return cues
}

function fmtTs(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function TranscriptTab({ tracks, currentTimeSec, onSeek }: Props) {
  const availableTracks = tracks.filter((t) => !!t.vttUrl)
  const [selectedLang, setSelectedLang] = useState(
    availableTracks.find((t) => t.language === 'en')?.language ?? availableTracks[0]?.language ?? ''
  )
  const [cues, setCues] = useState<VttCue[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeCueRef = useRef<HTMLButtonElement | null>(null)

  // Fetch and parse VTT when selected language changes
  useEffect(() => {
    const track = availableTracks.find((t) => t.language === selectedLang)
    if (!track?.vttUrl) { setCues([]); return }
    setLoading(true)
    setError(null)
    fetch(track.vttUrl)
      .then((r) => r.text())
      .then((text) => setCues(parseVtt(text)))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLang])

  // Scroll active cue into view
  useEffect(() => {
    activeCueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [currentTimeSec])

  if (availableTracks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex items-center justify-center rounded-full bg-muted p-4">
          <BookOpen className="size-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold">Transcript not available</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Captions are generated after AI processing completes (~90 min for a 1-hour session).
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Language selector */}
      {availableTracks.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Languages className="size-3.5 text-muted-foreground" />
          {availableTracks.map((t) => (
            <button
              key={t.language}
              onClick={() => setSelectedLang(t.language)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                selectedLang === t.language
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              )}
            >
              {LANGUAGE_LABEL[t.language] ?? t.language.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading transcript…</span>
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">Could not load transcript: {error}</p>
      ) : cues.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm text-muted-foreground">No transcript content found.</p>
        </div>
      ) : (
        <div className="max-h-[480px] overflow-y-auto pr-1 space-y-0.5 rounded-xl border border-border bg-muted/20 p-2">
          {cues.map((cue, idx) => {
            const isActive = currentTimeSec >= cue.startSec && currentTimeSec < cue.endSec
            return (
              <motion.button
                key={idx}
                ref={isActive ? activeCueRef : undefined}
                onClick={() => onSeek(cue.startSec)}
                initial={false}
                animate={isActive ? { backgroundColor: 'rgba(var(--primary-rgb, 60, 160, 120), 0.08)' } : { backgroundColor: 'transparent' }}
                className={cn(
                  'group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted',
                  isActive && 'bg-primary/5'
                )}
              >
                <span className={cn(
                  'mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-semibold transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:text-foreground'
                )}>
                  {fmtTs(cue.startSec)}
                </span>
                <span className={cn(
                  'text-[13px] leading-relaxed transition-colors',
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground'
                )}>
                  {cue.text}
                </span>
              </motion.button>
            )
          })}
        </div>
      )}
    </div>
  )
}
