'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  useTracks,
  useLocalParticipant,
  useRoomContext,
  useDataChannel,
  useConnectionState,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { ConnectionState, DisconnectReason, Track } from 'livekit-client'
import { isAgentParticipant } from '@/lib/livekit-helpers'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff,
  PhoneOff, Hand, MessageSquare, Users, Trophy,
  LayoutGrid, Zap, Brain, X, Settings, Link2, ChevronDown,
  NotebookPen, Pencil, Loader2, Timer, AlarmClock,
} from 'lucide-react'
import { WaitingRoom } from './waiting-room'
import { PreJoin } from './pre-join'
import type { PrereqStatus } from '@/server/services/sessions/prereq'
import { ParticipantSidebar } from './participant-sidebar'
import { ParticipantStrip } from './participant-strip'
import { RoomPeoplePanel } from './room-people-panel'
import { HandRaiseNotifications } from './hand-raise-notifications'
import { NotificationSounds, NotificationSoundsToggle } from './notification-sounds'
import { useVideoRoomClient } from './video-room-client'
import { ChatPanel } from './chat-panel'
import { Button } from '@/components/ui/button'
import { HookOverlay } from '@/components/engagement/hook-overlay'
import { PresenterAlertsHud } from '@/components/engagement/presenter-alerts-hud'
import { LeaderboardPanel } from '@/components/engagement/leaderboard-panel'
import { HooksComposer } from '@/components/engagement/hooks-composer'
import { CoachPanel } from '@/components/engagement/coach-panel'
import {
  LiveCaptionsOverlay,
  CaptionControls,
  readCaptionPrefs,
  saveCaptionPrefs,
  type CaptionLangCode,
} from '@/components/engagement/live-captions-overlay'
import { PreflightBanner } from './preflight-banner'
import { BreakoutsPanel } from './breakouts-panel'
import { BreakoutRoomView } from './breakout-room-view'
import { BgPicker } from './bg-picker'
import { ReactionsBar, FloatingReactionsLayer } from './reactions-bar'
import { useSpotlight } from './spotlight'
import { SpotlightTile } from './spotlight-tile'
import { AnnotationOverlay } from './annotation-overlay'
import { NoiseSuppressionToggle } from './noise-suppression-toggle'
import { PictureInPictureButton } from './pip-button'
import { PopOutWindowButton } from './popout-button'
import { SharedNotesPanel } from './shared-notes-panel'
import { WhiteboardPanel } from './whiteboard-panel'
import { cn } from '@/lib/utils'

interface SessionInfo {
  id: string
  title: string
  description: string | null
  sessionType: string
  status: string
  approvalStatus: string
  scheduledStart: string
  scheduledEnd: string
  recordingEnabled: boolean
  consentRequired: boolean
  host: { id: string; name: string; email: string; avatarUrl: string | null }
  /// Live captions ASR provider for this session. 'english-only' wires
  /// Deepgram in the host's browser (Phase 1); 'indic-mix' is a Phase 2
  /// stub — the overlay shows but no live producer runs, the recording's
  /// post-batch transcript fills in after class. 'off' hides everything.
  captionsProfile: 'english-only' | 'indic-mix' | 'off'
}

type JoinState =
  | { kind: 'IDLE' }
  | { kind: 'FETCHING' }
  | { kind: 'WAITING'; admissionId: string }
  | { kind: 'DENIED'; reason?: string | null }
  | { kind: 'JOINED'; token: string; url: string; role: 'HOST' | 'CO_HOST' | 'PARTICIPANT' | 'VIEWER' }
  | { kind: 'ERROR'; message: string }

export function LiveSession({
  session,
  currentUser,
  shareToken,
  prereqStatus,
}: {
  session: SessionInfo
  currentUser: {
    id: string
    name: string
    email?: string
    avatarUrl?: string | null
    /// Vaidix role (FACULTY / RESIDENT / ADMIN / PROGRAM_DIRECTOR) — used
    /// to render the role badge next to your entry in the People panel.
    role?: string
    /// True when the local user is the host of this teaching session, so
    /// we can show an "Organizer" badge in addition to their role.
    isOrganizer?: boolean
  }
  shareToken?: string
  prereqStatus?: PrereqStatus | null
}) {
  const router = useRouter()
  const client = useVideoRoomClient()
  const [state, setState] = useState<JoinState>({ kind: 'IDLE' })
  const [consented, setConsented] = useState(!session.consentRequired)
  const [activeBreakout, setActiveBreakout] = useState<{ id: string; name: string } | null>(null)

  const requestToken = useCallback(async () => {
    setState({ kind: 'FETCHING' })
    try {
      const d = await client.getToken(session.id, { shareToken })
      if (d.state === 'JOINED') {
        setState({ kind: 'JOINED', token: d.token, url: d.url, role: d.role })
      } else if (d.state === 'WAITING') {
        setState({ kind: 'WAITING', admissionId: d.admissionId })
      } else if (d.state === 'DENIED') {
        setState({ kind: 'DENIED', reason: d.reason })
      }
    } catch (e) {
      setState({ kind: 'ERROR', message: (e as Error).message })
    }
  }, [session.id, shareToken, client])

  useEffect(() => {
    if (state.kind !== 'WAITING') return
    const iv = setInterval(async () => {
      try {
        const d = await client.getToken(session.id, { shareToken })
        if (d.state === 'JOINED') {
          setState({ kind: 'JOINED', token: d.token, url: d.url, role: d.role })
        } else if (d.state === 'DENIED') {
          setState({ kind: 'DENIED', reason: d.reason })
        }
      } catch {
        /* swallow — keep polling */
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [state.kind, session.id, shareToken, client])

  if (session.approvalStatus !== 'APPROVED') {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="rounded-lg border bg-card p-8 text-center">
          <h2 className="text-lg font-semibold">Session is not approved yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Waiting for faculty approval. Status: {session.approvalStatus.replace(/_/g, ' ')}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => router.push('/calendar')}>
            Back to calendar
          </Button>
        </div>
      </div>
    )
  }

  if (state.kind === 'JOINED') {
    if (activeBreakout) {
      const isFaculty = state.role === 'HOST' || state.role === 'CO_HOST'
      return (
        <BreakoutRoomView
          sessionId={session.id}
          breakoutId={activeBreakout.id}
          breakoutName={activeBreakout.name}
          isFaculty={isFaculty}
          onLeave={() => setActiveBreakout(null)}
        />
      )
    }
    return (
      <LiveRoom
        token={state.token}
        url={state.url}
        role={state.role}
        session={session}
        currentUser={currentUser}
        onLeave={() => router.push('/calendar')}
        onJoinBreakout={(b) => setActiveBreakout(b)}
      />
    )
  }

  if (state.kind === 'WAITING') {
    return <WaitingRoom session={session} onCancel={() => router.push('/calendar')} />
  }

  if (state.kind === 'DENIED') {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="rounded-2xl border border-border bg-card p-8 text-center max-w-md">
          <h2 className="text-lg font-semibold">Entry denied</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.reason ?? 'The host declined your request to join.'}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => router.push('/calendar')}>
            Back to calendar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <PreJoin
      session={session}
      consented={consented}
      onConsent={setConsented}
      onJoin={requestToken}
      loading={state.kind === 'FETCHING'}
      error={state.kind === 'ERROR' ? state.message : null}
      prereqStatus={prereqStatus ?? null}
      isHost={currentUser.id === session.host.id}
    />
  )
}

// ----------------------------------------------------------------------------
// Connected room wrapper
// ----------------------------------------------------------------------------
function LiveRoom({
  token,
  url,
  role,
  session,
  currentUser,
  onLeave,
  onJoinBreakout,
}: {
  token: string
  url: string
  role: 'HOST' | 'CO_HOST' | 'PARTICIPANT' | 'VIEWER'
  session: SessionInfo
  currentUser: {
    id: string
    name: string
    email?: string
    avatarUrl?: string | null
    /// Vaidix role (FACULTY / RESIDENT / ADMIN / PROGRAM_DIRECTOR) — used
    /// to render the role badge next to your entry in the People panel.
    role?: string
    /// True when the local user is the host of this teaching session, so
    /// we can show an "Organizer" badge in addition to their role.
    isOrganizer?: boolean
  }
  onLeave: () => void
  onJoinBreakout: (breakout: { id: string; name: string }) => void
}) {
  const isHostish = role === 'HOST' || role === 'CO_HOST'

  // Connection state machine.
  //   connecting   — initial mount, LiveKit hasn't fired onConnected yet
  //   connected    — healthy, room visible, no banner
  //   reconnecting — was connected, dropped, auto-retrying remount
  //   failed       — sustained failure (>FAIL_GRACE_MS in connecting, or
  //                  >MAX_RECONNECT_ATTEMPTS retries). Banner asks the user
  //                  whether to retry or leave; room stays mounted behind it.
  type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed'
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [phase, setPhase] = useState<0 | 1 | 2>(0)   // copy variant 0/1/2
  // Bumping `bumper` remounts <LiveKitRoom>, which is the only way to re-arm
  // the SDK's `connect` prop (read once on mount). We bump it ONLY on
  // first mount and in `manualRejoin` — never as an auto-recovery path.
  // Auto-bumping on a dropped connection used to trigger CLIENT_REQUEST_LEAVE
  // server-side, then re-join as a fresh participant (Reconnect:false) every
  // cycle, which looked to other participants like the user dropping and
  // re-joining every few seconds. Transient drops are now handled by the
  // SDK's own session-resume path, surfaced via <RoomReconnectWatcher>.
  const [bumper, setBumper] = useState(0)

  // Sidebar + whiteboard state lives at the LiveRoom level (above LiveKitRoom)
  // on purpose: a reconnect attempt bumps the LiveKitRoom key, which remounts
  // everything beneath it. If these lived inside InnerRoom they'd be wiped,
  // which is why the whiteboard collapsed ~2s after open (QA #13). Lifting
  // them up makes all panel state survive reconnects.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('chat')
  const [wbFullscreen, setWbFullscreen] = useState(false)

  const SLOW_CONNECT_MS = 5000
  const VERY_SLOW_MS = 15000
  const FAIL_GRACE_MS = 60000     // 60s before declaring initial connect failed

  // Drive the connecting-phase copy ("Connecting…" → "Still connecting…" →
  // "Slow connection…") and arm the FAIL_GRACE timer. Resets every time we
  // re-enter 'connecting' (initial mount, manual retry, auto-reconnect).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase(0)
    if (status !== 'connecting') return
    const t1 = setTimeout(() => setPhase(1), SLOW_CONNECT_MS)
    const t2 = setTimeout(() => setPhase(2), VERY_SLOW_MS)
    const tFail = setTimeout(() => {
      setStatus((s) => (s === 'connecting' ? 'failed' : s))
    }, FAIL_GRACE_MS)
    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(tFail)
    }
  }, [status, bumper])

  // handleConnected/handleReconnecting are deps of <RoomReconnectWatcher>'s
  // effect, so they need stable identities to avoid re-running it every
  // render. useCallback with no deps is fine — both bodies only call the
  // stable setStatus setter.
  const handleConnected = useCallback(() => {
    setStatus('connected')
  }, [])

  // SDK is mid-session-resume. Show a transient banner; the room itself
  // stays mounted, no participant churn server-side. Don't downgrade if
  // we've already escalated to 'failed' (the SDK can't transition back to
  // 'reconnecting' from there without a manual remount anyway).
  const handleReconnecting = useCallback(() => {
    setStatus((s) => (s === 'connected' ? 'reconnecting' : s))
  }, [])

  function handleDisconnected(reason?: DisconnectReason) {
    // Explicit, non-recoverable terminations — bail to the calendar instead
    // of cycling through reconnect attempts:
    //   CLIENT_INITIATED — local user clicked Leave
    //   USER_REJECTED    — admission denied
    //   ROOM_DELETED     — host ended the session for everyone (QA #10).
    //                      Without this branch the room would auto-recreate
    //                      on reconnect (LiveKit creates rooms on join) and
    //                      everyone would land in a fresh empty room.
    //   PARTICIPANT_REMOVED — host kicked this user.
    //   SERVER_SHUTDOWN  — LiveKit server going down; nothing to reconnect to.
    if (
      reason === DisconnectReason.CLIENT_INITIATED ||
      reason === DisconnectReason.USER_REJECTED ||
      reason === DisconnectReason.ROOM_DELETED ||
      reason === DisconnectReason.PARTICIPANT_REMOVED ||
      reason === DisconnectReason.SERVER_SHUTDOWN
    ) {
      onLeave()
      return
    }
    // Non-terminal disconnect from the SDK = the SDK has already exhausted
    // its own session-resume attempts (which are surfaced via
    // <RoomReconnectWatcher> as Reconnecting/Reconnected events without a
    // remount). Don't auto-bump the LiveKitRoom key here: bumping unmounts
    // the SDK's Room instance, emits CLIENT_REQUEST_LEAVE on the existing
    // server-side participant, and re-joins as a fresh participant with a
    // new pID and `Reconnect: false` — visible to everyone else as a
    // drop+rejoin, with full state loss (subscriptions, track perms,
    // role). Surface a failed banner with manual Retry instead; the user
    // decides when to pay that cost.
    //
    // Still-'connecting' on initial mount keeps counting against
    // FAIL_GRACE_MS; that's a separate path and unchanged.
    setStatus((s) => (s === 'connecting' ? s : 'failed'))
  }

  function manualRejoin() {
    setStatus('connecting')
    setBumper((b) => b + 1)
  }

  return (
    // Fullscreen takeover when JOINED so the live room behaves like Teams /
    // Zoom — covers the page chrome (sidebar, header, prep block) instead of
    // sitting inline below them. The fixed positioning lives on this OUTER
    // wrapper rather than on `<LiveKitRoom>` itself: LiveKit injects the
    // `lk-room-container` class with `position: relative` from
    // `@livekit/components-styles`, which wins the cascade over a Tailwind
    // `fixed` utility on the same element.
    <div className="fixed inset-0 z-40 overflow-hidden bg-black">
      {/* Connecting / reconnecting / failed banners — non-blocking, sit on
          top of the room. The room itself stays mounted underneath so any
          state (chat scrollback, sidebar, captions) is preserved across
          a transient drop. Banner styling escalates with status: pill at
          top during connecting/reconnecting, slightly heavier "actionable"
          card for `failed` (with Retry / Leave buttons). */}
      <ConnectionBanner
        status={status}
        phase={phase}
        serverUrl={url}
        onRejoin={manualRejoin}
        onLeave={onLeave}
      />
      <LiveKitRoom
        // Bumper is the only way to retry from React land — the LiveKit
        // SDK's `connect` prop is read once on mount, so a fresh attempt
        // requires a fresh component instance.
        key={bumper}
        token={token}
        serverUrl={url}
        connect
        data-lk-theme="default"
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        className="size-full"
      >
        {/* Surfaces the SDK's own transient reconnect attempts (session
            resume, Reconnect:true on the wire) as banner state, WITHOUT
            remounting the room. Without this, a brief network blip would
            silently route through the SDK's resume path but the UI would
            stay 'connected' the whole time, then look frozen if media
            tracks paused — confusing. With this, the banner says
            "Reconnecting…" for the duration of the resume and clears the
            moment the SDK recovers. */}
        <RoomReconnectWatcher
          onReconnecting={handleReconnecting}
          onReconnected={handleConnected}
        />
        <InnerRoom
          session={session}
          currentUser={currentUser}
          role={role}
          isHostish={isHostish}
          onLeave={onLeave}
          onJoinBreakout={onJoinBreakout}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          wbFullscreen={wbFullscreen}
          setWbFullscreen={setWbFullscreen}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  )
}

// Small status banner shown over the live room while we're not connected.
// Positioned as `pointer-events-none` for the connecting / reconnecting
// pills so it doesn't block clicks on the room behind; the failure card
// re-enables pointer events on its inner card so Retry / Leave are usable.
function ConnectionBanner({
  status,
  phase,
  serverUrl,
  onRejoin,
  onLeave,
}: {
  status: 'connecting' | 'connected' | 'reconnecting' | 'failed'
  phase: 0 | 1 | 2
  serverUrl: string
  onRejoin: () => void
  onLeave: () => void
}) {
  if (status === 'connected') return null

  // Localhost dev environment? Show a more actionable failure message that
  // tells the user the most likely cause — LiveKit Docker container isn't
  // running. Saves the round trip of "why isn't it working?" support.
  const isLocalDev = /^(ws|wss|http|https):\/\/(localhost|127\.0\.0\.1)/i.test(serverUrl)

  if (status === 'failed') {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-6 z-30 flex justify-center px-4">
        <div className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-2xl border border-amber-400/40 bg-zinc-900/95 px-4 py-3 text-sm text-white shadow-2xl shadow-black/50 backdrop-blur-md">
          <span className="mt-1.5 flex size-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Connection trouble</span>
            {isLocalDev ? (
              <>
                <span className="text-[11px] leading-snug text-white/70">
                  The local LiveKit server isn&apos;t responding on{' '}
                  <code className="rounded bg-white/10 px-1 font-mono text-[10px]">{serverUrl}</code>.
                  Start it with:
                </span>
                <code className="block whitespace-pre-wrap break-all rounded-md bg-black/50 px-2 py-1 font-mono text-[10px] text-emerald-300">
                  docker compose -f docker-compose.dev.yml up -d livekit
                </code>
                <span className="text-[11px] text-white/55">
                  (Docker Desktop must be running.)
                </span>
              </>
            ) : (
              <span className="text-[11px] text-white/70">
                We couldn&apos;t reach the live-class server. Retry or leave the room.
              </span>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={onRejoin}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onLeave}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/8"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 'connecting' or 'reconnecting' — soft pill, lower visual weight, no
  // user action required. Copy escalates with phase. Reconnecting always
  // means the SDK is mid-session-resume; if it gives up we transition to
  // 'failed' (handled above) and show the actionable banner instead.
  const reconnecting = status === 'reconnecting'
  const copy = reconnecting
    ? 'Reconnecting…'
    : phase === 0
      ? 'Connecting to the live class…'
      : phase === 1
        ? 'Still connecting — taking a bit longer than usual…'
        : 'Slow connection — still trying…'

  return (
    <div className="pointer-events-none absolute inset-x-0 top-6 z-30 flex justify-center">
      <div className="flex items-center gap-3 rounded-full bg-black/65 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-md">
        <Loader2 className="size-4 animate-spin" />
        {copy}
      </div>
    </div>
  )
}

// Bridges the LiveKit SDK's internal ConnectionState into LiveRoom's status
// machine. The SDK runs its own session-resume on transient drops
// (network blip, NAT rebinding, brief ICE loss) and re-attaches the
// existing participant on the server side — preserving subscriptions,
// track permissions, role grants. The previous design ignored those
// resume attempts and instead remounted <LiveKitRoom> after 2s, which
// emitted CLIENT_REQUEST_LEAVE + a fresh join (Reconnect:false) every
// cycle. To everyone else in the room that looked like the user dropping
// and re-joining every few seconds, with all server-side participant
// state lost on each round.
//
// This watcher must live INSIDE <LiveKitRoom> because useConnectionState
// requires the LiveKit context. It renders null — its only job is to
// observe state transitions and call the parent callbacks. The callbacks
// are wrapped in useCallback in the parent so this effect doesn't
// re-arm on every render.
function RoomReconnectWatcher({
  onReconnecting,
  onReconnected,
}: {
  onReconnecting: () => void
  onReconnected: () => void
}) {
  const connState = useConnectionState()
  const prevState = useRef<ConnectionState>(connState)

  useEffect(() => {
    const previous = prevState.current
    prevState.current = connState

    // LiveKit reports two distinct resume modes: full Reconnecting (PCs
    // are being rebuilt) and SignalReconnecting (only WSS dropped, media
    // still live). For banner purposes treat both as "reconnecting" —
    // the user just needs to know recovery is in progress.
    const isResuming = (s: ConnectionState) =>
      s === ConnectionState.Reconnecting || s === ConnectionState.SignalReconnecting

    if (isResuming(connState) && !isResuming(previous)) {
      onReconnecting()
    } else if (connState === ConnectionState.Connected && isResuming(previous)) {
      onReconnected()
    }
  }, [connState, onReconnecting, onReconnected])

  return null
}

// Tabs reachable from the bottom toolbar — sidebar header omits these to
// avoid duplicating them. Only the truly sidebar-only tabs (breakouts,
// hooks, coach) appear in the header icon strip.
const TOOLBAR_TAB_IDS = new Set(['chat', 'participants', 'notes', 'whiteboard', 'leaderboard'])

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ----------------------------------------------------------------------------
// InnerRoom — lives inside LiveKitRoom context so hooks work
// ----------------------------------------------------------------------------
function InnerRoom({
  session,
  currentUser,
  role,
  isHostish,
  onLeave,
  onJoinBreakout,
  sidebarOpen,
  setSidebarOpen,
  activeTab,
  setActiveTab,
  wbFullscreen,
  setWbFullscreen,
}: {
  session: SessionInfo
  currentUser: {
    id: string
    name: string
    email?: string
    avatarUrl?: string | null
    /// Vaidix role (FACULTY / RESIDENT / ADMIN / PROGRAM_DIRECTOR) — used
    /// to render the role badge next to your entry in the People panel.
    role?: string
    /// True when the local user is the host of this teaching session, so
    /// we can show an "Organizer" badge in addition to their role.
    isOrganizer?: boolean
  }
  role: 'HOST' | 'CO_HOST' | 'PARTICIPANT' | 'VIEWER'
  isHostish: boolean
  onLeave: () => void
  onJoinBreakout: (b: { id: string; name: string }) => void
  /// Sidebar + whiteboard fullscreen state owned by LiveRoom so LiveKitRoom
  /// remounts (key={bumper} on reconnect) do not reset the user's panel state.
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  activeTab: string
  setActiveTab: (tab: string) => void
  wbFullscreen: boolean
  setWbFullscreen: (v: boolean) => void
}) {

  const captionsActive = session.captionsProfile !== 'off'
  const [captionsEnabled, setCaptionsEnabled] = useState(() =>
    captionsActive ? readCaptionPrefs().enabled : false,
  )
  const [captionsLang, setCaptionsLang] = useState<CaptionLangCode>(() =>
    captionsActive ? readCaptionPrefs().lang : 'en',
  )
  const toggleCaptions = () => {
    const next = !captionsEnabled
    setCaptionsEnabled(next)
    saveCaptionPrefs(next, captionsLang)
  }
  const changeCaptionsLang = (l: CaptionLangCode) => {
    setCaptionsLang(l)
    saveCaptionPrefs(captionsEnabled, l)
  }

  // ─── Issue 23: Call duration timer ────────────────────────────────────────
  // eslint-disable-next-line react-hooks/purity -- intentionally captures the wall-clock join time for the live call-duration timer
  const joinedAtMsRef = useRef(Date.now())
  const [elapsedSec, setElapsedSec] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - joinedAtMsRef.current) / 1000))
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  // ─── Issue 24: 5-minute end warning ────────────────────────────────────────
  // Recomputed every second because elapsedSec ticks every second.
  const scheduledEndMs = new Date(session.scheduledEnd).getTime()
  // eslint-disable-next-line react-hooks/purity -- live end-of-call countdown intentionally reads the wall clock; recomputed each second by the duration-timer tick
  const remainingSec = Math.max(0, Math.floor((scheduledEndMs - Date.now()) / 1000))
  const showEndWarning = remainingSec > 0 && remainingSec <= 300

  // ─── Issue 22: Chat notification badge ────────────────────────────────────
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const { message: lastChatDc } = useDataChannel('chat')
  const lastChatDcRef = useRef<typeof lastChatDc>(undefined)
  useEffect(() => {
    if (!lastChatDc || lastChatDc === lastChatDcRef.current) return
    lastChatDcRef.current = lastChatDc
    // Chat is visible — no badge needed
    if (sidebarOpen && activeTab === 'chat') return
    setUnreadChatCount((n) => n + 1)
  }, [lastChatDc, sidebarOpen, activeTab])

  const tabs = [
    { id: 'participants', label: 'People', icon: Users },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'notes', label: 'Notes', icon: NotebookPen },
    { id: 'whiteboard', label: 'Whiteboard', icon: Pencil },
    { id: 'leaderboard', label: 'Board', icon: Trophy },
    { id: 'breakouts', label: 'Breakouts', icon: LayoutGrid },
    ...(isHostish ? [{ id: 'hooks', label: 'Hooks', icon: Zap }] : []),
    ...(!isHostish ? [{ id: 'coach', label: 'Coach', icon: Brain }] : []),
  ]

  const openTab = (tab: string) => {
    if (tab === 'chat') setUnreadChatCount(0)
    if (sidebarOpen && activeTab === tab) {
      setSidebarOpen(false)
    } else {
      setActiveTab(tab)
      setSidebarOpen(true)
    }
  }

  return (
    <div className="relative h-full bg-zinc-950 overflow-hidden">
      {/* Full-screen video layer */}
      <div className="absolute inset-0">
        <VideoGrid sessionId={session.id} isHostish={isHostish} localUserName={currentUser.name} />
      </div>

      {/* Screen-share annotation overlay — only renders when screen-share is
          live, and only accepts pointer input from host/co-host. Lives
          between the video grid and the floating reactions so reactions
          float OVER any annotations. */}
      <AnnotationOverlay sessionId={session.id} isHostish={isHostish} />

      {/* Floating emoji reactions — pointer-events:none, layered over video */}
      <FloatingReactionsLayer sessionId={session.id} />

      {/* Left "In this room" panel — Presenter (host) / Moderator (co-host) /
          Participant, with live mic+cam status. Demo-style, real LiveKit data. */}
      <RoomPeoplePanel
        sessionId={session.id}
        hostId={session.host.id}
        localUserId={currentUser.id}
        localUserName={currentUser.name}
      />

      {/* Top gradient vignette */}
      <div className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-black/75 via-black/30 to-transparent z-10 pointer-events-none" />

      {/* Issue 24: 5-minute end warning banner */}
      <AnimatePresence>
        {showEndWarning && (
          <motion.div
            initial={{ y: -32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -32, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="absolute top-14 inset-x-0 z-30 flex justify-center pointer-events-none"
          >
            <div className="flex items-center gap-2 bg-amber-400/90 backdrop-blur-md rounded-full px-5 py-2 text-sm font-semibold text-zinc-900 shadow-lg shadow-amber-500/30">
              <AlarmClock className="w-4 h-4 animate-pulse" />
              {remainingSec < 60
                ? `Less than 1 min remaining`
                : `${Math.ceil(remainingSec / 60)} min${Math.ceil(remainingSec / 60) === 1 ? '' : 's'} remaining`}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-start justify-between px-4 pt-3">
        <div className="flex items-center gap-2">
          {/* Live badge */}
          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold text-white tracking-widest">LIVE</span>
          </div>
          {/* Issue 23: Call duration timer */}
          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-1.5">
            <Timer className="w-3 h-3 text-white/50" />
            <span className="text-[10px] font-medium text-white/75 tabular-nums">{fmtElapsed(elapsedSec)}</span>
          </div>
          {/* Session title */}
          <div className="bg-black/30 backdrop-blur-md border border-white/7 rounded-lg px-3 py-1.5 max-w-65">
            <span className="text-sm font-medium text-white/90 truncate block">{session.title}</span>
          </div>
          {/* Participant strip — Teams-style avatars always visible */}
          <ParticipantStrip
            selfName={currentUser.name}
            selfEmail={currentUser.email}
            selfAvatarUrl={currentUser.avatarUrl}
            selfIsOrganizer={currentUser.isOrganizer}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* CC controls — in the top bar so they don't overlap video content */}
          {captionsActive && (
            <CaptionControls
              enabled={captionsEnabled}
              lang={captionsLang}
              onToggle={toggleCaptions}
              onLangChange={changeCaptionsLang}
            />
          )}
          {isHostish && (
            <HostControlsMenu sessionId={session.id} isHost={role === 'HOST'} />
          )}
        </div>
      </div>

      {/* Bottom gradient vignette */}
      <div className="absolute inset-x-0 bottom-0 h-36 bg-linear-to-t from-black/85 via-black/40 to-transparent z-10 pointer-events-none" />

      {/* Floating control bar */}
      <ControlBar
        sessionId={session.id}
        sessionTitle={session.title}
        selfDisplayName={currentUser.name}
        role={role}
        isHostish={isHostish}
        sidebarOpen={sidebarOpen}
        activeTab={activeTab}
        onOpenTab={openTab}
        onLeave={onLeave}
        unreadChatCount={unreadChatCount}
      />

      {/* Sidebar backdrop (mobile) */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 z-20 bg-black/40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sliding sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            key="sidebar"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="absolute right-0 top-0 bottom-0 w-[320px] z-30 flex flex-col bg-zinc-900/95 backdrop-blur-2xl border-l border-white/7 shadow-2xl shadow-black/60"
          >
            {/* Sidebar header — active tab name + icon-only tab switcher */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/7 shrink-0">
              <span className="flex-1 text-xs font-semibold text-white/70 uppercase tracking-wider truncate">
                {tabs.find((t) => t.id === activeTab)?.label ?? ''}
              </span>
              <div className="flex items-center gap-0.5">
                {/* Only sidebar-only tabs (Breakouts / Hooks / Coach). The
                    rest are reachable from the bottom toolbar, so showing
                    them here too is just visual noise. */}
                {tabs
                  .filter((t) => !TOOLBAR_TAB_IDS.has(t.id))
                  .map((tab) => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.id
                    return (
                      <button
                        key={tab.id}
                        title={tab.label}
                        onClick={() => openTab(tab.id)}
                        className={cn(
                          'w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-150',
                          isActive
                            ? 'bg-teal-500/20 text-teal-400'
                            : 'text-white/35 hover:text-white/75 hover:bg-white/6'
                        )}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                    )
                  })}
                <button
                  title="Close panel"
                  onClick={() => setSidebarOpen(false)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white/35 hover:text-white/80 hover:bg-white/6 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === 'participants' && (
                <ParticipantSidebar
                  sessionId={session.id}
                  canModerate={isHostish}
                  currentUserId={currentUser.id}
                  currentUserName={currentUser.name}
                  currentUserEmail={currentUser.email}
                  currentUserAvatarUrl={currentUser.avatarUrl}
                  currentUserRole={currentUser.role}
                  currentUserIsOrganizer={currentUser.isOrganizer}
                />
              )}
              {activeTab === 'chat' && (
                <ChatPanel
                  sessionId={session.id}
                  currentUser={currentUser}
                  onNewMessages={(n) => {
                    // Only badge when the panel is open but buried (shouldn't
                    // happen — tab is 'chat') or, more importantly, when the
                    // poll fires after the user switches away from chat mid-session.
                    if (!sidebarOpen || activeTab !== 'chat') setUnreadChatCount((c) => c + n)
                  }}
                />
              )}
              {activeTab === 'notes' && (
                <SharedNotesPanel sessionId={session.id} isHostish={isHostish} />
              )}
              {activeTab === 'whiteboard' && (
                <WhiteboardPanel
                  sessionId={session.id}
                  isHostish={isHostish}
                  fullscreen={wbFullscreen}
                  onFullscreenChange={setWbFullscreen}
                />
              )}
              {activeTab === 'leaderboard' && (
                <LeaderboardPanel sessionId={session.id} />
              )}
              {activeTab === 'breakouts' && (
                <BreakoutsPanel
                  sessionId={session.id}
                  isFaculty={isHostish}
                  currentUserId={currentUser.id}
                  onJoin={onJoinBreakout}
                />
              )}
              {isHostish && activeTab === 'hooks' && (
                <HooksComposer sessionId={session.id} />
              )}
              {!isHostish && activeTab === 'coach' && (
                <CoachPanel learnerId={currentUser.id} />
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Pre-flight banner — visible when the host has opened the room
          outside the scheduled window. Status stays SCHEDULED server-side
          until the window opens (see lib/sessions/scheduled-window.ts), so
          checking status===SCHEDULED is the cleanest "is this pre-flight?"
          signal available to the room chrome. */}
      {session.status === 'SCHEDULED' && (
        <PreflightBanner
          sessionId={session.id}
          scheduledStart={session.scheduledStart}
          scheduledEnd={session.scheduledEnd}
          isHost={role === 'HOST'}
        />
      )}

      {/* Engagement overlays */}
      <HookOverlay sessionId={session.id} />
      <PresenterAlertsHud sessionId={session.id} isHost={role === 'HOST'} />
      {captionsActive && (
        <LiveCaptionsOverlay
          sessionId={session.id}
          enabled={captionsEnabled}
          chosenLang={captionsLang}
        />
      )}
      {/* Live captions are produced by the out-of-process LiveKit Agent
          (vaidix-agent/main.py) which joins every LIVE room as a hidden
          participant. The agent runs Deepgram STT per subscribed audio
          track and POSTs finalized utterances to /live-captions/ingest —
          fan-out + persistence happen there, the overlay above just reads
          the existing SSE stream. No browser-side producer required. */}
      <HandRaiseNotifications />
      {/* Headless join/leave chime — plays a soft 2-note tone when remote
          participants connect or disconnect. Default on; the toolbar
          NotificationSoundsToggle lets the user mute. */}
      <NotificationSounds />
    </div>
  )
}

// ----------------------------------------------------------------------------
// Floating control bar — uses LiveKit hooks
// ----------------------------------------------------------------------------
function ControlBar({
  sessionId,
  sessionTitle,
  selfDisplayName,
  role,
  isHostish,
  sidebarOpen,
  activeTab,
  onOpenTab,
  onLeave,
  unreadChatCount = 0,
}: {
  sessionId: string
  /// Friendly session title for the PiP mini-window. Threaded down from
  /// the page so users see "Chat with Avinash" not "session-{cuid}".
  sessionTitle?: string
  /// Friendly self-name for the PiP mini-window. Comes from the
  /// DB-authoritative profile lookup at page render.
  selfDisplayName?: string
  role: 'HOST' | 'CO_HOST' | 'PARTICIPANT' | 'VIEWER'
  isHostish: boolean
  sidebarOpen: boolean
  activeTab: string
  onOpenTab: (tab: string) => void
  onLeave: () => void
  unreadChatCount?: number
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const room = useRoomContext()
  const client = useVideoRoomClient()
  const [isSharing, setIsSharing] = useState(false)
  const [sharingLoading, setSharingLoading] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [bgPickerOpen, setBgPickerOpen] = useState(false)
  // Surfaces getUserMedia errors as a toast. Hard-blocked = device permanently
  // unavailable (not found / permission denied) → button stays visually blocked.
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [micBlocked, setMicBlocked] = useState(false)
  const [camBlocked, setCamBlocked] = useState(false)
  // Track auto-clear timers in refs so we can clear on unmount or before
  // arming a fresh timer — otherwise rapid re-blocks leak stacked timers
  // and a "set state on unmounted component" warning fires if the user
  // leaves the room within 8s of being blocked.
  const micUnblockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const camUnblockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!deviceError) return
    const t = setTimeout(() => setDeviceError(null), 6000)
    return () => clearTimeout(t)
  }, [deviceError])
  useEffect(() => () => {
    if (micUnblockTimerRef.current) clearTimeout(micUnblockTimerRef.current)
    if (camUnblockTimerRef.current) clearTimeout(camUnblockTimerRef.current)
  }, [])

  function describeMediaError(err: unknown, kind: 'microphone' | 'camera'): string {
    const e = err as { name?: string; message?: string }
    const name = e?.name ?? ''
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return `No ${kind} found on this device.`
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return `${kind === 'microphone' ? 'Microphone' : 'Camera'} access blocked. Check browser permissions.`
    }
    if (name === 'NotReadableError') {
      return `${kind === 'microphone' ? 'Microphone' : 'Camera'} is already in use by another app.`
    }
    return e?.message ?? `Could not enable ${kind}.`
  }

  const toggleMic = useCallback(async () => {
    if (micBlocked) return
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch (err) {
      const msg = describeMediaError(err, 'microphone')
      setDeviceError(msg)
      const e = err as { name?: string }
      if (e?.name === 'NotFoundError' || e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
        setMicBlocked(true)
        // Auto-clear after 8s — user may reset browser permissions or plug in a
        // device and retry, so we don't leave the button permanently disabled.
        if (micUnblockTimerRef.current) clearTimeout(micUnblockTimerRef.current)
        micUnblockTimerRef.current = setTimeout(() => setMicBlocked(false), 8_000)
      }
    }
  }, [isMicrophoneEnabled, localParticipant, micBlocked])

  const toggleCamera = useCallback(async () => {
    if (camBlocked) return
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled)
    } catch (err) {
      const msg = describeMediaError(err, 'camera')
      setDeviceError(msg)
      const e = err as { name?: string }
      if (e?.name === 'NotFoundError' || e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
        setCamBlocked(true)
        if (camUnblockTimerRef.current) clearTimeout(camUnblockTimerRef.current)
        camUnblockTimerRef.current = setTimeout(() => setCamBlocked(false), 8_000)
      }
    }
  }, [isCameraEnabled, localParticipant, camBlocked])

  // Sync hand-raise state with LiveKit participant metadata. metadata is an
  // externally-mutated property on the LiveKit Participant — this effect is
  // the subscription bridge between LiveKit and React state. Computed into
  // a single value so the setState fires exactly once per metadata change.
  useEffect(() => {
    let raised = false
    if (localParticipant.metadata) {
      try {
        const parsed = JSON.parse(localParticipant.metadata)
        raised = parsed?.handRaised === true
      } catch { /* malformed metadata — leave raised=false */ }
    }
    setHandRaised(raised)
  }, [localParticipant.metadata])

  const toggleHand = useCallback(async () => {
    const next = !handRaised
    // LiveKit refuses signal sends until the room WebSocket is fully connected
    // ("cannot send signal request before connected, type: updateMetadata").
    // Skip silently if the user clicks during reconnect/initial-connect.
    if (room.state !== ConnectionState.Connected) return
    try {
      await localParticipant.setMetadata(
        next ? JSON.stringify({ handRaised: true, at: Date.now() }) : '{}'
      )
    } catch (err) {
      console.warn('[hand-raise] setMetadata failed:', err)
      return
    }
    setHandRaised(next)
    // Emit a HAND_RAISE engagement signal only on raise (not on lower) so the
    // leaderboard's `recentHandRaises` aggregate (engagement-service.ts) stays
    // aligned with the metadata broadcast.
    if (next) {
      void client.emitEngagementSignal(sessionId, 'HAND_RAISE').catch(() => {/* best-effort */})
    }
  }, [handRaised, localParticipant, sessionId, room, client])

  const toggleScreen = useCallback(async () => {
    setSharingLoading(true)
    try {
      const next = !isSharing
      await localParticipant.setScreenShareEnabled(next)
      // LiveKit resolves successfully even when the user cancels the OS
      // source picker (no track gets published). Re-check the publication
      // before flipping isSharing so the button doesn't display "Stop
      // share" with no actual track behind it.
      const pub = localParticipant.getTrackPublication(Track.Source.ScreenShare)
      setIsSharing(next ? !!pub && !pub.isMuted : false)
    } catch (err) {
      // User-cancel via the OS picker is the common case → silent.
      // Real errors (no permission, no display capture support) show as toast.
      const e = err as { name?: string }
      if (e?.name && e.name !== 'NotAllowedError') {
        setDeviceError(describeMediaError(err, 'camera'))
      }
    } finally {
      setSharingLoading(false)
    }
  }, [isSharing, localParticipant])

  return (
    <div className="absolute bottom-5 inset-x-0 z-20 flex flex-wrap items-end justify-center gap-3 px-4">
      {/* Device-error toast (auto-dismiss after 4s) */}
      <AnimatePresence>
        {deviceError && (
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 max-w-md rounded-xl bg-red-500/15 border border-red-500/40 backdrop-blur-md px-4 py-2.5 text-sm text-red-100 shadow-lg shadow-black/40"
            role="alert"
          >
            {deviceError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main controls pill */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, type: 'spring', damping: 22, stiffness: 220 }}
        className="flex max-w-full flex-wrap items-center justify-center gap-2 bg-zinc-950/80 backdrop-blur-2xl border border-white/10 rounded-[28px] px-4 py-3 shadow-2xl shadow-black/70 lg:max-w-none lg:flex-nowrap"
      >
        {/* Mic */}
        {role !== 'VIEWER' && (
          <CtrlBtn
            onClick={toggleMic}
            icon={isMicrophoneEnabled
              ? <Mic className="w-5 h-5" />
              : <MicOff className="w-5 h-5" />}
            label={micBlocked ? 'No mic' : isMicrophoneEnabled ? 'Mute' : 'Unmute'}
            variant={micBlocked ? 'danger' : isMicrophoneEnabled ? 'active' : 'danger'}
            color="green"
            pulse={isMicrophoneEnabled}
            blocked={micBlocked}
          />
        )}

        {/* Camera + background picker (half-pill split button) */}
        {role !== 'VIEWER' && (
          <div className="relative flex flex-col items-center gap-1.5 group">
            <motion.div
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.93 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              className={cn(
                'flex items-stretch rounded-full overflow-hidden transition-all duration-200',
                isCameraEnabled
                  ? 'bg-sky-500/20 hover:bg-sky-500/32 shadow-[0_0_0_1px_rgba(14,165,233,0.35),0_0_16px_rgba(14,165,233,0.3)]'
                  : 'bg-red-500/30 hover:bg-red-500/40 shadow-[0_0_0_1px_rgba(239,68,68,0.45),0_0_16px_rgba(239,68,68,0.3)]'
              )}
            >
              {/* Main camera toggle */}
              <button
                onClick={toggleCamera}
                title={camBlocked ? 'No camera found — check browser permissions' : isCameraEnabled ? 'Stop video' : 'Start video'}
                className={cn(
                  'w-10 h-12 flex items-center justify-center transition-colors duration-200 pl-2',
                  camBlocked ? 'text-red-400 opacity-60 cursor-not-allowed' : isCameraEnabled ? 'text-sky-200' : 'text-red-300'
                )}
              >
                {isCameraEnabled
                  ? <Video className="w-5 h-5" />
                  : <VideoOff className="w-5 h-5" />}
              </button>
              {/* Bg picker caret */}
              <button
                onClick={() => setBgPickerOpen((v) => !v)}
                title="Change background"
                className={cn(
                  'w-6 h-12 flex items-center justify-center border-l transition-colors duration-200 pr-1',
                  isCameraEnabled ? 'border-sky-500/20' : 'border-red-500/20',
                  bgPickerOpen
                    ? 'text-teal-400'
                    : isCameraEnabled ? 'text-sky-300/40 hover:text-sky-300' : 'text-red-400/60 hover:text-red-400'
                )}
              >
                <ChevronDown className={cn('w-3 h-3 transition-transform duration-150', bgPickerOpen && 'rotate-180')} />
              </button>
            </motion.div>
            <span className="text-[11px] text-white/40 group-hover:text-white/70 transition-colors leading-none">
              Video
            </span>
            {/* Background picker panel */}
            <AnimatePresence>
              {bgPickerOpen && (
                <BgPicker onClose={() => setBgPickerOpen(false)} />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Screen share (host/co-host only) */}
        {isHostish && (
          <>
            <Divider />
            <CtrlBtn
              onClick={toggleScreen}
              icon={sharingLoading
                ? <Loader2 className="w-5 h-5 animate-spin" />
                : isSharing
                  ? <MonitorOff className="w-5 h-5" />
                  : <Monitor className="w-5 h-5" />}
              label={sharingLoading ? 'Starting…' : isSharing ? 'Stop share' : 'Share screen'}
              variant={isSharing ? 'active' : 'default'}
              color="violet"
              blocked={sharingLoading}
            />
          </>
        )}

        {/* Hand raise */}
        {role !== 'VIEWER' && (
          <CtrlBtn
            onClick={toggleHand}
            icon={<Hand className="w-5 h-5" />}
            label={handRaised ? 'Lower hand' : 'Raise hand'}
            variant={handRaised ? 'active' : 'default'}
            color="amber"
          />
        )}

        {/* Reactions — anyone in the room can react */}
        <ReactionsBar sessionId={sessionId} />

        <Divider />

        {/* Chat — badge shows unread message count when panel is closed */}
        <CtrlBtn
          onClick={() => onOpenTab('chat')}
          icon={<MessageSquare className="w-5 h-5" />}
          label="Chat"
          variant={sidebarOpen && activeTab === 'chat' ? 'active' : 'default'}
          badge={unreadChatCount > 0 && !(sidebarOpen && activeTab === 'chat') ? unreadChatCount : 0}
        />

        {/* People */}
        <CtrlBtn
          onClick={() => onOpenTab('participants')}
          icon={<Users className="w-5 h-5" />}
          label="People"
          variant={sidebarOpen && activeTab === 'participants' ? 'active' : 'default'}
        />

        {/* Notes */}
        <CtrlBtn
          onClick={() => onOpenTab('notes')}
          icon={<NotebookPen className="w-5 h-5" />}
          label="Notes"
          variant={sidebarOpen && activeTab === 'notes' ? 'active' : 'default'}
        />

        {/* Whiteboard */}
        <CtrlBtn
          onClick={() => onOpenTab('whiteboard')}
          icon={<Pencil className="w-5 h-5" />}
          label="Board"
          variant={sidebarOpen && activeTab === 'whiteboard' ? 'active' : 'default'}
        />

        {/* Leaderboard — relabelled "Stats" so it doesn't collide with the
            new Whiteboard ("Board") button. The sidebar tab itself still says
            "Board" inside the engagement panel; this label is the control-bar
            shortcut. */}
        <CtrlBtn
          onClick={() => onOpenTab('leaderboard')}
          icon={<Trophy className="w-5 h-5" />}
          label="Stats"
          variant={sidebarOpen && activeTab === 'leaderboard' ? 'active' : 'default'}
        />

        {/* PiP + pop-out + mute-notifications accessories — desktop-only.
            `hidden lg:contents` drops them from the wrapped mobile control bar
            (they're desktop conveniences) while keeping the desktop row
            byte-identical. */}
        <div className="hidden lg:contents">
          <Divider />

          <PictureInPictureButton
            sessionId={sessionId}
            sessionTitle={sessionTitle}
            selfDisplayName={selfDisplayName}
          />
          <PopOutWindowButton sessionId={sessionId} />
          <NotificationSoundsToggle />
        </div>

        {/* Headless always-on noise suppression — no UI rendered */}
        <NoiseSuppressionToggle sessionId={sessionId} />
      </motion.div>

      {/* Leave — separate pill, visually distinct */}
      <motion.button
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.93 }}
        transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        onClick={onLeave}
        className="flex items-center gap-2 bg-red-500 hover:bg-red-400 text-white rounded-full h-12 px-6 font-semibold text-sm shadow-xl shadow-red-500/40 hover:shadow-red-500/60 transition-shadow duration-200 shrink-0"
      >
        <PhoneOff className="w-5 h-5" />
        Leave
      </motion.button>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Individual control button
// ----------------------------------------------------------------------------
type CtrlVariant = 'default' | 'danger' | 'active'
type CtrlColor = 'default' | 'green' | 'blue' | 'violet' | 'amber'

function CtrlBtn({
  onClick,
  icon,
  label,
  variant = 'default',
  color = 'default',
  pulse = false,
  blocked = false,
  badge = 0,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  variant?: CtrlVariant
  color?: CtrlColor
  pulse?: boolean
  blocked?: boolean
  badge?: number
}) {
  const circleCls = cn(
    'relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200',
    // Danger — red, clearly visible with outer glow
    variant === 'danger'  && 'bg-red-500/30 text-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.45),0_0_18px_rgba(239,68,68,0.35)] hover:bg-red-500/40',
    // Active states — strong color + outer glow so it's visible at rest
    variant === 'active'  && color === 'default' && 'bg-teal-500/30 text-teal-200 shadow-[0_0_0_1px_rgba(20,184,166,0.5),0_0_18px_rgba(20,184,166,0.35)] hover:bg-teal-500/40',
    variant === 'active'  && color === 'green'   && 'bg-emerald-500/30 text-emerald-200 shadow-[0_0_0_1px_rgba(16,185,129,0.5),0_0_18px_rgba(16,185,129,0.4)] hover:bg-emerald-500/40',
    variant === 'active'  && color === 'blue'    && 'bg-sky-500/30 text-sky-200 shadow-[0_0_0_1px_rgba(14,165,233,0.5),0_0_18px_rgba(14,165,233,0.4)] hover:bg-sky-500/40',
    variant === 'active'  && color === 'violet'  && 'bg-violet-500/30 text-violet-200 shadow-[0_0_0_1px_rgba(139,92,246,0.5),0_0_18px_rgba(139,92,246,0.4)] hover:bg-violet-500/40',
    variant === 'active'  && color === 'amber'   && 'bg-amber-500/30 text-amber-200 shadow-[0_0_0_1px_rgba(245,158,11,0.5),0_0_18px_rgba(245,158,11,0.4)] hover:bg-amber-500/40',
    // Idle — visible color identity even at rest (20%+ opacity)
    variant === 'default' && color === 'default' && 'bg-white/12 text-white/75 shadow-[0_0_0_1px_rgba(255,255,255,0.1)] hover:bg-white/22 hover:text-white',
    variant === 'default' && color === 'green'   && 'bg-emerald-500/20 text-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.25)] hover:bg-emerald-500/32 hover:text-emerald-200',
    variant === 'default' && color === 'blue'    && 'bg-sky-500/20 text-sky-300 shadow-[0_0_0_1px_rgba(14,165,233,0.25)] hover:bg-sky-500/32 hover:text-sky-200',
    variant === 'default' && color === 'violet'  && 'bg-violet-500/20 text-violet-300 shadow-[0_0_0_1px_rgba(139,92,246,0.25)] hover:bg-violet-500/32 hover:text-violet-200',
    variant === 'default' && color === 'amber'   && 'bg-amber-500/20 text-amber-300 shadow-[0_0_0_1px_rgba(245,158,11,0.25)] hover:bg-amber-500/32 hover:text-amber-200',
  )

  return (
    <motion.button
      onClick={blocked ? undefined : onClick}
      title={label}
      aria-disabled={blocked}
      whileHover={blocked ? undefined : { scale: 1.08 }}
      whileTap={blocked ? undefined : { scale: 0.91 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      className={cn('flex flex-col items-center gap-1.5 group outline-none', blocked && 'cursor-not-allowed opacity-50')}
    >
      <div className={circleCls}>
        {icon}
        {pulse && variant === 'active' && (
          <motion.span
            animate={{ opacity: [0.2, 0.55, 0.2], scale: [1, 1.12, 1] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-full border border-emerald-400/40 pointer-events-none"
          />
        )}
        {/* Issue 22: unread badge */}
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4.5 h-4.5 rounded-full bg-teal-400 text-zinc-900 text-[10px] font-bold flex items-center justify-center px-1 shadow-md shadow-black/40 pointer-events-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span className="text-[11px] text-white/40 group-hover:text-white/70 transition-colors leading-none">
        {label}
      </span>
    </motion.button>
  )
}

function Divider() {
  return <div className="w-px h-6 bg-white/8 mx-1 self-center" />
}

// ----------------------------------------------------------------------------
// Host controls menu (dark-themed for the dark top bar)
// ----------------------------------------------------------------------------
function HostControlsMenu({ sessionId, isHost }: { sessionId: string; isHost: boolean }) {
  const room = useRoomContext()
  const client = useVideoRoomClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function muteAll() {
    if (!confirm('Mute all participants except you?')) return
    setBusy(true)
    try {
      const me = room.localParticipant.identity
      const others = Array.from(room.remoteParticipants.values()).filter((p) => p.identity !== me)
      await Promise.all(
        others.map((p) => client.muteParticipant(sessionId, p.identity, true)),
      )
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  async function copyShareLink() {
    setBusy(true)
    try {
      const link = await client.createShareLink(sessionId, 24)
      await navigator.clipboard.writeText(link.url)
      alert(`Share link copied. Expires: ${new Date(link.expiresAt).toLocaleString()}`)
    } catch {
      /* user-cancellable; nothing to show */
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  async function endSession() {
    if (!confirm('End this session for everyone?')) return
    setBusy(true)
    try {
      await client.endSession(sessionId)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md border border-white/10 hover:bg-white/10 text-white/80 hover:text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150"
      >
        <Settings className="w-3.5 h-3.5" />
        Host controls
        <ChevronDown className={cn('w-3 h-3 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 mt-2 w-52 rounded-xl bg-zinc-900/95 backdrop-blur-xl border border-white/8 shadow-2xl shadow-black/60 z-50 overflow-hidden p-1"
          >
            <HostMenuItem onClick={muteAll} disabled={busy} icon={<MicOff className="w-3.5 h-3.5" />}>
              Mute all except me
            </HostMenuItem>
            <HostMenuItem onClick={copyShareLink} disabled={busy} icon={<Link2 className="w-3.5 h-3.5" />}>
              Copy share link
            </HostMenuItem>
            {isHost && (
              <>
                <div className="h-px bg-white/[0.07] my-1" />
                <HostMenuItem onClick={endSession} disabled={busy} destructive icon={<PhoneOff className="w-3.5 h-3.5" />}>
                  End session for all
                </HostMenuItem>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* click-outside */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  )
}

function HostMenuItem({
  onClick,
  children,
  destructive,
  disabled,
  icon,
}: {
  onClick: () => void
  children: React.ReactNode
  destructive?: boolean
  disabled?: boolean
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left transition-all duration-100 disabled:opacity-40',
        destructive
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-white/70 hover:bg-white/6 hover:text-white'
      )}
    >
      {icon}
      {children}
    </button>
  )
}

// ----------------------------------------------------------------------------
// Video grid — full height. When a participant is spotlighted (HOST set) the
// grid collapses to a single focused tile for everyone in the room. Screen-
// share tracks always take precedence over the spotlight (a host sharing
// their slides is an implicit spotlight on the slides). Other camera tiles
// remain available in the participant sidebar but are removed from the grid.
// ----------------------------------------------------------------------------
function VideoGrid({ sessionId, isHostish, localUserName }: { sessionId: string; isHostish: boolean; localUserName?: string | null }) {
  const rawTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  )
  // Drop tracks belonging to the captions agent — withPlaceholder:true
  // creates a placeholder tile for every participant even if they have no
  // camera, so without this filter the agent shows up as a giant empty
  // tile in the host's video grid.
  const allTracks = rawTracks.filter((t) => !isAgentParticipant(t.participant))
  const { targetIdentity, setSpotlight } = useSpotlight(sessionId)

  // Screen share is the dominant focus when present — slides are always king.
  // Promote the most-recent share to the focus layout and push every camera
  // tile into a thumbnail carousel beside it. Without this, the share rendered
  // as just one more equal tile in GridLayout (QA #6: "small at top-right").
  const screenShareTracks = allTracks.filter((t) => t.source === Track.Source.ScreenShare)
  const cameraTracks      = allTracks.filter((t) => t.source !== Track.Source.ScreenShare)
  const hasScreenShare    = screenShareTracks.length > 0

  if (hasScreenShare) {
    // Most-recently-published share wins — usually only one at a time, but
    // be defensive in case two participants share simultaneously.
    const focused = screenShareTracks[screenShareTracks.length - 1]
    return (
      <FocusLayoutContainer style={{ height: '100%', background: 'transparent' }}>
        <CarouselLayout tracks={cameraTracks}>
          {/* Carousel thumbs reuse SpotlightTile so they get the avatar
              fallback too — but suppress the spotlight star in this layout
              (a learner can't be "spotlit" while a screen share is focused). */}
          <SpotlightTile
            isHostish={isHostish}
            spotlightedIdentity={targetIdentity}
            onToggleSpotlight={setSpotlight}
            avatarSize="thumb"
            hideSpotlight
            localUserName={localUserName}
          />
        </CarouselLayout>
        <FocusLayout trackRef={focused} />
      </FocusLayoutContainer>
    )
  }

  const tracks =
    targetIdentity
      ? allTracks.filter((t) => t.participant.identity === targetIdentity)
      : allTracks

  return (
    <GridLayout tracks={tracks} style={{ height: '100%', background: 'transparent' }}>
      <SpotlightTile
        isHostish={isHostish}
        spotlightedIdentity={targetIdentity}
        onToggleSpotlight={setSpotlight}
        localUserName={localUserName}
      />
    </GridLayout>
  )
}

