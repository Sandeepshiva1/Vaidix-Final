'use client'

// Custom ParticipantTile wrapper that adds:
//   1. A host-only spotlight star button (top-right corner) that toggles
//      between SET (this participant) and CLEAR. Non-host viewers see no
//      button — keeps their tile chrome minimal.
//   2. A Teams-style avatar circle overlay when the participant's camera is
//      off / muted / unsubscribed. Replaces LiveKit's flat grey placeholder
//      with a colored circle showing the user's photo or initials, so a
//      camera-off room still feels like real people are present.
//
// The avatar overlay sits ABOVE LiveKit's placeholder via z-index. As soon
// as the camera turns on the LiveKit video element renders behind, and we
// detect the unmuted track and hide the avatar.

import { ParticipantTile, useEnsureTrackRef, useRoomContext } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-core'
import { Track } from 'livekit-client'
import { Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ParticipantAvatarCircle } from './participant-avatar-circle'

interface SpotlightTileProps {
  isHostish: boolean
  spotlightedIdentity: string | null
  onToggleSpotlight: (identity: string | null) => void
  trackRef?: TrackReferenceOrPlaceholder
  /** Visual hint forwarded to the avatar overlay. Carousel thumbs use 'thumb'. */
  avatarSize?: 'tile' | 'thumb'
  /** When true, suppress the host-only spotlight star (e.g. inside a breakout). */
  hideSpotlight?: boolean
  /**
   * Local user's display name from auth context. Forwarded to the avatar
   * overlay as `fallbackName` for the LOCAL participant only — covers the
   * "Still connecting" window where LiveKit's `participant.name` field can
   * briefly be empty before the JWT name claim propagates. Without this the
   * local user sees a generic-icon avatar for a few seconds during connect,
   * which reads as a bug.
   */
  localUserName?: string | null
}

/**
 * Drop-in replacement for LiveKit's `<ParticipantTile />` that adds a
 * spotlight toggle and a personalised avatar overlay. Pass it as the child
 * of `<GridLayout>` (or `<CarouselLayout>` with `avatarSize='thumb'`).
 */
export function SpotlightTile({
  isHostish,
  spotlightedIdentity,
  onToggleSpotlight,
  trackRef: trackRefProp,
  avatarSize = 'tile',
  hideSpotlight = false,
  localUserName,
}: SpotlightTileProps) {
  // GridLayout + CarouselLayout both call the child with a track ref via
  // context — useEnsureTrackRef resolves either the explicit prop or the
  // contextual one.
  const trackRef = useEnsureTrackRef(trackRefProp)
  const room = useRoomContext()
  const identity = trackRef.participant.identity
  const name = trackRef.participant.name
  const isSpotlit = spotlightedIdentity === identity

  // Only forward the local user's auth-context name to the avatar overlay
  // when this tile actually IS the local participant. For remote tiles,
  // participant.name should be populated by the time their tile renders.
  const isLocalUser = identity === room.localParticipant.identity
  const fallbackName = isLocalUser ? localUserName : null

  // "Camera is off" = the camera publication is missing, muted, or has no
  // attached track yet. Screen-share tiles (when hasScreenShare is true and
  // we render a shared screen instead) won't hit this branch because their
  // source is ScreenShare, not Camera. We only hide the avatar when there's
  // a *playing* camera track.
  const cameraOff = (() => {
    if (trackRef.source !== Track.Source.Camera) return false
    const pub = trackRef.publication
    if (!pub) return true
    if (pub.isMuted) return true
    if (!pub.track) return true
    return false
  })()

  // Vaidix wires `avatarUrl` into participant metadata at token-mint time
  // (server/services/livekit/...). We read it defensively — if the field is
  // absent or the metadata isn't JSON, deriveInitials() in the avatar
  // component degrades to initials over a deterministic colour.
  const avatarUrl = (() => {
    const meta = trackRef.participant.metadata
    if (!meta) return null
    try {
      const parsed = JSON.parse(meta) as { avatarUrl?: unknown }
      return typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : null
    } catch {
      return null
    }
  })()

  return (
    <div className="relative h-full w-full group">
      <ParticipantTile trackRef={trackRef} />
      {cameraOff && (
        <ParticipantAvatarCircle
          identity={identity}
          name={name}
          fallbackName={fallbackName}
          avatarUrl={avatarUrl}
          size={avatarSize}
        />
      )}
      {isHostish && !hideSpotlight && (
        <button
          type="button"
          onClick={() => onToggleSpotlight(isSpotlit ? null : identity)}
          title={isSpotlit ? 'Remove spotlight' : `Spotlight ${trackRef.participant.name ?? identity}`}
          aria-label={isSpotlit ? 'Remove spotlight' : `Spotlight ${trackRef.participant.name ?? identity}`}
          data-testid="spotlight-toggle"
          data-identity={identity}
          data-spotlit={isSpotlit ? 'true' : 'false'}
          className={cn(
            'absolute top-2 right-2 z-20 rounded-full p-1.5 backdrop-blur-md border transition-all duration-150',
            isSpotlit
              ? 'bg-amber-400/85 text-zinc-900 border-amber-300 shadow-md shadow-amber-500/40'
              : 'bg-black/45 text-white/85 border-white/10 hover:bg-black/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          )}
        >
          {isSpotlit ? <X className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  )
}
