'use client'

// ParticipantAvatarCircle — Teams/Meet-style avatar fallback when a
// participant's camera is off (or their video track hasn't subscribed yet).
//
// Why we need this: LiveKit's default tile placeholder is a flat gray box.
// In a 2-person call where neither has a camera on, that means both tiles
// look identical and dead — no signal to the viewer that real people are in
// the room. Replacing the placeholder with a personalised circle (photo or
// initials) restores the social feel of the call.
//
// Design choices, mirroring the Teams reference the user shared:
//   - Centered circle, ~40% of the smaller tile dimension.
//   - Subtle accent ring around the circle so it reads as a presence indicator.
//   - When `avatarUrl` is provided we render the photo; otherwise we render
//     two-letter initials over a deterministic colour derived from the
//     participant identity. Same identity → same colour every time, so a
//     learner's avatar looks consistent across reconnects.
//   - Underneath the circle we mirror LiveKit's name plate so the tile still
//     identifies the person at a glance. This is intentionally NOT inside the
//     circle (Teams keeps name + circle as two stacked elements).
//
// Fallback chain when name is missing (e.g. during the "Still connecting"
// phase before the JWT name claim has propagated to the participant object):
//   1. Use the `name` prop if non-empty.
//   2. Use the `fallbackName` prop (caller's best guess — usually the local
//      user's name from the auth session, since the local participant's
//      LiveKit name field can briefly be empty during connection).
//   3. Try to extract a sensible initial from the identity, skipping
//      CUID/UUID-like opaque ids.
//   4. Render a generic User icon — never "?", which reads as a render error.

import Image from 'next/image'
import { User } from 'lucide-react'

interface ParticipantAvatarCircleProps {
  /** Stable participant identity — used to seed the deterministic colour */
  identity: string
  /** Display name. Empty / 'Guest' fallback handled in derive helper */
  name: string | undefined
  /**
   * Caller-provided last-resort name. Use this for the LOCAL participant —
   * `participant.name` from LiveKit can be empty for a few seconds during
   * the initial WebSocket handshake (the JWT name claim hasn't propagated
   * to the participant object yet). Pass currentUser.name from auth context
   * so the local user's tile never shows a generic icon during connecting.
   */
  fallbackName?: string | null
  /** Optional photo URL. If absent we draw initials. */
  avatarUrl?: string | null
  /**
   * Visual size hint. 'tile' fills a normal grid cell; 'thumb' is for the
   * carousel layout (when a screen share is focused). The component scales
   * itself with `aspect-square w-full h-full` so it always fits its parent —
   * the size prop only nudges the typography.
   */
  size?: 'tile' | 'thumb'
}

/// Vaidix-friendly palette. Pulled from the existing Tailwind theme so
/// circles slot into the dark room aesthetic. Each colour is paired with a
/// readable text colour so initials always meet WCAG AA over their background.
const PALETTE: Array<{ bg: string; ring: string; text: string }> = [
  { bg: 'bg-rose-600',    ring: 'ring-rose-300/60',    text: 'text-rose-50' },
  { bg: 'bg-amber-600',   ring: 'ring-amber-300/60',   text: 'text-amber-50' },
  { bg: 'bg-emerald-600', ring: 'ring-emerald-300/60', text: 'text-emerald-50' },
  { bg: 'bg-teal-600',    ring: 'ring-teal-300/60',    text: 'text-teal-50' },
  { bg: 'bg-sky-600',     ring: 'ring-sky-300/60',     text: 'text-sky-50' },
  { bg: 'bg-indigo-600',  ring: 'ring-indigo-300/60',  text: 'text-indigo-50' },
  { bg: 'bg-violet-600',  ring: 'ring-violet-300/60',  text: 'text-violet-50' },
  { bg: 'bg-fuchsia-600', ring: 'ring-fuchsia-300/60', text: 'text-fuchsia-50' },
]

/**
 * Pick a stable palette index for an identity string. Uses a tiny FNV-1a
 * style mix so the same identity always lands on the same colour, but two
 * adjacent participants don't usually collide.
 */
function paletteFor(identity: string) {
  let hash = 2166136261
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const idx = Math.abs(hash) % PALETTE.length
  return PALETTE[idx]
}

/**
 * Derive 1–2 character initials from a display name. Strips clinical
 * honorifics (Dr., Prof.) so "Dr. Priya Sharma" → "PS", not "DP".
 *
 * Returns `null` (not "?") when no usable initials can be derived — caller
 * is expected to render an icon in that case so a missing name never reads
 * as a literal question-mark error.
 */
export function deriveInitials(name: string | undefined | null): string | null {
  if (!name) return null
  const cleaned = name.replace(/^(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '').trim()
  if (!cleaned) return null
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Pick the best available human-readable name from the candidates. Skips
 * opaque CUID/UUID-like identities (lowercase + digits, ≥20 chars, no
 * whitespace) — those would produce meaningless initials like "CM".
 */
function chooseDisplayName(
  primary: string | undefined | null,
  fallback: string | undefined | null,
  identity: string,
): string | null {
  const primaryClean = primary?.trim()
  if (primaryClean) return primaryClean
  const fallbackClean = fallback?.trim()
  if (fallbackClean) return fallbackClean
  // Strip our own conventional prefixes ("guest_" from the guest token route)
  // so a guest identity like "guest_abc123" doesn't produce "GU".
  const idClean = identity.replace(/^(guest_|user_)/, '').trim()
  if (!idClean) return null
  // Heuristic: a CUID/UUID is all-lowercase alphanumerics with no spaces and
  // ≥20 chars. Treat as opaque — caller will render the icon fallback.
  if (/^[a-z0-9-]{20,}$/.test(idClean)) return null
  return idClean
}

export function ParticipantAvatarCircle({
  identity,
  name,
  fallbackName,
  avatarUrl,
  size = 'tile',
}: ParticipantAvatarCircleProps) {
  const displayName = chooseDisplayName(name, fallbackName, identity)
  const initials = deriveInitials(displayName)
  const swatch = paletteFor(identity)

  // Tile size targets: ~110px circle on a 280px tile (40%) for grid;
  // ~56px on a 140px thumb. Container is `aspect-square w-[40%] max-w-[160px]`
  // so the circle stays proportional regardless of tile aspect ratio.
  const sizeClasses =
    size === 'tile'
      ? 'w-[40%] max-w-[160px] min-w-[64px] text-3xl md:text-4xl'
      : 'w-[55%] max-w-[80px] min-w-[44px] text-base md:text-lg'

  // The wrapper covers the entire LiveKit tile (absolute inset-0) so it
  // sits ON TOP of LiveKit's grey placeholder. When the camera turns on,
  // the parent <ParticipantTile /> renders the video and we hide.
  // Tailwind v4 canonical: bg-linear-to-br (was bg-gradient-to-br in v3).
  return (
    <div
      data-testid="participant-avatar-circle"
      data-identity={identity}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none bg-linear-to-br from-zinc-900/85 via-zinc-950/85 to-black/85"
    >
      <div
        className={[
          'aspect-square rounded-full overflow-hidden ring-4 flex items-center justify-center font-semibold tracking-tight',
          swatch.bg,
          swatch.ring,
          swatch.text,
          sizeClasses,
        ].join(' ')}
      >
        {avatarUrl ? (
          // next/image needs explicit dimensions; we're inside a flex+aspect
          // container so width/height of 200 is just an intrinsic hint —
          // the CSS controls actual render size.
          <Image
            src={avatarUrl}
            alt={displayName ?? 'Participant'}
            width={200}
            height={200}
            className="w-full h-full object-cover"
            unoptimized
          />
        ) : initials ? (
          <span aria-hidden>{initials}</span>
        ) : (
          // Last-resort: no name, no fallback, opaque identity. Render a
          // generic person icon — never "?", which reads as a render error
          // rather than "this person hasn't shared a name yet."
          <User className="w-1/2 h-1/2" aria-hidden />
        )}
      </div>
      {/* The name plate is small + muted — LiveKit also renders one over the
          tile, but its placeholder strips it. Re-adding our own keeps the
          tile identifiable when video is off. */}
      {displayName && (
        <span className="text-xs md:text-sm text-white/80 font-medium tracking-wide max-w-[80%] truncate">
          {displayName}
        </span>
      )}
    </div>
  )
}
