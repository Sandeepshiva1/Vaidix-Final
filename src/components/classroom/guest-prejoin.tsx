'use client'

// ════════════════════════════════════════════════════════════════════════════
// GuestPrejoin — anonymous-guest lobby for openToAll sessions
// ════════════════════════════════════════════════════════════════════════════
// Three states the screen walks through (no page navigation in between):
//
//   1. NAME           Type a display name + press "Ask to join". A short
//                     POST registers the guest in the waiting room and sets
//                     an HttpOnly cookie keyed to this sessionId.
//   2. WAITING        Polls every 2s for admission status. Host sees the
//                     guest's name in the in-call sidebar and clicks
//                     Admit / Deny.
//   3. JOINED         Mounts a minimal LiveKitRoom — audio + camera +
//                     screen-share controls only. Chat, Q&A, breakouts and
//                     all other Vaidix surfaces stay gated behind a real
//                     user account; the live media itself works.
//
// Teams-parity notes:
//   - First load shows no Vaidix branding bigger than necessary; the focus
//     is the "you've been invited to this meeting" card.
//   - DENIED is a terminal state for this admission; user can press "Try
//     again" which resets to NAME (and the next POST refreshes the row
//     back to PENDING via the service's re-request logic).
//   - We never persist personal info — the name is only on the admission
//     row and on the LiveKit participant identity, both ephemeral.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  ParticipantTile,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { DisconnectReason, Track } from 'livekit-client'
import { isAgentParticipant } from '@/lib/livekit-helpers'
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, Monitor, MonitorOff,
  PhoneOff, Loader2, Clock, Shield, LogIn,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AudioPlaybackGate, AudioOutputButton } from './audio-playback-gate'

type JoinedPhase = 'live' | 'reconnecting' | 'lost'

type LobbyState =
  | { kind: 'NAME' }
  | { kind: 'WAITING'; admissionId: string }
  | { kind: 'JOINED'; token: string; url: string; role: 'PARTICIPANT' | 'VIEWER'; phase: JoinedPhase }
  | { kind: 'DENIED'; reason: string | null }
  | { kind: 'NOT_PERMITTED' }

type PollResult =
  | { state: 'WAITING'; admissionId: string }
  | { state: 'JOINED'; token: string; url: string; role: 'PARTICIPANT' | 'VIEWER' }
  | { state: 'DENIED'; reason: string | null }
  | { state: 'UNKNOWN' }

// DisconnectReason codes that mean "the room kicked us out for good" — no
// point trying to re-mint a token, the operator/host decided we're done.
// Everything else (signal-close, state-mismatch, join-failure, unknown) is
// treated as a transient network event and we attempt a fresh join with a
// new short-lived JWT from /guest. Reference: livekit-protocol DisconnectReason.
const TERMINAL_DISCONNECT_REASONS = new Set<DisconnectReason>([
  DisconnectReason.CLIENT_INITIATED,    // user clicked Leave
  DisconnectReason.PARTICIPANT_REMOVED, // host removed them
  DisconnectReason.ROOM_DELETED,        // host ended the session
  DisconnectReason.USER_REJECTED,       // moderation reject
  DisconnectReason.DUPLICATE_IDENTITY,  // another tab took over — don't fight it
])

// How long the silent re-join is allowed to try before we surface a "Connection
// lost" panel. 30s matches the LiveKit SDK's own reconnect timeout and lines
// up with what users perceive as "should have come back by now."
const RECONNECT_BUDGET_MS = 30_000
// 1.5s was a tight loop that spiked network/CPU during any blip. 4s still
// recovers well within the budget without hammering the endpoint.
const RECONNECT_POLL_MS = 4000

export interface GuestPrejoinProps {
  sessionId: string
  title: string
  hostName: string
  hostAvatarUrl: string | null
  scheduledStart: string
  scheduledEnd: string
}

export function GuestPrejoin(props: GuestPrejoinProps) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<LobbyState>({ kind: 'NAME' })
  const router = useRouter()

  // ── Poll while waiting ──────────────────────────────────────────────────
  useEffect(() => {
    if (state.kind !== 'WAITING') return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/classroom/sessions/${props.sessionId}/guest`, {
          method: 'GET',
          cache: 'no-store',
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok) return
        const data = json.data as PollResult
        if (cancelled) return
        if (data.state === 'JOINED') {
          setState({ kind: 'JOINED', token: data.token, url: data.url, role: data.role, phase: 'live' })
        } else if (data.state === 'DENIED') {
          setState({ kind: 'DENIED', reason: data.reason })
        }
      } catch {
        // Network blip — keep polling.
      }
    }
    void tick()
    const handle = window.setInterval(tick, 2000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [state.kind, props.sessionId, state])

  const submit = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Please enter your name.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${props.sessionId}/guest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        const code = json?.error?.code as string | undefined
        if (code === 'OPEN_NOT_PERMITTED') {
          setState({ kind: 'NOT_PERMITTED' })
          return
        }
        setError(json?.error?.message ?? 'Could not request to join. Try again.')
        return
      }
      setState({ kind: 'WAITING', admissionId: json.data.admissionId })
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }, [name, props.sessionId])

  const tryAgain = useCallback(() => {
    setState({ kind: 'NAME' })
    setError(null)
  }, [])

  // ── Reconnect path ─────────────────────────────────────────────────────
  // When LiveKit's onDisconnected fires for a non-terminal reason we drop the
  // state to `phase: 'reconnecting'` instead of recycling to the NAME prompt.
  // This effect then polls GET /guest, which re-mints a fresh LiveKit JWT
  // each call, and swaps it into state. Changing `token` keys the LiveKitRoom
  // so it remounts cleanly. From the host's perspective the guest's name
  // briefly shows a "Reconnecting…" badge instead of disappearing-and-
  // reappearing-as-a-new-guest, which is what the older recycle-to-lobby
  // path produced and what users described as "logged out and back in."
  useEffect(() => {
    if (state.kind !== 'JOINED' || state.phase !== 'reconnecting') return
    let cancelled = false
    const startedAt = Date.now()
    const tick = async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/classroom/sessions/${props.sessionId}/guest`, {
          method: 'GET',
          cache: 'no-store',
        })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (res.ok && json?.ok && json.data?.state === 'JOINED') {
          const data = json.data as Extract<PollResult, { state: 'JOINED' }>
          setState({
            kind: 'JOINED',
            token: data.token,
            url: data.url,
            role: data.role,
            phase: 'live',
          })
          return
        }
        if (res.ok && json?.ok && json.data?.state === 'DENIED') {
          // Host ended/denied while we were trying to recover — surface that
          // rather than spinning forever.
          setState({ kind: 'DENIED', reason: json.data?.reason ?? null })
          return
        }
      } catch {
        // Network blip — keep polling until the budget runs out.
      }
      if (!cancelled && Date.now() - startedAt > RECONNECT_BUDGET_MS) {
        setState((prev) =>
          prev.kind === 'JOINED' && prev.phase === 'reconnecting'
            ? { ...prev, phase: 'lost' }
            : prev,
        )
      }
    }
    void tick()
    const handle = window.setInterval(tick, RECONNECT_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [state, props.sessionId])

  // ── JOINED → render LiveKit room ────────────────────────────────────────
  if (state.kind === 'JOINED') {
    return (
      <GuestLiveRoom
        // Key on token so a fresh mint after reconnect re-mounts the room
        // exactly once instead of trying to mutate the existing peer
        // connection (which is the bug source we're patching).
        key={state.token}
        token={state.token}
        url={state.url}
        title={props.title}
        canPublish={state.role === 'PARTICIPANT'}
        phase={state.phase}
        onDisconnected={(reason) => {
          if (reason !== undefined && TERMINAL_DISCONNECT_REASONS.has(reason)) {
            // User-initiated leave or host kick — bail back to the lobby.
            setState({ kind: 'NAME' })
            router.refresh()
            return
          }
          // Anything else: network blip, signal close, state mismatch, etc.
          // Stay in JOINED, surface the overlay, let the reconnect effect
          // refresh the token. The cookie + admission persist server-side.
          setState((prev) =>
            prev.kind === 'JOINED' && prev.phase === 'live'
              ? { ...prev, phase: 'reconnecting' }
              : prev,
          )
        }}
        onManualLeave={() => {
          setState({ kind: 'NAME' })
          router.refresh()
        }}
        onRetryAfterLost={tryAgain}
      />
    )
  }

  // ── Pre-join chrome (NAME / WAITING / DENIED / NOT_PERMITTED) ──────────
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-linear-to-br from-slate-50 via-white to-emerald-50 px-4 py-12 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_25%_15%,rgba(16,185,129,0.08),transparent_55%),radial-gradient(circle_at_75%_85%,rgba(59,130,246,0.08),transparent_55%)]" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-2xl border border-border bg-card/90 p-8 shadow-xl backdrop-blur"
      >
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Vaidix Live
          </p>
          <h1 className="mt-1 line-clamp-2 text-xl font-semibold text-foreground">
            {props.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hosted by {props.hostName}
          </p>
          <ScheduleLine start={props.scheduledStart} end={props.scheduledEnd} />
        </div>

        <AnimatePresence mode="wait">
          {state.kind === 'NAME' && (
            <motion.div
              key="name"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <label htmlFor="guest-name" className="text-sm font-medium text-foreground">
                Your name
              </label>
              <Input
                id="guest-name"
                value={name}
                placeholder="e.g. Dr. Priya Rao"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !submitting) void submit()
                }}
                disabled={submitting}
                autoFocus
                maxLength={80}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                This is what other participants will see.
              </p>
              {error && (
                <p className="mt-2 text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button
                onClick={() => void submit()}
                disabled={submitting || !name.trim()}
                className="mt-4 w-full"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : 'Ask to join'}
              </Button>
              <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Shield className="size-3.5" />
                Waiting room enabled — the host will let you in.
              </div>
              <a
                href={`/login?next=/classroom/${props.sessionId}`}
                className="mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                <LogIn className="size-3.5" />
                Have a Vaidix account? Sign in instead.
              </a>
            </motion.div>
          )}

          {state.kind === 'WAITING' && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
                <Loader2 className="size-6 animate-spin text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="mt-4 text-base font-semibold">Waiting for the host…</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We&apos;ve let <strong>{props.hostName ?? 'the host'}</strong>{' '}know you&apos;re here.{' '}
                You&apos;ll join the call as soon as you&apos;re admitted.
              </p>
            </motion.div>
          )}

          {state.kind === 'DENIED' && (
            <motion.div
              key="denied"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              <h2 className="text-base font-semibold text-destructive">Join request declined</h2>
              {state.reason && (
                <p className="mt-1 text-sm text-muted-foreground">{state.reason}</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                If you think this is a mistake, sign in with a Vaidix account or contact the host.
              </p>
              <Button variant="outline" onClick={tryAgain} className="mt-4 w-full">
                Try again
              </Button>
            </motion.div>
          )}

          {state.kind === 'NOT_PERMITTED' && (
            <motion.div
              key="not-permitted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              <h2 className="text-base font-semibold">This session needs a sign-in</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The host has not enabled guest join for this meeting.
              </p>
              <a
                href={`/login?next=/classroom/${props.sessionId}`}
                className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
              >
                Sign in to join
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function ScheduleLine({ start, end }: { start: string; end: string }) {
  const text = useMemo(() => {
    const s = new Date(start)
    const e = new Date(end)
    const sameDay = s.toDateString() === e.toDateString()
    const dateFmt = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    const timeFmt = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    return sameDay
      ? `${dateFmt.format(s)} · ${timeFmt.format(s)} – ${timeFmt.format(e)}`
      : `${dateFmt.format(s)} ${timeFmt.format(s)} → ${dateFmt.format(e)} ${timeFmt.format(e)}`
  }, [start, end])
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="size-3.5" />
      {text}
    </p>
  )
}

// ─── Minimal LiveKit room for guests ─────────────────────────────────────────
// Stripped to media-only so we don't accidentally surface authed-user
// surfaces (chat, QA, breakouts) that would 401 every poll. Members of the
// session see the guest in the LiveKit participant list and can chat with
// them via raised-hand / spoken signals — exactly the Teams-guest contract.

function GuestLiveRoom({
  token,
  url,
  title,
  canPublish,
  phase,
  onDisconnected,
  onManualLeave,
  onRetryAfterLost,
}: {
  token: string
  url: string
  title: string
  canPublish: boolean
  phase: JoinedPhase
  /// Forwarded straight to LiveKit; parent decides terminal vs transient.
  onDisconnected: (reason?: DisconnectReason) => void
  /// User explicitly clicked the in-call leave button; always terminal.
  onManualLeave: () => void
  /// Shown only in the "lost" panel — recycles to the NAME prompt.
  onRetryAfterLost: () => void
}) {
  // "Lost" is the terminal state for our internal reconnect attempt — the
  // LiveKitRoom is unmounted while we render the recovery panel so a still-
  // alive peer connection doesn't keep churning behind it.
  if (phase === 'lost') {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-slate-950 px-4 text-white">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-xl backdrop-blur">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-500/15">
            <Loader2 className="size-6 text-amber-300" />
          </div>
          <h2 className="mt-4 text-base font-semibold">Connection lost</h2>
          <p className="mt-1 text-sm text-white/70">
            We couldn&apos;t reconnect you to {title}. Check your network and try again.
          </p>
          <Button
            variant="secondary"
            className="mt-5 w-full bg-white/10 text-white hover:bg-white/20"
            onClick={onRetryAfterLost}
          >
            Rejoin
          </Button>
        </div>
      </div>
    )
  }

  // Wrap LiveKitRoom in a plain fixed div — LiveKit injects `lk-room-container`
  // which carries `position: relative` from @livekit/components-styles, winning
  // the cascade over a Tailwind `fixed` on the same element. Same pattern used
  // by InnerRoom in live-session.tsx.
  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-slate-950">
      <LiveKitRoom
        token={token}
        serverUrl={url}
        connect
        audio={canPublish}
        // video intentionally omitted — camera starts off; user enables manually.
        // auto-enabling video on mount causes a browser-permission race where the
        // camera flashes briefly then the GuestControls state (optimistic true)
        // immediately turns it back off when the user tries to "turn it on."
        onDisconnected={onDisconnected}
        data-lk-theme="default"
        className="h-full"
      >
        <div className="relative flex h-full flex-col text-white overflow-hidden">
          <GuestHeader title={title} />
          <main className="flex-1 overflow-hidden p-3">
            <GuestStage />
          </main>
          <RoomAudioRenderer />
          <AudioPlaybackGate />
          <GuestControls canPublish={canPublish} onLeave={onManualLeave} />
          {phase === 'reconnecting' && <ReconnectingOverlay />}
        </div>
      </LiveKitRoom>
    </div>
  )
}

/// Translucent overlay shown while we silently re-mint the token after a
/// transient LiveKit disconnect. Carries no buttons — the reconnect attempt
/// times out into the "lost" panel which is where the user can decide what
/// to do. role="status" + aria-live="polite" so screen readers announce it.
function ReconnectingOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-sm shadow-lg ring-1 ring-white/20">
        <Loader2 className="size-4 animate-spin text-emerald-300" />
        <span>Reconnecting&hellip;</span>
      </div>
    </div>
  )
}

function GuestHeader({ title }: { title: string }) {
  const allParticipants = useParticipants()
  const participants = allParticipants.filter((p) => !isAgentParticipant(p))
  const count = participants.length
  return (
    <header className="flex items-center justify-between border-b border-white/5 bg-black/40 px-4 py-2.5 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate font-semibold">{title}</span>
        <span className="hidden items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/70 sm:inline-flex">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
          </span>
          {count} {count === 1 ? 'person' : 'people'}
        </span>
      </div>
      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
        Guest
      </span>
    </header>
  )
}

function GuestStage() {
  // Surface every kind of activity, not just camera/screen-share:
  //   - Camera with placeholder — participants get a tile even if their
  //     camera is off (avatar + name placeholder).
  //   - Microphone with placeholder — audio-only participants (host
  //     speaking with no camera, common for lectures) still get a tile
  //     instead of vanishing from the grid.
  //   - ScreenShare — appears as its own tile when someone shares.
  // The previous version only subscribed to Camera + ScreenShare, which
  // is why a session where the host had camera off looked like an empty
  // black screen to guests.
  const rawTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Microphone, withPlaceholder: true },
    ],
    { onlySubscribed: false },
  )
  // Filter agent placeholders before deduping — withPlaceholder:true creates
  // a tile per participant (including the captions agent), so without this
  // the guest grid would show a giant "agent-AJ_xxx" empty tile.
  const tracks = rawTracks.filter((t) => !isAgentParticipant(t.participant))
  // Dedupe by participant — useTracks returns one row per source per
  // participant, so a host with mic+camera would get TWO tiles otherwise.
  // Prefer camera/screen-share when both exist for the same participant.
  const seen = new Set<string>()
  const sorted = [...tracks].sort((a, b) => {
    const rank = (s: Track.Source) =>
      s === Track.Source.ScreenShare ? 0 : s === Track.Source.Camera ? 1 : 2
    return rank(a.source) - rank(b.source)
  })
  const deduped = sorted.filter((t) => {
    const key = `${t.participant.identity}:${t.source === Track.Source.ScreenShare ? 'ss' : 'main'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Promote screen-share to the focus area when present (QA #6); cameras drop
  // into a thumbnail carousel beside it. Mirrors the host/attendee layout in
  // live-session.tsx so the guest experience matches Teams/Zoom expectations.
  const screenShareTracks = deduped.filter((t) => t.source === Track.Source.ScreenShare)
  const cameraTracks      = deduped.filter((t) => t.source !== Track.Source.ScreenShare)
  if (screenShareTracks.length > 0) {
    const focused = screenShareTracks[screenShareTracks.length - 1]
    return (
      <FocusLayoutContainer className="h-full rounded-2xl bg-black/30 ring-1 ring-white/5">
        <CarouselLayout tracks={cameraTracks}>
          <ParticipantTile />
        </CarouselLayout>
        <FocusLayout trackRef={focused} />
      </FocusLayoutContainer>
    )
  }

  return (
    <GridLayout tracks={deduped} className="h-full rounded-2xl bg-black/30 ring-1 ring-white/5">
      <ParticipantTile />
    </GridLayout>
  )
}

// GuestControls lives inside <LiveKitRoom> so useLocalParticipant() works here.
// We read isMicrophoneEnabled / isCameraEnabled from LiveKit directly instead of
// tracking independent boolean state — the old pattern started as micOn=true /
// camOn=true but LiveKit's own camera-enable (from video={true} on <LiveKitRoom>)
// could race with browser permissions, leaving the buttons in an inverted state
// where every click did the opposite of what the user expected.
function GuestControls({ canPublish, onLeave }: { canPublish: boolean; onLeave: () => void }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const [shareOn, setShareOn] = useState(false)
  const [sharing, setSharing] = useState(false)

  const toggleMic = useCallback(async () => {
    await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {/* ignore */})
  }, [localParticipant, isMicrophoneEnabled])

  const toggleCam = useCallback(async () => {
    await localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {/* ignore */})
  }, [localParticipant, isCameraEnabled])

  const toggleShare = useCallback(async () => {
    if (sharing) return
    setSharing(true)
    const next = !shareOn
    try {
      await localParticipant.setScreenShareEnabled(next)
      const pub = localParticipant.getTrackPublication(Track.Source.ScreenShare)
      setShareOn(next ? !!pub && !pub.isMuted : false)
    } catch {
      // user cancelled OS source picker — don't flip shareOn
    } finally {
      setSharing(false)
    }
  }, [sharing, shareOn, localParticipant])

  return (
    <footer className="flex items-center justify-center gap-3 border-t border-white/10 bg-black/60 px-4 py-3">
      {canPublish && (
        <>
          <Button
            size="icon"
            variant={isMicrophoneEnabled ? 'secondary' : 'destructive'}
            onClick={toggleMic}
            title={isMicrophoneEnabled ? 'Mute mic' : 'Unmute mic'}
          >
            {isMicrophoneEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          </Button>
          <Button
            size="icon"
            variant={isCameraEnabled ? 'secondary' : 'destructive'}
            onClick={toggleCam}
            title={isCameraEnabled ? 'Stop camera' : 'Start camera'}
          >
            {isCameraEnabled ? <VideoIcon className="size-4" /> : <VideoOff className="size-4" />}
          </Button>
          <Button
            size="icon"
            variant={shareOn ? 'default' : 'secondary'}
            onClick={toggleShare}
            disabled={sharing}
            title={shareOn ? 'Stop sharing' : 'Share screen'}
          >
            {sharing
              ? <Loader2 className="size-4 animate-spin" />
              : shareOn
                ? <MonitorOff className="size-4" />
                : <Monitor className="size-4" />}
          </Button>
        </>
      )}
      {/* Speaker picker is available to everyone — even view-only guests need
          to route audio to the right output device. */}
      <AudioOutputButton />
      <Button size="icon" variant="destructive" onClick={onLeave} title="Leave call">
        <PhoneOff className="size-4" />
      </Button>
    </footer>
  )
}
