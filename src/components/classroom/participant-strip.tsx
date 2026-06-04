'use client'

// ParticipantStrip — Teams-style always-visible compact participant list,
// rendered in the live-room top bar. Shows up to N avatars (initials) sorted
// with self → speakers → hand-raised → alphabetical, with a "+N" overflow
// chip when the room is larger.

import { useParticipants, useLocalParticipant } from '@livekit/components-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { isAgentParticipant } from '@/lib/livekit-helpers'

const MAX_VISIBLE = 5

function isHandRaised(metadata: string | undefined): boolean {
  if (!metadata) return false
  try {
    const parsed = JSON.parse(metadata) as { handRaised?: unknown }
    return parsed?.handRaised === true
  } catch {
    return false
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/// Falls back through (Vaidix only admits registered users, so we always
/// have something on file):
///   1. trusted `selfName` for the local user
///   2. participant.name (LiveKit JWT name claim)
///   3. selfEmail prefix for the local user
///   4. `User <id4>` derived from identity
///   5. 'Joining…' (only fires when no info is available at all)
///
/// `isSelf` is determined by reference equality with the local participant
/// (passed in via ctx) rather than by identity-matching, so it works
/// during the pre-connect window when LiveKit hasn't yet populated
/// `localParticipant.identity`.
function displayName(
  p: { name?: string; identity: string },
  ctx: { isSelf: boolean; selfName?: string; selfEmail?: string },
): string {
  if (ctx.isSelf) {
    const cn = (ctx.selfName ?? '').trim()
    if (cn) return cn
  }
  const n = (p.name ?? '').trim()
  if (n) return n
  if (ctx.isSelf) {
    const ep = (ctx.selfEmail ?? '').split('@')[0]?.trim()
    if (ep) return ep
  }
  const id = (p.identity ?? '').trim()
  if (id) return `User ${id.slice(0, 4)}`
  return 'Joining…'
}

/// Stable color per participant from a small palette so each user reads
/// distinctly even without a real avatar image.
const PALETTE = [
  'bg-emerald-500/30 text-emerald-100',
  'bg-sky-500/30 text-sky-100',
  'bg-violet-500/30 text-violet-100',
  'bg-fuchsia-500/30 text-fuchsia-100',
  'bg-amber-500/30 text-amber-100',
  'bg-rose-500/30 text-rose-100',
  'bg-teal-500/30 text-teal-100',
] as const

function colorFor(identity: string): string {
  let h = 0
  for (let i = 0; i < identity.length; i++) {
    h = ((h << 5) - h + identity.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(h) % PALETTE.length]
}

export function ParticipantStrip({
  selfName,
  selfEmail,
  selfAvatarUrl,
  selfIsOrganizer,
}: {
  selfName?: string
  selfEmail?: string
  selfAvatarUrl?: string | null
  selfIsOrganizer?: boolean
} = {}) {
  const allParticipants = useParticipants()
  const participants = allParticipants.filter((p) => !isAgentParticipant(p))
  const { localParticipant } = useLocalParticipant()

  const sorted = [...participants].sort((a, b) => {
    // Self always first — reference equality so this works even before
    // localParticipant.identity is populated.
    if (a === localParticipant) return -1
    if (b === localParticipant) return 1
    const aHand = isHandRaised(a.metadata)
    const bHand = isHandRaised(b.metadata)
    if (aHand !== bHand) return aHand ? -1 : 1
    if (a.isSpeaking !== b.isSpeaking) return a.isSpeaking ? -1 : 1
    const aCtx = { isSelf: false, selfName, selfEmail }
    return displayName(a, aCtx).localeCompare(displayName(b, aCtx))
  })

  const visible = sorted.slice(0, MAX_VISIBLE)
  const overflow = Math.max(0, sorted.length - visible.length)

  return (
    <div className="flex items-center gap-1 bg-black/40 backdrop-blur-md border border-white/10 rounded-full pl-1.5 pr-2 py-1">
      <div className="flex items-center -space-x-1.5">
        {visible.map((p) => {
          const isSelf = p === localParticipant
          const name = displayName(p, { isSelf, selfName, selfEmail })
          const handRaised = isHandRaised(p.metadata)
          // Use the registered Vaidix avatar for the local user when we
          // have it. Remote participants don't (yet) ship their avatar
          // through LiveKit metadata — TODO: pass it via JWT metadata
          // when minting peer tokens.
          const avatar = isSelf ? selfAvatarUrl : null
          return (
            <motion.div
              key={p.identity || (isSelf ? 'self' : name)}
              layout
              title={isSelf ? `${name} (you)` : name}
              className="relative"
            >
              <div
                className={cn(
                  'relative w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ring-2 ring-zinc-900 overflow-hidden',
                  avatar ? 'bg-zinc-800 text-white' : colorFor(p.identity),
                  p.isSpeaking && 'ring-emerald-400/70',
                )}
              >
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt={name} className="absolute inset-0 size-full object-cover" />
                ) : (
                  initials(name)
                )}
              </div>
              {handRaised && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1, rotate: [0, -15, 15, 0] }}
                  transition={{
                    scale: { type: 'spring', stiffness: 360, damping: 16 },
                    rotate: { duration: 0.6, ease: 'easeInOut' },
                  }}
                  className="absolute -top-1.5 -right-1.5 text-[11px] leading-none drop-shadow pointer-events-none"
                >
                  ✋
                </motion.span>
              )}
              {/* Organizer indicator — small emerald dot, corporate-clean.
                  Green reads as "host / authoritative" in conferencing UIs
                  (Teams/Meet/Webex all use it for similar roles). The full
                  "Organizer" label lives in the People panel; this is just
                  a quiet at-a-glance marker. */}
              {isSelf && selfIsOrganizer && (
                <span
                  title="Organizer"
                  aria-label="Organizer"
                  className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-zinc-900 pointer-events-none"
                />
              )}
            </motion.div>
          )
        })}
      </div>
      {overflow > 0 && (
        <span className="ml-1 text-[11px] font-semibold text-white/70 px-1.5 py-0.5 bg-white/8 rounded-full">
          +{overflow}
        </span>
      )}
    </div>
  )
}
