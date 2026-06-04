'use client'

// ════════════════════════════════════════════════════════════════════════════
// RoomPeoplePanel — the demo's left "Faculty" panel, on REAL LiveKit data.
// Lists everyone in the room grouped by real role (Presenter = session host,
// Moderator = co-host loaded from the DB, Participant = everyone else) with live
// mic/cam status. Collapsible. Additive overlay — does not touch the video grid
// or controls. All role data is real; nothing is fabricated.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { useParticipants, useLocalParticipant } from '@livekit/components-react'
import { ChevronLeft, ChevronRight, Mic, MicOff, Users, Video as VideoIcon, VideoOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isAgentParticipant } from '@/lib/livekit-helpers'
import { useVideoRoomClient } from './video-room-client'

type RoleKey = 'Presenter' | 'Moderator' | 'Participant'
const ROLE_RING: Record<RoleKey, string> = {
  Presenter: 'bg-teal-500/15 text-teal-300 ring-teal-400/30',
  Moderator: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
  Participant: 'bg-white/[0.08] text-white/60 ring-white/10',
}
const ROLE_RANK: Record<RoleKey, number> = { Presenter: 0, Moderator: 1, Participant: 2 }

function initialsOf(name: string): string {
  return name.split(/\s+/).filter((p) => p && !p.startsWith('Dr.')).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?'
}

export function RoomPeoplePanel({
  sessionId, hostId, localUserId, localUserName,
}: {
  sessionId: string
  hostId: string
  localUserId: string
  localUserName?: string
}) {
  const all = useParticipants()
  const participants = all.filter((p) => !isAgentParticipant(p))
  const { localParticipant } = useLocalParticipant()
  const client = useVideoRoomClient()
  const [collapsed, setCollapsed] = useState(false)
  const [coHosts, setCoHosts] = useState<Set<string>>(new Set())

  useEffect(() => {
    client.loadCoHosts(sessionId).then((ids) => setCoHosts(new Set(ids))).catch(() => {/* non-critical */})
  }, [sessionId, client])

  const people = participants
    .map((p) => {
      const isSelf = p.identity === localParticipant.identity || p.identity === localUserId
      const name = isSelf ? (localUserName ?? p.name ?? 'You') : (p.name?.trim() || `User ${(p.identity || '').slice(0, 4)}`)
      const role: RoleKey = p.identity === hostId ? 'Presenter' : coHosts.has(p.identity) ? 'Moderator' : 'Participant'
      return {
        key: p.identity || name,
        label: isSelf ? `${name} (you)` : name,
        role,
        mic: !!p.isMicrophoneEnabled,
        cam: !!p.isCameraEnabled,
        speaking: !!p.isSpeaking,
      }
    })
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.label.localeCompare(b.label))

  if (collapsed) {
    return (
      <div className="absolute left-0 top-14 bottom-0 z-20 flex w-11 flex-col items-center gap-2 border-r border-white/10 bg-zinc-900/90 py-3 backdrop-blur-xl">
        <button type="button" onClick={() => setCollapsed(false)} title="Show people" className="grid size-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white">
          <ChevronRight className="size-4" />
        </button>
        <Users className="size-4 text-white/40" />
        <span className="text-[10px] font-semibold tabular-nums text-white/50">{people.length}</span>
      </div>
    )
  }

  return (
    <div className="absolute left-0 top-14 bottom-0 z-20 flex w-[210px] flex-col border-r border-white/10 bg-zinc-900/90 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-widest text-white/45">In this room · {people.length}</span>
        <button type="button" onClick={() => setCollapsed(true)} title="Hide" className="grid size-6 place-items-center rounded-lg text-white/40 transition-colors hover:bg-white/10 hover:text-white">
          <ChevronLeft className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {people.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-white/40">Waiting for people to join…</p>
        ) : (
          people.map((p) => (
            <div key={p.key} className={cn('flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors', p.speaking ? 'bg-teal-500/10 ring-1 ring-inset ring-teal-400/30' : 'hover:bg-white/5')}>
              <div className={cn('grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-1 ring-inset', ROLE_RING[p.role])}>{initialsOf(p.label)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-white/90">{p.label}</div>
                <div className="text-[10px] font-medium text-white/45">{p.role}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {p.mic ? <Mic className="size-3.5 text-white/55" /> : <MicOff className="size-3.5 text-rose-400/70" />}
                {p.cam ? <VideoIcon className="size-3.5 text-white/55" /> : <VideoOff className="size-3.5 text-white/30" />}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
