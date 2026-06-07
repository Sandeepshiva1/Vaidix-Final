'use client'

import { useEffect, useState } from 'react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar as LKControlBar,
  GridLayout,
  ParticipantTile,
  useTracks,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { Track } from 'livekit-client'
import { Bot, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AudioPlaybackGate } from './audio-playback-gate'

interface Props {
  sessionId: string
  breakoutId: string
  breakoutName: string
  isFaculty: boolean
  /** Called when the user (or faculty reconvene) leaves the breakout */
  onLeave: () => void
}

function GridFromTracks() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  )
  return (
    <GridLayout tracks={tracks} style={{ height: '100%' }}>
      <ParticipantTile />
    </GridLayout>
  )
}

export function BreakoutRoomView({ sessionId, breakoutId, breakoutName, isFaculty, onLeave }: Props) {
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reconvening, setReconvening] = useState(false)

  // Mint a child-room token on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/classroom/sessions/${sessionId}/breakouts/${breakoutId}/token`,
          { method: 'POST', credentials: 'include' }
        )
        const json = await res.json()
        if (cancelled) return
        if (!json.ok) {
          setError(json.error?.message ?? 'Failed to get breakout token')
          return
        }
        setConn({ token: json.data.token, url: json.data.url })
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, breakoutId])

  const reconvene = async () => {
    setReconvening(true)
    try {
      await fetch(`/api/classroom/sessions/${sessionId}/breakouts/reconvene`, {
        method: 'POST',
        credentials: 'include',
      })
      onLeave()
    } finally {
      setReconvening(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Button onClick={onLeave} variant="outline">
          <ArrowLeft className="mr-1 h-3 w-3" /> Back to main room
        </Button>
      </div>
    )
  }

  if (!conn) {
    return <div className="p-6 text-sm text-muted-foreground">Joining breakout…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{breakoutName}</span>
          <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
            <Bot className="h-3 w-3" /> AI co-facilitator listening
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onLeave}>
            <ArrowLeft className="mr-1 h-3 w-3" /> Leave breakout
          </Button>
          {isFaculty ? (
            <Button size="sm" onClick={reconvene} disabled={reconvening}>
              Reconvene all
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative flex-1 bg-black">
        <LiveKitRoom
          token={conn.token}
          serverUrl={conn.url}
          connect
          // Join with mic + camera OFF (the user toggles them in the control
          // bar) — matching the main room. `audio`/`video` here auto-published
          // the camera the instant someone entered a breakout, which is why
          // video turned itself on. Let people opt in instead.
          audio={false}
          video={false}
          // Same CPU guardrails as the main room: decode only visible tiles,
          // stop publishing unviewed layers.
          options={{ adaptiveStream: true, dynacast: true }}
          onDisconnected={onLeave}
          className="h-full"
        >
          <GridFromTracks />
          <RoomAudioRenderer />
          <AudioPlaybackGate />
          <LKControlBar variation="minimal" />
        </LiveKitRoom>
      </div>
    </div>
  )
}
