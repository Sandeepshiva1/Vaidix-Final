'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  BellOff,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Globe,
  Hand,
  HelpCircle,
  Languages,
  Layers,
  Lightbulb,
  Loader2,
  Medal,
  Mic,
  MicOff,
  Minus,
  Monitor,
  Pencil,
  Plus,
  SmilePlus,
  Sparkles,
  Trophy,
  Users2,
  Video,
  VideoOff,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  FocusLayout,
  ParticipantTile,
  TrackRefContext,
  useTracks,
  useLocalParticipant,
  useParticipants,
  useDataChannel,
} from '@livekit/components-react'
import { Track, DisconnectReason, type Participant } from 'livekit-client'
import '@livekit/components-styles'
import { isAgentParticipant } from '@/lib/livekit-helpers'
import { cn } from '@/lib/utils'
import { WhiteboardPanel } from '@/components/classroom/whiteboard-panel'
import { BreakoutRoomView } from '@/components/classroom/breakout-room-view'
import { HookOverlay } from '@/components/engagement/hook-overlay'
import type { SessionView } from '@/lib/medlearn/session-view'
import {
  useLiveToken, useEngagement, useLiveHooks, useLeaderboard, useBreakouts,
  useCaptions, usePresenterAlerts, suggestHooks, muteAllParticipants, endLiveSession,
  type TokenState, type ApiHookKind, type SuggestedPoll,
} from './live-data'

const reactionEnc = new TextEncoder()
const reactionDec = new TextDecoder()

type ViewMode = 'gallery' | 'presentation'
type RightTab = 'people' | 'hooks' | 'transcript' | 'ai' | 'breakout'
type LbCategory = 'score' | 'consistent' | 'accurate' | 'engaged' | 'time'
type TxLang = 'all' | 'en' | 'te' | 'hi' | 'ta' | 'kn' | 'ml' | 'mixed'

const REACTIONS_LIST = ['👏', '🙋', '👋', '🤔', '💡', '❓', '👍', '❤️']

const HOOK_KIND_LABEL: Record<ApiHookKind, string> = {
  TRUE_FALSE: 'T/F', POLL: 'Poll', ONE_WORD: 'One word', REPEAT_CONCEPT: 'Concept', DILEMMA: 'Dilemma',
}

const LANG_FILTERS: { key: TxLang; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'en', label: 'EN' }, { key: 'hi', label: 'HI' }, { key: 'te', label: 'TE' },
  { key: 'ta', label: 'TA' }, { key: 'kn', label: 'KN' }, { key: 'ml', label: 'ML' },
]
function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

function fmtTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}
function pad(n: number) { return n.toString().padStart(2, '0') }

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Outer shell: mint a LiveKit token, and when JOINED wrap the whole conference
// body in <LiveKitRoom> so the center stage + media dock can drive real video.
// When not joined (loading / waiting / denied / error / unreachable LiveKit) the
// same body renders with connected=false and shows honest non-mock states.
export function LiveConference({ session, isHost }: { session: SessionView; isHost: boolean }) {
  const router = useRouter()
  const tok = useLiveToken(session.id)
  const [lkError, setLkError] = useState(false)

  // Terminal disconnects mean the call is over for this user — leave the room
  // instead of stranding them on the offline console (the bug where members
  // stayed "in" the call after the host ended it and had to click Leave).
  //   ROOM_DELETED       — host ended the session (server deletes the room)
  //   PARTICIPANT_REMOVED— host removed this user
  //   SERVER_SHUTDOWN    — LiveKit going down
  // Non-hosts go to the calendar; the host is already headed to /post.
  const handleDisconnected = useCallback((reason?: DisconnectReason) => {
    if (
      reason === DisconnectReason.ROOM_DELETED ||
      reason === DisconnectReason.PARTICIPANT_REMOVED ||
      reason === DisconnectReason.SERVER_SHUTDOWN
    ) {
      router.push(isHost ? `/session/${session.id}/post` : '/calendar')
      return
    }
    setLkError(true)
  }, [router, isHost, session.id])
  // When set, the user has joined a breakout: we leave the main room entirely
  // and connect to the child room (BreakoutRoomView mints its own token + runs
  // its own <LiveKitRoom>). Lives above the main <LiveKitRoom> so the two never
  // mount at once. Mirrors the participant room's breakout switch.
  const [activeBreakout, setActiveBreakout] = useState<{ id: string; name: string } | null>(null)
  const canConnect = tok.status === 'joined' && !!tok.token && !!tok.url && !lkError

  if (activeBreakout) {
    const isFaculty = isHost || tok.role === 'HOST' || tok.role === 'CO_HOST'
    return (
      <div className="fixed inset-0 z-50 bg-black">
        <BreakoutRoomView
          sessionId={session.id}
          breakoutId={activeBreakout.id}
          breakoutName={activeBreakout.name}
          isFaculty={isFaculty}
          onLeave={() => setActiveBreakout(null)}
        />
      </div>
    )
  }

  const body = (
    <LiveConferenceBody
      session={session}
      isHost={isHost}
      connected={canConnect}
      role={tok.role}
      tokenStatus={lkError ? 'error' : tok.status}
      onJoinBreakout={setActiveBreakout}
    />
  )
  if (canConnect) {
    return (
      <LiveKitRoom
        token={tok.token}
        serverUrl={tok.url}
        connect
        // adaptiveStream: only subscribe/decode tiles that are actually on
        // screen, at the resolution they're displayed (off-screen carousel
        // tiles pause) — the Meet/Zoom approach to keeping video CPU bounded.
        // dynacast: stop publishing layers no one is viewing. Together these
        // are the biggest lever against the "Chrome maxes the CPU" report.
        options={{ adaptiveStream: true, dynacast: true }}
        data-lk-theme="default"
        className="contents"
        onError={() => setLkError(true)}
        onDisconnected={handleDisconnected}
      >
        {body}
        <RoomAudioRenderer />
      </LiveKitRoom>
    )
  }
  return body
}

function LiveConferenceBody({ session, isHost, connected, role, tokenStatus, onJoinBreakout }: {
  session: SessionView
  isHost: boolean
  connected: boolean
  role?: string
  tokenStatus: TokenState['status']
  onJoinBreakout: (b: { id: string; name: string }) => void
}) {
  const [viewMode, setViewMode]           = useState<ViewMode>('gallery')
  const [sharingScreen, setSharingScreen] = useState(false)
  const [leftCollapsed, setLeftCollapsed]   = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [rightTab, setRightTab]             = useState<RightTab>(isHost ? 'hooks' : 'transcript')
  const [showWhiteboard, setShowWhiteboard] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [mediaError, setMediaError]         = useState<string | null>(null)
  const [showSubtitles, setShowSubtitles]   = useState(false)
  const [newHookOpen, setNewHookOpen]       = useState(false)
  const [newHookKind, setNewHookKind]       = useState<'tf' | 'oneword' | 'concept' | 'dilemma'>('tf')
  const [newHookLabel, setNewHookLabel]     = useState('')
  const [lbCategory, setLbCategory]         = useState<LbCategory>('score')
  const [hookNotif, setHookNotif]           = useState<string | null>(null)
  const [alertText, setAlertText]         = useState<string | null>(null)
  const [alertsDisabled, setAlertsDisabled] = useState(false)
  const [elapsed, setElapsed]             = useState(0)
  const liveAgg = useEngagement(session.id, isHost)
  const engagement = liveAgg?.engagementScore ?? null
  // Captions + presenter alerts arrive over their own SSE streams from the
  // server — independent of whether THIS client's LiveKit video socket is up.
  const { segments: captionSegs, connected: captionsLive } = useCaptions(session.id, true)
  const presenterAlerts = usePresenterAlerts(session.id, isHost)
  const leaderboard = useLeaderboard(session.id, showLeaderboard)
  const subtitleCaption = showSubtitles ? (captionSegs[captionSegs.length - 1]?.text ?? null) : null
  const [mutedAll, setMutedAll]           = useState(false)
  const [sjtActive, setSjtActive]         = useState(false)
  const [sjtBusy, setSjtBusy]             = useState(false)
  const [sjtOffline, setSjtOffline]       = useState(false)
  const [sjtPolls, setSjtPolls]           = useState<SuggestedPoll[]>([])
  const [sjtIdx, setSjtIdx]               = useState(0)
  const [sjtPick, setSjtPick]             = useState<string | null>(null)
  const [sjtCorrect, setSjtCorrect]       = useState(0)
  const [sjtDone, setSjtDone]             = useState(false)
  // Real engagement hooks (list / create / fire) from /api/.../hooks.
  const { hooks: apiHooks, create: createHook, fire: fireHook } = useLiveHooks(session.id)
  const liveHook = apiHooks?.find((h) => h.firedAt && !h.closedAt) ?? null
  const [skippedHooks, setSkippedHooks] = useState<Set<string>>(new Set())
  const [aiBusy, setAiBusy]             = useState(false)
  const [aiOffline, setAiOffline]       = useState(false)
  const [aiSuggested, setAiSuggested]   = useState<SuggestedPoll[]>([])
  const [txLang, setTxLang]               = useState<TxLang>('all')
  // Real breakout rooms from /api/.../breakouts.
  const { rooms: apiRooms, create: createBreakouts, refresh: refreshRooms } = useBreakouts(session.id)
  const [breakoutBusy, setBreakoutBusy]     = useState(false)
  const [breakoutErr, setBreakoutErr]       = useState<string | null>(null)
  const [newGroupCount, setNewGroupCount]   = useState(2)
  const [reactionOpen, setReactionOpen]   = useState(false)
  const [myReaction, setMyReaction]       = useState<string | null>(null)
  const [remoteReactions, setRemoteReactions] = useState<{ id: number; emoji: string; name: string }[]>([])
  const [ending, setEnding]               = useState(false)
  const captionsEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  void role

  // Auto-scroll the captions list to the newest line so it behaves like the
  // Teams/Meet caption pane — the list stays pinned to the bottom as new
  // segments stream in, instead of growing past the viewport.
  useEffect(() => {
    if (rightTab === 'transcript') captionsEndRef.current?.scrollIntoView({ block: 'end' })
  }, [captionSegs, rightTab])

  // End the session for EVERYONE (host only). Hits /end which flips status to
  // ENDED and deletes the LiveKit room — every other participant is then
  // disconnected (ROOM_DELETED) and auto-redirected. We navigate the host to
  // the post-conference afterwards. Previously this button was just a link, so
  // the room stayed live and members were stranded.
  const handleEndSession = async () => {
    setEnding(true)
    if (connected) await endLiveSession(session.id)
    router.push(`/session/${session.id}/post`)
  }

  useEffect(() => {
    const i = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(i)
  }, [])

  // Real cognitive alerts come from the presenter-alerts SSE (engagement
  // service). Surface the newest one as the private nudge toast.
  useEffect(() => {
    if (alertsDisabled || presenterAlerts.length === 0) return
    setAlertText(presenterAlerts[0].message)
    const t = setTimeout(() => setAlertText(null), 8000)
    return () => clearTimeout(t)
  }, [presenterAlerts, alertsDisabled])

  useEffect(() => {
    if (myReaction) {
      const t = setTimeout(() => setMyReaction(null), 4000)
      return () => clearTimeout(t)
    }
  }, [myReaction])

  // Auto-dismiss the media (camera/mic) error toast after a few seconds.
  useEffect(() => {
    if (!mediaError) return
    const t = setTimeout(() => setMediaError(null), 7000)
    return () => clearTimeout(t)
  }, [mediaError])

  // Show a peer's reaction as a floating badge that self-removes after 4s.
  const addRemoteReaction = useCallback((emoji: string, name: string) => {
    const id = Date.now() + Math.random()
    setRemoteReactions((prev) => [...prev, { id, emoji, name }].slice(-12))
    setTimeout(() => setRemoteReactions((prev) => prev.filter((r) => r.id !== id)), 4000)
  }, [])

  // "Mute all" toggle. Muting server-mutes every other participant's mic.
  // Un-muting clears the local "all muted" indicator so the faculty tiles
  // reflect reality again — WebRTC/LiveKit cannot force a remote mic back ON
  // without that participant's consent, so "unmute all" lifts the room-wide
  // mute state and lets people unmute themselves rather than silently failing
  // (previously the button was one-way: once muted it could never be undone).
  const toggleMuteAll = async () => {
    const next = !mutedAll
    setMutedAll(next)
    if (next && connected) await muteAllParticipants(session.id)
  }

  const approveHook = async (hid: string, approved: boolean) => {
    if (approved) {
      const ok = await fireHook(hid)
      if (ok) setHookNotif('Launched — learners can answer now.')
    } else {
      setSkippedHooks((s) => new Set(s).add(hid))
    }
  }

  // AI poll suggestions (Gemini). 503/AI_UNAVAILABLE → honest "AI offline".
  const runAiSuggest = async () => {
    setAiBusy(true); setAiOffline(false)
    const r = await suggestHooks(session.id)
    setAiBusy(false)
    if (r.ok) setAiSuggested(r.polls)
    else setAiOffline(true)
  }

  const acceptSuggested = async (p: SuggestedPoll) => {
    const ok = await createHook({ kind: 'POLL', prompt: p.q, options: p.options, correctOption: p.correct ?? undefined })
    if (ok) setAiSuggested((prev) => prev.filter((x) => x !== p))
  }

  // Real transcript export — pulls finalized/ASR segments from the captions API.
  const downloadTranscript = async () => {
    try {
      const res = await fetch(`/api/classroom/sessions/${session.id}/captions/transcript`, { credentials: 'include' })
      const json = await res.json()
      if (!json.ok || !json.data?.transcripts?.length) {
        downloadText(`LIVE SESSION TRANSCRIPT\n${session.title}\n\nNo transcript is available yet for this session.`, `transcript-${session.id}.txt`)
        return
      }
      const body = json.data.transcripts
        .map((t: { language: string; contentText?: string; segments?: { startMs: number; speakerName?: string | null; text: string }[] }) => {
          const header = `── ${t.language?.toUpperCase() ?? ''} ──`
          const lines = (t.segments ?? []).map((s) => `[${fmtClock(s.startMs)}] ${s.speakerName ? s.speakerName + ': ' : ''}${s.text}`).join('\n')
          return `${header}\n${lines || t.contentText || ''}`
        })
        .join('\n\n')
      downloadText(`LIVE SESSION TRANSCRIPT\n${session.title}\n\n${body}`, `transcript-${session.id}.txt`)
    } catch {
      downloadText(`LIVE SESSION TRANSCRIPT\n${session.title}\n\nTranscript could not be loaded.`, `transcript-${session.id}.txt`)
    }
  }

  const handleCreateBreakouts = async () => {
    setBreakoutBusy(true); setBreakoutErr(null)
    const r = await createBreakouts(newGroupCount)
    setBreakoutBusy(false)
    if (!r.ok) {
      setBreakoutErr(r.error.code === 'NOT_LIVE'
        ? 'Start the session (go live) before creating breakout rooms.'
        : r.error.message)
    }
  }

  const submitNewHook = async () => {
    const prompt = newHookLabel.trim()
    if (!prompt) return
    const map: Record<typeof newHookKind, { kind: ApiHookKind; options?: string[] }> = {
      tf:      { kind: 'TRUE_FALSE', options: ['True', 'False'] },
      oneword: { kind: 'ONE_WORD' },
      concept: { kind: 'REPEAT_CONCEPT' },
      dilemma: { kind: 'DILEMMA' },
    }
    const m = map[newHookKind]
    const ok = await createHook({ kind: m.kind, prompt, options: m.options })
    if (ok) { setNewHookLabel(''); setNewHookOpen(false) }
  }

  // SJT = an AI-generated clinical self-test grounded in the session's
  // materials (real /hooks/suggest route). 503 → honest "AI offline".
  const openSjt = () => {
    setSjtActive(true); setSjtPolls([]); setSjtOffline(false)
    setSjtIdx(0); setSjtPick(null); setSjtCorrect(0); setSjtDone(false)
  }
  const generateSjt = async () => {
    setSjtBusy(true); setSjtOffline(false)
    const r = await suggestHooks(session.id)
    setSjtBusy(false)
    if (r.ok && r.polls.length > 0) {
      setSjtPolls(r.polls); setSjtIdx(0); setSjtPick(null); setSjtCorrect(0); setSjtDone(false)
    } else {
      setSjtOffline(true)
    }
  }
  const answerSjt = (opt: string) => {
    if (sjtPick !== null) return
    setSjtPick(opt)
    const cur = sjtPolls[sjtIdx]
    if (cur?.correct && opt === cur.correct) setSjtCorrect((c) => c + 1)
  }
  const nextSjt = () => {
    if (sjtIdx + 1 < sjtPolls.length) { setSjtIdx((i) => i + 1); setSjtPick(null) }
    else setSjtDone(true)
  }

  const engBand    = engagement === null ? '' : engagement >= 75 ? 'High' : engagement >= 55 ? 'Steady' : 'Dropping'
  const engColor   = engagement === null ? 'text-slate-500' : engagement >= 75 ? 'text-emerald-400' : engagement >= 55 ? 'text-amber-400' : 'text-rose-400'

  return (
    // fixed inset-0 so the console is a full-viewport takeover on ANY route.
    // The host route's (platform) layout gives full height, but the (call)
    // layout used by /classroom/[id] is a bare fragment — without fixed
    // positioning the console collapsed to content height (the "half window"
    // clipping participants saw). Mirrors the prior participant room.
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-gray-950 text-slate-100">
      {connected && <ReactionsChannel reaction={myReaction} onRemote={addRemoteReaction} />}
      {/* Non-hosts get the live hook-answer modal (the right-panel Hooks tab is
          the host's authoring surface). Self-contained HTTP poller — works even
          if this client's video socket is down, and closes the loop with the
          presenter's now-live response counts. */}
      {!isHost && <HookOverlay sessionId={session.id} />}
      {remoteReactions.length > 0 && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 flex-col-reverse items-center gap-1.5">
          {remoteReactions.map((r) => (
            <div key={r.id} className="flex animate-in fade-in slide-in-from-bottom-2 items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-3 py-1 shadow-lg backdrop-blur">
              <span className="text-lg leading-none">{r.emoji}</span>
              <span className="text-[11px] font-medium text-slate-200">{r.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── TOP STATUS BAR ─────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-600 bg-gray-700 px-3 backdrop-blur-sm md:gap-3 md:px-4">
        <Link
          href={isHost ? `/session/${session.id}/pre` : '/calendar'}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <ArrowLeft className="size-3.5" />
          Exit live
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px]">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-rose-300 uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-rose-400" />
            Live
          </span>
          <span className="min-w-0 truncate font-semibold tracking-tight text-white">{session.title}</span>
        </div>

        {/* View toggle */}
        <div className="ml-2 flex shrink-0 items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5 md:ml-4">
          {(['gallery', 'presentation'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { setViewMode(v); if (v === 'presentation') setSharingScreen(false) }}
              className={cn(
                'rounded-full px-2.5 py-1 text-[10.5px] font-medium capitalize transition-colors md:px-3',
                viewMode === v ? 'bg-white/[0.12] text-white' : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {v === 'gallery' ? (
                <><span className="md:hidden">Gallery</span><span className="hidden md:inline">Gallery View</span></>
              ) : (
                <><span className="md:hidden">Present</span><span className="hidden md:inline">Presentation</span></>
              )}
            </button>
          ))}
        </div>

        {sharingScreen && (
          <span className="rounded-full border border-teal-500/30 bg-teal-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-teal-300">
            You are sharing screen
          </span>
        )}

        <div className="ml-auto hidden items-center gap-4 text-[11.5px] text-slate-400 md:flex">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" />
            <span className="font-mono tabular-nums">{fmtTime(elapsed)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users2 className="size-3.5" />
            {connected ? <LiveParticipantCount /> : (session.counts.participants || 0)}
          </span>
          <span className={cn('inline-flex items-center gap-1 font-semibold', engColor)}>
            {engagement === null ? '— ' : `${Math.round(engagement)}% `}{engBand}
          </span>
        </div>
      </div>

      {/* ── MAIN ROW ───────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* LEFT PANEL */}
        <div className={cn('hidden shrink-0 flex-col border-r border-gray-200 bg-white transition-all duration-300 md:flex', leftCollapsed ? 'w-10' : 'w-[188px]')}>
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-gray-200 px-2.5">
            {!leftCollapsed && <span className="text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Faculty</span>}
            <button type="button" onClick={() => setLeftCollapsed((v) => !v)} className="ml-auto rounded-md p-1 text-gray-400 hover:text-gray-900">
              {leftCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
            </button>
          </div>

          {!leftCollapsed && (
            <div className="flex flex-col gap-2 overflow-y-auto p-2.5">
              {connected ? (
                <FacultyPanelLive hostId={session.hostId} mutedAll={mutedAll} />
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[10px] leading-snug text-gray-400">
                  Faculty tiles appear once the room connects.
                </div>
              )}

              {isHost && <div className="mt-1 border-t border-gray-200 pt-2.5">
                <div className="mb-1.5 text-[9px] font-semibold tracking-widest text-gray-400 uppercase">Mod tools</div>
                <button
                  type="button"
                  onClick={toggleMuteAll}
                  className={cn('mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] transition-colors hover:bg-gray-100', mutedAll ? 'text-rose-600 font-medium' : 'text-gray-600 hover:text-gray-900')}
                >
                  {mutedAll ? <Mic className="size-3" /> : <MicOff className="size-3" />}
                  {mutedAll ? 'Unmute all' : 'Mute all'}
                </button>
                <button
                  type="button"
                  onClick={() => setAlertsDisabled((v) => !v)}
                  className={cn('mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] transition-colors hover:bg-gray-100', alertsDisabled ? 'text-amber-600 font-medium' : 'text-gray-600 hover:text-gray-900')}
                >
                  <BellOff className="size-3" />
                  {alertsDisabled ? 'Alerts disabled' : 'Disable alerts'}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('presentation')}
                  className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                >
                  <Monitor className="size-3" />
                  Spotlight
                </button>
              </div>}
            </div>
          )}
        </div>

        {/* CENTER */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">

          {/* ── CENTER STAGE — real LiveKit video (or honest offline state) ─ */}
          {connected ? (
            <CenterStageLive
              hostId={session.hostId}
              viewMode={viewMode}
              mutedAll={mutedAll}
              myReaction={myReaction}
              liveHookLabel={liveHook?.prompt ?? null}
              caption={subtitleCaption}
            />
          ) : (
            <CenterStageOffline status={tokenStatus} />
          )}

          {/* Presentation (screen-share) is handled inside CenterStageLive.
              The demo slide-deck strip is removed — there is no real slide
              backend; the live "presentation" is a shared screen. */}
        </div>

        {/* RIGHT PANEL */}
        <div className={cn('hidden shrink-0 flex-col border-l border-gray-200 bg-white transition-all duration-300 md:flex', rightCollapsed ? 'w-10' : 'w-[264px]')}>
          {/* Collapse toggle row */}
          <div className="flex h-9 shrink-0 items-center border-b border-gray-200 px-2.5">
            <button type="button" onClick={() => setRightCollapsed((v) => !v)} className="rounded-md p-1 text-gray-400 hover:text-gray-900">
              {rightCollapsed ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
            {!rightCollapsed && <span className="ml-1 text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Panel</span>}
          </div>
          {!rightCollapsed && <>
          <div className={cn('grid shrink-0 border-b border-gray-200', isHost ? 'grid-cols-5' : 'grid-cols-3')}>
            {([
              // People (roster) + Captions + Rooms are for everyone. Hooks
              // authoring + AI co-facilitator are host-only moderator surfaces;
              // learners answer hooks via the HookOverlay modal, not this panel.
              { key: 'people' as RightTab, icon: <Users2 className="size-[13px]" />, label: 'People' },
              ...(isHost ? [{ key: 'hooks' as RightTab, icon: <Zap className="size-[13px]" />, label: 'Hooks' }] : []),
              { key: 'transcript' as RightTab, icon: <Globe className="size-[13px]" />,      label: 'Captions' },
              ...(isHost ? [{ key: 'ai' as RightTab, icon: <Sparkles className="size-[13px]" />, label: 'AI' }] : []),
              { key: 'breakout'   as RightTab, icon: <Layers className="size-[13px]" />,     label: 'Rooms' },
            ]).map((tab) => (
              <button key={tab.key} type="button" onClick={() => setRightTab(tab.key)}
                className={cn('flex flex-col items-center gap-0.5 border-b-2 py-2 text-[9px] font-medium transition-colors', rightTab === tab.key ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-400 hover:text-gray-700')}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* Clip here; each tab owns its own internal scroll so the captions
              list (and the others) stay bounded to the panel instead of
              overflowing the window. */}
          <div className="min-h-0 flex-1 overflow-hidden">

            {rightTab === 'people' && (
              <div className="h-full overflow-y-auto p-3">
                {connected ? (
                  <PeoplePanelLive hostId={session.hostId} />
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-[10.5px] leading-snug text-gray-400">
                    Participants appear here once the room connects.
                  </div>
                )}
              </div>
            )}

            {isHost && rightTab === 'hooks' && (
              <div className="h-full space-y-2 overflow-y-auto p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Attention Hooks</span>
                  <button type="button" onClick={runAiSuggest} disabled={aiBusy}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50">
                    <Sparkles className="size-3" />{aiBusy ? 'Generating…' : 'AI suggest'}
                  </button>
                </div>

                {aiOffline && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] leading-snug text-amber-700">
                    AI suggestions are offline right now. You can still add hooks manually below — they sync live in production.
                  </div>
                )}

                {/* AI-suggested polls — accept to create a real hook */}
                {aiSuggested.map((p, i) => (
                  <div key={`ai-${i}`} className="overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/60 shadow-sm">
                    <div className="px-3 pt-2.5 pb-1.5">
                      <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-600"><Sparkles className="size-2.5" />AI poll</div>
                      <div className="text-[11px] font-medium leading-snug text-gray-800">{p.q}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.options.map((o) => (
                          <span key={o} className={cn('rounded-full border px-2 py-0.5 text-[9px]', o === p.correct ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-violet-100 bg-white text-gray-600')}>{o}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-1.5 border-t border-violet-100 px-2.5 py-2">
                      <button type="button" onClick={() => setAiSuggested((prev) => prev.filter((x) => x !== p))} className="flex-1 rounded-lg border border-gray-200 py-1 text-[10px] text-gray-500 hover:bg-gray-50">Dismiss</button>
                      <button type="button" onClick={() => acceptSuggested(p)} className="flex-1 rounded-lg bg-violet-500 py-1 text-[10px] font-semibold text-white hover:bg-violet-400">Add to hooks</button>
                    </div>
                  </div>
                ))}

                {/* Real hooks */}
                {apiHooks === null ? (
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-[10.5px] text-gray-400">Loading hooks…</div>
                ) : apiHooks.length === 0 && aiSuggested.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[10.5px] text-gray-400">No hooks yet. Use “AI suggest” or add one below.</div>
                ) : (
                  apiHooks.map((h) => {
                    const fired = !!h.firedAt && !h.closedAt
                    const skipped = skippedHooks.has(h.id)
                    return (
                      <div key={h.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <div className="px-3 pt-2.5 pb-1.5">
                          <div className="mb-1 inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-gray-500 uppercase">{HOOK_KIND_LABEL[h.kind]}</div>
                          <div className="text-[11px] font-medium leading-snug text-gray-800">{h.prompt}</div>
                        </div>
                        {!fired && !skipped ? (
                          <div className="flex gap-1.5 border-t border-gray-100 px-2.5 py-2">
                            <button type="button" onClick={() => approveHook(h.id, false)} className="flex-1 rounded-lg border border-gray-200 py-1 text-[10px] text-gray-500 hover:bg-gray-50">Skip</button>
                            <button type="button" onClick={() => approveHook(h.id, true)} className="flex-1 rounded-lg bg-teal-500 py-1 text-[10px] font-semibold text-white hover:bg-teal-400">Launch</button>
                          </div>
                        ) : (
                          <div className={cn('flex items-center justify-between border-t border-gray-100 px-3 py-1.5 text-[10px] font-semibold', fired ? 'text-teal-600' : 'text-gray-400')}>
                            <span>{fired ? <><Check className="mr-1 inline-block size-3" />Live now</> : 'Skipped'}</span>
                            {fired && <span className="font-normal text-gray-400">{h.responseCount} responses</span>}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}

                {/* New hook with type picker */}
                {newHookOpen ? (
                  <div className="rounded-2xl border border-teal-200 bg-teal-50 p-2.5 space-y-2">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-teal-700">New Hook</div>
                    <div className="grid grid-cols-2 gap-1">
                      {([
                        { kind: 'tf'      as const, label: 'True / False' },
                        { kind: 'oneword' as const, label: 'One word' },
                        { kind: 'concept' as const, label: 'Concept check' },
                        { kind: 'dilemma' as const, label: 'Dilemma' },
                      ]).map((t) => (
                        <button key={t.kind} type="button" onClick={() => setNewHookKind(t.kind)}
                          className={cn('rounded-xl border py-1.5 text-[10px] font-medium transition-colors',
                            newHookKind === t.kind ? 'border-teal-500 bg-teal-500 text-white' : 'border-teal-200 bg-white text-gray-600 hover:border-teal-400')}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <input value={newHookLabel} onChange={(e) => setNewHookLabel(e.target.value)}
                      placeholder="Enter question…"
                      className="w-full rounded-xl border border-teal-200 bg-white px-2.5 py-1.5 text-[11px] text-gray-900 outline-none focus:ring-2 focus:ring-teal-400" />
                    <div className="flex gap-1.5">
                      <button type="button" disabled={!newHookLabel.trim()} onClick={submitNewHook}
                        className="flex-1 rounded-full bg-teal-500 py-1.5 text-[10px] font-semibold text-white hover:bg-teal-400 disabled:opacity-40">Add</button>
                      <button type="button" onClick={() => setNewHookOpen(false)} className="rounded-full border border-teal-200 px-3 py-1.5 text-[10px] text-gray-500 hover:bg-gray-50">Cancel</button>
                    </div>
                    <p className="text-[9px] leading-snug text-teal-700/70">Multiple-choice polls (with options) come from “AI suggest”.</p>
                  </div>
                ) : (
                  <button type="button" onClick={() => setNewHookOpen(true)}
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-gray-300 py-2.5 text-[10.5px] text-gray-400 hover:border-teal-400 hover:text-teal-600">
                    <Plus className="size-3.5" />
                    New hook
                  </button>
                )}
              </div>
            )}

            {rightTab === 'transcript' && (() => {
              const rows = txLang === 'all' ? captionSegs : captionSegs.filter((s) => s.lang === txLang)
              return (
              <div className="flex h-full flex-col p-3">
                {/* Language filter */}
                <div className="mb-2">
                  <div className="mb-1 text-[8.5px] font-semibold uppercase tracking-wider text-gray-400">Filter by language</div>
                  <div className="grid grid-cols-4 gap-1">
                    {LANG_FILTERS.map(({ key, label }) => (
                      <button key={key} type="button" onClick={() => setTxLang(key)}
                        className={cn('rounded-lg py-1 text-[8.5px] font-bold uppercase transition-colors', txLang === key ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Download + subtitle toggle */}
                <div className="mb-2 flex gap-1">
                  <button type="button" onClick={downloadTranscript} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50 py-1.5 text-[9px] text-gray-500 hover:bg-gray-100">
                    <Download className="size-3" />Download transcript
                  </button>
                  <button type="button" onClick={() => setShowSubtitles((v) => !v)}
                    className={cn('flex items-center justify-center gap-1 rounded-lg border px-3 py-1.5 text-[9px] font-semibold transition-colors', showSubtitles ? 'border-amber-300 bg-amber-100 text-amber-700' : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-700')}>
                    <Languages className="size-3" />Subtitles {showSubtitles ? 'On' : 'Off'}
                  </button>
                </div>
                {/* Live status */}
                <div className="mb-2 flex items-center gap-1.5 text-[9px] text-gray-400">
                  <span className={cn('size-1.5 rounded-full', captionsLive ? 'animate-pulse bg-emerald-400' : 'bg-gray-300')} />
                  {captionsLive ? 'Live captions connected' : 'Waiting for captions…'}
                </div>
                {/* Entries — real ASR segments */}
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {rows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-[10.5px] leading-snug text-gray-400">
                      Live captions appear here once the captions agent is transcribing the session.
                    </div>
                  ) : rows.map((l, i) => (
                    <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-2.5">
                      <div className="mb-0.5 flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-gray-400">{fmtClock(l.startMs)}</span>
                        {l.speaker && <span className="text-[9px] font-medium text-gray-600">{l.speaker}</span>}
                        <span className="ml-auto rounded bg-slate-200 px-1 py-0.5 text-[7.5px] font-bold uppercase text-slate-600">{l.lang}</span>
                      </div>
                      <p className="text-[11px] leading-snug text-gray-800">{l.text}</p>
                    </div>
                  ))}
                  <div ref={captionsEndRef} />
                </div>
              </div>
              )
            })()}

            {isHost && rightTab === 'ai' && (
              <div className="h-full overflow-y-auto p-3">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="size-4 text-teal-600" />
                  <span className="text-[12px] font-semibold text-gray-900">AI Co-Facilitator</span>
                </div>

                <button type="button" onClick={runAiSuggest} disabled={aiBusy}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 py-2 text-[10.5px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50">
                  <Wand2 className="size-3.5" />{aiBusy ? 'Generating…' : 'Generate poll ideas'}
                </button>
                {aiOffline && (
                  <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] leading-snug text-amber-700">
                    AI generation is offline in this environment. The live engagement nudges below still work; AI runs for real in production.
                  </div>
                )}
                {aiSuggested.length > 0 && (
                  <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[10.5px] text-violet-700">{aiSuggested.length} poll idea{aiSuggested.length === 1 ? '' : 's'} ready — review them in the Hooks tab.</div>
                )}

                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-gray-400">Live engagement nudges</div>
                {!isHost ? (
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-[10.5px] text-gray-400">Coaching nudges are shown to the session host.</div>
                ) : presenterAlerts.length === 0 ? (
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-[10.5px] leading-snug text-gray-400">
                    No nudges yet. As the room interacts, engagement-based suggestions (e.g. “attention dropping”, “ask a question”) appear here in real time.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {presenterAlerts.map((a) => (
                      <div key={a.id} className={cn('rounded-2xl border p-3', a.severity === 'WARN' ? 'border-amber-200 bg-amber-50' : 'border-teal-200 bg-teal-50')}>
                        <div className="flex items-start gap-2">
                          <Lightbulb className={cn('mt-0.5 size-3.5 shrink-0', a.severity === 'WARN' ? 'text-amber-600' : 'text-teal-600')} />
                          <p className="text-[11px] leading-snug text-gray-800">{a.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightTab === 'breakout' && (
              <div className="h-full overflow-y-auto p-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Smart Breakouts</span>
                  <button type="button" onClick={refreshRooms} className="rounded-full border border-gray-200 px-2.5 py-0.5 text-[10px] text-gray-500 transition-colors hover:bg-gray-50">Refresh</button>
                </div>

                {/* Create — random auto-grouping (the real /breakouts contract).
                    Host-only: learners can only join the room they're assigned. */}
                {isHost && <div className="mb-3 space-y-2 rounded-2xl border border-teal-200 bg-teal-50 p-2.5">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-teal-700">Split room into groups</div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] text-gray-600">Groups</span>
                    <button type="button" onClick={() => setNewGroupCount((n) => Math.max(1, n - 1))} className="grid size-6 place-items-center rounded-full border border-teal-200 bg-white text-gray-500 hover:bg-teal-100"><Minus className="size-3" /></button>
                    <span className="w-5 text-center font-mono text-[11px] font-semibold text-gray-700">{newGroupCount}</span>
                    <button type="button" onClick={() => setNewGroupCount((n) => Math.min(16, n + 1))} className="grid size-6 place-items-center rounded-full border border-teal-200 bg-white text-gray-500 hover:bg-teal-100"><Plus className="size-3" /></button>
                    <button type="button" disabled={breakoutBusy} onClick={handleCreateBreakouts} className="ml-auto flex items-center gap-1 rounded-full bg-teal-500 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-teal-400 disabled:opacity-50">
                      <Plus className="size-3" />{breakoutBusy ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                  {breakoutErr && <p className="text-[10px] leading-snug text-rose-600">{breakoutErr}</p>}
                  <p className="text-[9px] leading-snug text-teal-700/70">Learners are auto-assigned at random. Each room gets its own video space.</p>
                </div>}

                {/* Real breakout rooms */}
                {apiRooms === null ? (
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-[10.5px] text-gray-400">Loading rooms…</div>
                ) : apiRooms.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[10.5px] leading-snug text-gray-400">No breakout rooms yet. Create rooms above to split the class into small-group discussions.</div>
                ) : (
                  <div className="space-y-2">
                    {apiRooms.map((r) => (
                      <div key={r.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
                          <span className="text-[11px] font-semibold text-gray-900">{r.name}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[8.5px] font-bold uppercase', r.status === 'ACTIVE' ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500')}>{r.status}</span>
                        </div>
                        <div className="px-3 py-2">
                          <div className="mb-1.5 text-[9.5px] text-gray-500">{r.groupingMode.replace('_', ' ').toLowerCase()} · {r.participants.length} member{r.participants.length === 1 ? '' : 's'}</div>
                          <div className="flex flex-wrap gap-1">
                            {r.participants.length === 0
                              ? <span className="text-[9px] text-gray-400">No members assigned yet</span>
                              : r.participants.map((m) => (
                                <span key={m.userId} className="rounded-full bg-gray-100 px-2 py-0.5 text-[9px] text-gray-600">{(m.name || 'Learner').split(' ')[0]}</span>
                              ))}
                          </div>
                          {/* Join the breakout — leaves the main room and connects to the
                              child LiveKit room. Hosts/faculty can drop into any room;
                              learners can join the one they're assigned to. */}
                          {r.status === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() => onJoinBreakout({ id: r.id, name: r.name })}
                              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-teal-500 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-teal-400"
                            >
                              <Layers className="size-3" />
                              Join room
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
          </>}
        </div>
      </div>

      {/* ── BOTTOM DOCK ────────────────────────────────────────────────── */}
      <div className="relative flex h-[68px] shrink-0 items-center justify-center gap-2 border-t border-gray-600 bg-gray-700 px-4 backdrop-blur-sm">
        {connected ? (
          <MediaControls onSharingChange={setSharingScreen} canShare={role === 'HOST' || role === 'CO_HOST'} onPresent={() => setViewMode('presentation')} onError={setMediaError} />
        ) : (
          <>
            <DockBtn disabled icon={<MicOff className="size-5" />}   label="Mic"          />
            <DockBtn disabled icon={<VideoOff className="size-5" />} label="Camera"       />
            <DockBtn disabled icon={<Monitor className="size-5" />}  label="Share Screen" />
          </>
        )}

        {/* Advanced controls — desktop-only. `hidden md:contents` keeps the
            desktop dock layout byte-identical while dropping these from the
            simplified mobile dock (core controls + End Session remain). */}
        <div className="hidden md:contents">
          <div className="mx-1 h-8 w-px bg-white/[0.08]" />

          <DockBtn active={showWhiteboard}  icon={<Pencil className="size-5" />}  label="Whiteboard"   onClick={() => setShowWhiteboard((v) => !v)} />
          <DockBtn active={showLeaderboard} icon={<Trophy className="size-5" />}  label="Leaderboard"  onClick={() => setShowLeaderboard((v) => !v)} />
          {isHost && <DockBtn icon={<Zap className="size-5" />}       label="Hooks"        onClick={() => setRightTab('hooks')} />}
          <DockBtn icon={<Layers className="size-5" />}    label="Rooms"        onClick={() => setRightTab('breakout')} />

          <div className="relative">
            <DockBtn icon={<SmilePlus className="size-5" />} label="Reactions" onClick={() => setReactionOpen((v) => !v)} active={reactionOpen ? true : undefined} />
            {reactionOpen && (
              <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 flex gap-1.5 rounded-2xl border border-white/[0.08] bg-slate-800/95 p-2 shadow-2xl backdrop-blur">
                {REACTIONS_LIST.map((r) => (
                  <button key={r} type="button" onClick={() => { setMyReaction(r); setReactionOpen(false) }}
                    className="rounded-xl p-1.5 text-xl hover:bg-white/10 transition-colors">{r}</button>
                ))}
              </div>
            )}
          </div>

          <div className="mx-1 h-8 w-px bg-white/[0.08]" />

          {isHost && (
            <button type="button" onClick={openSjt}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 text-[12px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20">
              <HelpCircle className="size-4" />End &amp; SJT
            </button>
          )}

          <div className="mx-1 h-8 w-px bg-white/[0.08]" />
        </div>

        {/* Host ends the session for everyone; learners simply leave the room. */}
        {isHost ? (
          <button type="button" onClick={handleEndSession} disabled={ending}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-500 px-4 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-rose-500/90 disabled:opacity-60">
            <AlertCircle className="size-4" />{ending ? 'Ending…' : 'End Session'}
          </button>
        ) : (
          <Link href="/calendar"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-500 px-4 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-rose-500/90">
            <ArrowLeft className="size-4" />Leave
          </Link>
        )}
      </div>

      {/* ── WHITEBOARD — real tldraw canvas. Persists to /whiteboard and
            broadcasts every change to all participants over the LiveKit data
            channel. It needs the live room context, so it's available only when
            connected; otherwise we say so honestly instead of faking a canvas. */}
      {showWhiteboard && connected && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-zinc-900">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/10 bg-zinc-950 px-4">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-white">
              <Pencil className="size-3.5 text-teal-400" /> Shared whiteboard
            </span>
            <button type="button" onClick={() => setShowWhiteboard(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[12px] font-medium text-slate-200 transition-colors hover:bg-white/10">
              <X className="size-3.5" /> Close
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            <WhiteboardPanel
              sessionId={session.id}
              isHostish={isHost}
              fullscreen={false}
              onFullscreenChange={(v) => { if (!v) setShowWhiteboard(false) }}
            />
          </div>
        </div>
      )}
      {showWhiteboard && !connected && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-zinc-900 px-6 text-center">
          <Pencil className="size-7 text-slate-500" />
          <div className="text-[14px] font-semibold text-slate-200">The whiteboard needs the live room</div>
          <p className="max-w-sm text-[12px] leading-relaxed text-slate-500">
            The shared whiteboard syncs to every participant over the live connection. It becomes available the moment the room connects.
          </p>
          <button type="button" onClick={() => setShowWhiteboard(false)}
            className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 text-[12px] text-slate-200 hover:bg-white/10">
            <X className="size-3.5" /> Close
          </button>
        </div>
      )}

      {/* ── LEADERBOARD OVERLAY ──────────────────────────────────────────── */}
      {showLeaderboard && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowLeaderboard(false)}>
          <div className="mx-4 w-full max-w-md overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <div className="flex items-center gap-2">
                <Trophy className="size-5 text-amber-400" />
                <span className="text-[15px] font-semibold">Live Leaderboard</span>
              </div>
              <button type="button" onClick={() => setShowLeaderboard(false)} className="text-slate-500 hover:text-white"><X className="size-5" /></button>
            </div>
            {/* Category tabs (only the ones the real leaderboard supports) */}
            <div className="flex gap-0 overflow-x-auto border-b border-white/[0.06]">
              {([
                { key: 'score'    as LbCategory, label: 'Top Score' },
                { key: 'accurate' as LbCategory, label: 'Most Accurate' },
                { key: 'engaged'  as LbCategory, label: 'Most Engaged' },
              ]).map((c) => (
                <button key={c.key} type="button" onClick={() => setLbCategory(c.key)}
                  className={cn('shrink-0 border-b-2 px-3 py-2.5 text-[10.5px] font-medium whitespace-nowrap transition-colors',
                    lbCategory === c.key ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200')}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5 p-4">
              {leaderboard === null ? (
                <div className="px-2 py-8 text-center text-[12px] text-slate-500">Loading leaderboard…</div>
              ) : leaderboard.length === 0 ? (
                <div className="px-2 py-8 text-center text-[12px] leading-relaxed text-slate-500">
                  No engagement points yet. Points accrue as learners answer hooks, send chat messages and raise their hands.
                </div>
              ) : (
                [...leaderboard]
                  .sort((a, b) =>
                    lbCategory === 'accurate' ? b.breakdown.correct - a.breakdown.correct
                    : lbCategory === 'engaged' ? (b.breakdown.chats + b.breakdown.raises) - (a.breakdown.chats + a.breakdown.raises)
                    : b.points - a.points)
                  .map((l, idx) => {
                    const rank = idx + 1
                    const name = l.name ?? 'Learner'
                    const metric = lbCategory === 'accurate' ? `${l.breakdown.correct} correct`
                      : lbCategory === 'engaged' ? `${l.breakdown.chats + l.breakdown.raises} acts`
                      : l.points
                    return (
                      <div key={l.userId} className={cn('flex items-center gap-3 rounded-2xl border p-3', rank === 1 ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/[0.06] bg-white/[0.03]')}>
                        <div className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold', rank === 1 ? 'bg-amber-400 text-white' : rank === 2 ? 'bg-slate-500 text-white' : rank === 3 ? 'bg-amber-700 text-white' : 'bg-white/[0.08] text-slate-400')}>
                          {rank <= 3 ? <Medal className="size-3.5" /> : rank}
                        </div>
                        <div className="grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br from-slate-700 to-slate-800 text-[9px] font-semibold text-slate-300">{initialsOf(name)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-semibold text-white">{name}</div>
                          <div className="text-[10px] text-slate-400">{l.breakdown.correct} correct · {l.breakdown.chats} chats · {l.breakdown.raises} raises</div>
                        </div>
                        <div className="font-mono text-[13px] font-bold text-amber-300">{metric}</div>
                      </div>
                    )
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── HOOK NOTIFICATION ──────────────────────────────────────────── */}
      {hookNotif && (
        <div className="fixed top-[68px] right-4 z-50 flex animate-in slide-in-from-right-4 items-start gap-3 rounded-2xl border border-amber-500/30 bg-black/70 px-4 py-3 shadow-2xl backdrop-blur-md">
          <Zap className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] font-bold tracking-widest text-amber-400 uppercase">Hook Ready</div>
            <div className="mt-0.5 text-[12px] text-slate-200">{hookNotif}</div>
          </div>
          <button type="button" onClick={() => setHookNotif(null)} className="mt-0.5 text-slate-500 hover:text-slate-200">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* ── COGNITIVE ALERT (private — host only) ───────────────────────── */}
      {alertText && !alertsDisabled && (
        <div className="fixed top-[132px] right-4 z-50 flex animate-in slide-in-from-right-4 items-start gap-3 rounded-2xl border border-violet-500/30 bg-black/70 px-4 py-3 shadow-2xl backdrop-blur-md">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-violet-400" />
          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] font-bold tracking-widest text-violet-400 uppercase">Private · Cognitive alert</div>
            <div className="mt-0.5 text-[12px] text-slate-200">{alertText}</div>
          </div>
          <button type="button" onClick={() => setAlertText(null)} className="mt-0.5 text-slate-500 hover:text-slate-200">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* ── MEDIA (camera / mic) ERROR ──────────────────────────────────────
          getUserMedia rejections used to fail silently, so a denied-permission
          or busy-device looked like a dead button. Surface the real reason. */}
      {mediaError && (
        <div className="fixed bottom-[84px] left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 animate-in slide-in-from-bottom-4 items-start gap-3 rounded-2xl border border-rose-500/30 bg-black/80 px-4 py-3 shadow-2xl backdrop-blur-md">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1">
            <div className="text-[9.5px] font-bold tracking-widest text-rose-400 uppercase">Device problem</div>
            <div className="mt-0.5 text-[12px] leading-snug text-slate-200">{mediaError}</div>
          </div>
          <button type="button" onClick={() => setMediaError(null)} className="mt-0.5 text-slate-500 hover:text-slate-200">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* ── SJT OVERLAY — AI-generated clinical self-test (real /hooks/suggest) ─ */}
      {sjtActive && (() => {
        const cur = sjtPolls[sjtIdx]
        const hasQuiz = sjtPolls.length > 0
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md">
            {sjtDone ? (
              <div className="mx-4 w-full max-w-lg text-center">
                <div className="mx-auto grid size-20 place-items-center rounded-3xl bg-linear-to-br from-teal-500 to-emerald-500 shadow-[0_20px_40px_-10px_oklch(0.55_0.16_165/0.5)]">
                  <Trophy className="size-9 text-white" />
                </div>
                <h1 className="mt-6 text-[32px] font-bold tracking-tight">Session complete!</h1>
                <p className="mt-2 text-[14px] text-slate-400">{session.title} · {fmtTime(elapsed)} runtime</p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {[
                    { label: 'SJT score', value: `${sjtCorrect}/${sjtPolls.length}` },
                    { label: 'Avg engagement', value: engagement === null ? '—' : `${Math.round(engagement)}%` },
                  ].map((s) => (
                    <div key={s.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] py-4">
                      <div className="text-[22px] font-bold text-teal-300">{s.value}</div>
                      <div className="text-[10.5px] text-slate-400">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 text-left">
                  <div className="mb-3 text-[11px] font-semibold tracking-widest text-slate-400 uppercase">Session records</div>
                  <button type="button" onClick={downloadTranscript} className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-left transition-colors hover:bg-white/[0.08]">
                    <Download className="size-4 shrink-0 text-teal-400" />
                    <div>
                      <div className="text-[12px] font-semibold text-white">Live Transcript</div>
                      <div className="text-[10.5px] text-slate-500">Exports this session’s captions transcript</div>
                    </div>
                  </button>
                </div>
                <button type="button" onClick={handleEndSession} disabled={ending} className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-teal-600 px-8 text-[14px] font-semibold text-white hover:bg-teal-500 disabled:opacity-60">
                  {ending ? 'Ending…' : 'Post Conference'}
                  <ChevronRight className="size-4" />
                </button>
              </div>
            ) : (
              <div className="mx-4 w-full max-w-2xl overflow-hidden rounded-3xl border border-white/[0.08] bg-slate-900 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] font-bold tracking-widest text-amber-400 uppercase">
                        {hasQuiz ? `Question ${sjtIdx + 1} of ${sjtPolls.length}` : 'Situational Judgement Test'}
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[8.5px] font-semibold text-violet-300">
                        <Sparkles className="size-2.5" />AI
                      </span>
                    </div>
                    <div className="mt-0.5 text-[16px] font-semibold">Clinical Judgement — {session.specialty}</div>
                  </div>
                  <button type="button" onClick={() => setSjtActive(false)} className="text-slate-500 hover:text-slate-200">
                    <X className="size-5" />
                  </button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-6">
                  {!hasQuiz ? (
                    <div className="flex flex-col items-center gap-4 py-6 text-center">
                      {sjtOffline ? (
                        <>
                          <div className="grid size-14 place-items-center rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/30"><Sparkles className="size-6 text-amber-400" /></div>
                          <div className="text-[15px] font-semibold text-white">AI is offline right now</div>
                          <p className="max-w-sm text-[12.5px] leading-relaxed text-slate-400">The judgement-test generator couldn’t reach the AI service in this environment — it runs for real in production. Retry, or head to the post-conference.</p>
                          <button type="button" onClick={generateSjt} disabled={sjtBusy} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-700 px-5 text-[13px] font-semibold text-white hover:bg-slate-600 disabled:opacity-50">Try again</button>
                        </>
                      ) : (
                        <>
                          <div className="grid size-14 place-items-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/30"><Wand2 className="size-6 text-violet-300" /></div>
                          <div className="text-[15px] font-semibold text-white">Generate a clinical judgement test</div>
                          <p className="max-w-sm text-[12.5px] leading-relaxed text-slate-400">AI builds a short multiple-choice self-test grounded in this session’s objectives and materials — a quick end-of-class knowledge check.</p>
                          <button type="button" onClick={generateSjt} disabled={sjtBusy} className="inline-flex h-11 items-center gap-2 rounded-full bg-violet-600 px-6 text-[13px] font-semibold text-white hover:bg-violet-500 disabled:opacity-50">
                            {sjtBusy ? <><Loader2 className="size-4 animate-spin" />Generating…</> : <><Sparkles className="size-4" />Generate test</>}
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="mb-4 text-[14px] font-semibold text-white">{cur.q}</div>
                      <div className="space-y-2">
                        {cur.options.map((opt, i) => {
                          const isCorrect = cur.correct != null && opt === cur.correct
                          const picked = sjtPick === opt
                          return (
                            <button key={i} type="button" onClick={() => answerSjt(opt)}
                              className={cn('flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left text-[13px] transition-all',
                                sjtPick === null ? 'border-white/[0.08] hover:border-teal-500/40 hover:bg-teal-500/[0.06]'
                                : picked ? (isCorrect ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200')
                                : isCorrect ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300' : 'border-white/[0.04] opacity-40')}>
                              <div className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                                sjtPick !== null && isCorrect ? 'bg-emerald-500 text-white' : picked && !isCorrect ? 'bg-rose-500 text-white' : 'bg-white/[0.08]')}>
                                {sjtPick !== null && isCorrect ? <Check className="size-3" /> : String.fromCharCode(65 + i)}
                              </div>
                              {opt}
                            </button>
                          )
                        })}
                      </div>
                      {sjtPick !== null && cur.correct == null && (
                        <p className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 text-[12px] leading-relaxed text-slate-300">No single marked answer for this item — use it as a discussion prompt with the room.</p>
                      )}
                    </>
                  )}
                </div>

                {hasQuiz && (
                  <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-4">
                    <div className="text-[12px] text-slate-400">
                      {sjtPick === null ? 'Select an answer' : `Score so far · ${sjtCorrect}/${sjtIdx + 1}`}
                    </div>
                    {sjtPick !== null && (
                      <button type="button" onClick={nextSjt} className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-700 px-5 text-[13px] font-semibold text-white hover:bg-slate-600">
                        {sjtIdx + 1 < sjtPolls.length ? 'Next question' : 'Finish'}
                        <ChevronRight className="size-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function DockBtn({
  icon, label, onClick, active, disabled,
}: {
  icon: React.ReactNode; label: string; onClick?: () => void; active?: boolean; disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? `${label} — available once the room connects` : label}
      className={cn(
        'flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 transition-colors',
        disabled && 'cursor-not-allowed opacity-40',
        active === false
          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
          : active === true
            ? 'border-teal-500/30 bg-teal-500/10 text-teal-200 hover:bg-teal-500/20'
            : 'border-white/[0.08] bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
      )}
    >
      {icon}
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LiveKit-bound pieces — these only render inside <LiveKitRoom> (connected===true)
// ════════════════════════════════════════════════════════════════════════════

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

const TILE_GRADIENTS = [
  'from-teal-100 to-emerald-200', 'from-sky-100 to-blue-200', 'from-violet-100 to-purple-200',
  'from-amber-100 to-orange-200', 'from-rose-100 to-pink-200', 'from-cyan-100 to-teal-200',
  'from-indigo-100 to-indigo-200', 'from-fuchsia-100 to-pink-200',
]
function gradientFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return TILE_GRADIENTS[h % TILE_GRADIENTS.length]
}

// Live participant tally for the top status bar.
function LiveParticipantCount() {
  const participants = useParticipants().filter((p) => !isAgentParticipant(p))
  return <>{participants.length}</>
}

// Left-rail faculty tiles — the host + any promoted co-hosts, from real participants.
function FacultyPanelLive({ hostId, mutedAll }: { hostId: string; mutedAll: boolean }) {
  const participants = useParticipants().filter((p) => !isAgentParticipant(p))
  const faculty = participants.filter((p) => {
    if (p.identity === hostId) return true
    try { const m = JSON.parse(p.metadata || '{}'); return m.effectiveRole === 'HOST' || m.effectiveRole === 'CO_HOST' } catch { return false }
  })
  if (faculty.length === 0) {
    return <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[10px] leading-snug text-gray-400">No faculty have joined yet.</div>
  }
  return (
    <>
      {faculty.map((p) => {
        const host = p.identity === hostId
        const name = p.name || p.identity
        // Reflect the participant's REAL mic state. Don't force-muted off the
        // local "mutedAll" flag — the server-mute already flips
        // isMicrophoneEnabled to false (and back when they unmute), so OR-ing
        // mutedAll just froze every tile as muted forever, even after a member
        // unmuted themselves.
        const micOff = p.isMicrophoneEnabled === false
        const camOff = p.isCameraEnabled === false
        return (
          <div key={p.identity} className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
            <div className={cn('flex h-[68px] items-center justify-center bg-linear-to-br', gradientFor(p.identity))}>
              <span className="text-xl font-bold text-slate-700">{initialsOf(name)}</span>
            </div>
            <div className="px-2.5 py-2">
              <div className="truncate text-[11px] font-semibold leading-tight text-gray-900">{name}</div>
              <div className="mt-0.5 flex items-center justify-between">
                <div className="text-[9.5px] text-gray-500">{host ? 'Presenter' : 'Co-host'}</div>
                <div className="flex items-center gap-1">
                  {micOff ? <MicOff className="size-2.5 text-gray-400" /> : <Mic className="size-2.5 text-teal-500" />}
                  {camOff ? <VideoOff className="size-2.5 text-gray-400" /> : <Video className="size-2.5 text-teal-500" />}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

// Full participant roster (the Teams/Meet "People" panel). The left rail shows
// only faculty; this lists EVERYONE with live mic/cam + raised-hand state, with
// raised hands floated to the top so the host notices them first.
function PeoplePanelLive({ hostId }: { hostId: string }) {
  const participants = useParticipants().filter((p) => !isAgentParticipant(p))
  if (participants.length === 0) {
    return <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-[10.5px] leading-snug text-gray-400">No one has joined yet.</div>
  }
  const roleOf = (p: Participant): string => {
    if (p.identity === hostId) return 'Presenter'
    try {
      const m = JSON.parse(p.metadata || '{}')
      if (m.effectiveRole === 'HOST') return 'Presenter'
      if (m.effectiveRole === 'CO_HOST') return 'Co-host'
    } catch { /* default */ }
    return 'Participant'
  }
  const isHandRaised = (p: Participant): boolean => {
    try { return JSON.parse(p.metadata || '{}').handRaised === true } catch { return false }
  }
  const sorted = [...participants].sort((a, b) => Number(isHandRaised(b)) - Number(isHandRaised(a)))
  const raisedCount = participants.filter(isHandRaised).length
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[9px] font-semibold tracking-widest text-gray-400 uppercase">In this room · {participants.length}</span>
        {raisedCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
            <Hand className="size-2.5" />{raisedCount}
          </span>
        )}
      </div>
      {sorted.map((p) => {
        const name = p.name || p.identity
        const micOff = p.isMicrophoneEnabled === false
        const camOff = p.isCameraEnabled === false
        const raised = isHandRaised(p)
        return (
          <div key={p.identity} className={cn('flex items-center gap-2 rounded-xl px-2 py-1.5', raised ? 'bg-amber-50 ring-1 ring-amber-200' : 'hover:bg-gray-50')}>
            <div className={cn('grid size-7 shrink-0 place-items-center rounded-full bg-linear-to-br text-[9px] font-bold text-slate-700', gradientFor(p.identity))}>{initialsOf(name)}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium leading-tight text-gray-900">{name}</div>
              <div className="text-[9px] text-gray-400">{roleOf(p)}</div>
            </div>
            {raised && <Hand className="size-3.5 shrink-0 text-amber-500" />}
            <div className="flex items-center gap-1">
              {micOff ? <MicOff className="size-3 text-gray-300" /> : <Mic className="size-3 text-teal-500" />}
              {camOff ? <VideoOff className="size-3 text-gray-300" /> : <Video className="size-3 text-teal-500" />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Mic / camera / screen-share dock buttons driven by the local LiveKit participant.
function MediaControls({ onSharingChange, canShare, onPresent, onError }: {
  onSharingChange: (v: boolean) => void
  canShare: boolean
  onPresent: () => void
  onError: (msg: string) => void
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant()
  useEffect(() => { onSharingChange(!!isScreenShareEnabled) }, [isScreenShareEnabled, onSharingChange])

  // Raise hand — toggles `handRaised` in the participant's LiveKit metadata so
  // every client (and the People panel) sees it live. We MERGE into existing
  // metadata so we don't clobber `effectiveRole` (which drives faculty/role
  // detection). Mirrors the old participant room's raise-hand, restyled here.
  const [handRaised, setHandRaised] = useState(false)
  useEffect(() => {
    try { setHandRaised(JSON.parse(localParticipant.metadata || '{}').handRaised === true) }
    catch { setHandRaised(false) }
  }, [localParticipant.metadata])
  const toggleHand = async () => {
    const next = !handRaised
    let cur: Record<string, unknown> = {}
    try { cur = JSON.parse(localParticipant.metadata || '{}') } catch { /* fresh */ }
    try {
      await localParticipant.setMetadata(JSON.stringify({ ...cur, handRaised: next }))
      setHandRaised(next)
    } catch { /* signal not ready (mid-connect) — ignore */ }
  }

  const toggleMic = async () => {
    try { await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled) }
    catch (e) { onError(mediaErrorMessage(e, 'microphone')) }
  }
  const toggleCamera = async () => {
    try { await localParticipant.setCameraEnabled(!isCameraEnabled) }
    catch (e) { onError(mediaErrorMessage(e, 'camera')) }
  }
  const toggleShare = async () => {
    const next = !isScreenShareEnabled
    try { await localParticipant.setScreenShareEnabled(next) }
    catch (e) {
      // Dismissing the browser's screen-picker also rejects (NotAllowedError /
      // AbortError) — that's a cancel, not a failure. Only surface real errors.
      if (!isUserCancelledShare(e)) onError(mediaErrorMessage(e, 'screen'))
      return
    }
    if (next) onPresent()
  }

  return (
    <>
      <DockBtn
        active={isMicrophoneEnabled}
        onClick={toggleMic}
        icon={isMicrophoneEnabled ? <Mic className="size-5" /> : <MicOff className="size-5" />}
        label={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
      />
      <DockBtn
        active={isCameraEnabled}
        onClick={toggleCamera}
        icon={isCameraEnabled ? <Video className="size-5" /> : <VideoOff className="size-5" />}
        label="Camera"
      />
      {canShare && (
        <DockBtn
          active={isScreenShareEnabled ? true : undefined}
          onClick={toggleShare}
          icon={<Monitor className="size-5" />}
          label="Share Screen"
        />
      )}
      <DockBtn
        active={handRaised ? true : undefined}
        onClick={toggleHand}
        icon={<Hand className="size-5" />}
        label={handRaised ? 'Lower hand' : 'Raise hand'}
      />
    </>
  )
}

// Translate a getUserMedia / getDisplayMedia rejection into a clear, actionable
// message. These previously rejected silently, so a denied permission or a
// device held by another app looked like a button that simply did nothing.
function mediaErrorMessage(e: unknown, device: 'microphone' | 'camera' | 'screen'): string {
  const name = (e as { name?: string } | null)?.name
  const label = device === 'screen' ? 'screen sharing' : `your ${device}`
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return device === 'screen'
        ? 'Screen sharing was blocked. Allow it in your browser and try again.'
        : `Access to ${label} was blocked. Click the camera/mic icon in the browser address bar, choose Allow, then try again.`
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${device} was found. Connect one and try again.`
    case 'NotReadableError':
    case 'TrackStartError':
      return `${device[0].toUpperCase()}${device.slice(1)} is in use by another app. Close it (Zoom/Teams/etc.) and try again.`
    case 'OverconstrainedError':
      return `Your ${device} doesn't support the requested settings.`
    default:
      return `Couldn't start ${label}. Check it's connected and permitted in your browser, then try again.`
  }
}

function isUserCancelledShare(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  return name === 'NotAllowedError' || name === 'AbortError'
}

// Broadcasts the local reaction over the LiveKit data channel and surfaces other
// participants' reactions. Rendered only inside a connected room (it uses room
// hooks); returns null — it's purely a transport bridge. Reactions were
// previously local-only (you saw your own emoji, nobody else did).
function ReactionsChannel({ reaction, onRemote }: {
  reaction: string | null
  onRemote: (emoji: string, name: string) => void
}) {
  const { localParticipant } = useLocalParticipant()
  const { message } = useDataChannel('reaction')
  const onRemoteRef = useRef(onRemote)
  useEffect(() => { onRemoteRef.current = onRemote }, [onRemote])

  // Publish our own reaction whenever it changes to a non-null emoji.
  useEffect(() => {
    if (!reaction) return
    const name = (localParticipant.name || 'Someone').split(' ')[0]
    localParticipant
      .publishData(reactionEnc.encode(JSON.stringify({ emoji: reaction, name })), { topic: 'reaction', reliable: false })
      .catch(() => {/* reactions are fire-and-forget */})
  }, [reaction, localParticipant])

  // Surface reactions from other participants.
  useEffect(() => {
    if (!message) return
    try {
      const d = JSON.parse(reactionDec.decode(message.payload)) as { emoji?: unknown; name?: unknown }
      if (typeof d.emoji === 'string') onRemoteRef.current(d.emoji.slice(0, 8), String(d.name ?? 'Someone').slice(0, 40))
    } catch {/* ignore malformed */}
  }, [message])

  return null
}

function LiveHookBanner({ label }: { label: string }) {
  return (
    <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-teal-500/30 bg-black/60 px-3 py-1 backdrop-blur">
      <div className="text-[10px] font-semibold text-teal-300">
        <Zap className="mr-1 inline-block size-3" />
        Live: {label}
      </div>
    </div>
  )
}

function CaptionBar({ text, gallery }: { text: string; gallery?: boolean }) {
  return (
    <div className={cn(
      'pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 rounded-xl bg-black/80 px-4 text-center backdrop-blur',
      gallery ? 'bottom-10 w-[65%] py-2' : 'bottom-4 w-[80%] py-2.5',
    )}>
      <p className={cn('font-medium leading-snug text-white', gallery ? 'text-[11px]' : 'text-[13px]')}>{text}</p>
      <span className="mt-0.5 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[8px] font-semibold text-white/50 uppercase">Live captions</span>
    </div>
  )
}

function ParticipantStageTile({ participant, track, big, presenterBadge, mutedAll }: {
  participant: Participant | undefined
  track: ReturnType<typeof useTracks>[number] | undefined
  big?: boolean
  presenterBadge?: boolean
  mutedAll?: boolean
}) {
  if (!participant) {
    return <div className="relative overflow-hidden rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.04]" />
  }
  const name = participant.name || participant.identity
  const hasVideo = !!track && !!track.publication && track.publication.isSubscribed && !track.publication.isMuted
  // Real mic state only — see FacultyPanelLive: OR-ing mutedAll froze the icon.
  const micOff = participant.isMicrophoneEnabled === false
  let handRaised = false
  try { handRaised = JSON.parse(participant.metadata || '{}').handRaised === true } catch { /* none */ }
  return (
    <div className={cn('relative overflow-hidden rounded-2xl', handRaised && 'ring-2 ring-amber-400')}>
      {hasVideo && track ? (
        <TrackRefContext.Provider value={track}>
          <ParticipantTile className="absolute inset-0 size-full" disableSpeakingIndicator />
        </TrackRefContext.Provider>
      ) : (
        <>
          <div className={cn('absolute inset-0 bg-linear-to-br', gradientFor(participant.identity))} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('font-bold text-slate-700', big ? 'text-5xl' : 'text-xl')}>{initialsOf(name)}</span>
          </div>
        </>
      )}
      {handRaised && (
        <div className="absolute top-2 right-2 z-10 grid size-7 place-items-center rounded-full bg-amber-400 text-white shadow-lg animate-in zoom-in-50">
          <Hand className="size-4" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-black/50 px-3 py-2 backdrop-blur-sm">
        {micOff
          ? <MicOff className={cn('shrink-0 text-rose-400', big ? 'size-3' : 'size-2.5')} />
          : <Mic className={cn('shrink-0 text-teal-400', big ? 'size-3' : 'size-2.5')} />}
        <span className={cn('flex-1 truncate font-medium text-white', big ? 'text-[11px]' : 'text-[9.5px]')}>{name}</span>
        {presenterBadge && <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white">Presenter</span>}
      </div>
    </div>
  )
}

function CenterStageLive({ hostId, viewMode, mutedAll, myReaction, liveHookLabel, caption }: {
  hostId: string
  viewMode: ViewMode
  mutedAll: boolean
  myReaction: string | null
  liveHookLabel: string | null
  caption: string | null
}) {
  const { localParticipant } = useLocalParticipant()
  const participants = useParticipants().filter((p) => !isAgentParticipant(p))
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false })
  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false })
    .filter((t) => !isAgentParticipant(t.participant))
  const trackFor = (p: Participant) =>
    cameraTracks.find((t) => t.participant.identity === p.identity && t.source === Track.Source.Camera)

  const presenter = participants.find((p) => p.identity === hostId) ?? participants[0]
  const others = participants.filter((p) => p !== presenter)

  const share = screenTracks[screenTracks.length - 1]

  // A screen share takes over the stage for EVERYONE the moment it starts —
  // the Meet/Zoom behaviour. Previously the share rendered only in the sharer's
  // own local 'presentation' viewMode, so other participants (sitting in
  // gallery) never saw it at all. We also never render the sharer's OWN screen
  // back to them: FocusLayout on their own capture recurses into an infinite
  // mirror when they're sharing the whole screen — they get a placeholder.
  if (share) {
    const isLocalShare = share.participant.identity === localParticipant.identity
    return (
      <div className="relative min-h-0 flex-1 overflow-hidden bg-gray-900 p-2">
        <div className="relative h-full overflow-hidden rounded-2xl ring-1 ring-white/10">
          {isLocalShare ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-gray-950 text-center">
              <Monitor className="size-8 text-teal-400" />
              <div className="text-[14px] font-semibold text-slate-200">You’re presenting your screen</div>
              <p className="max-w-xs text-[12px] text-slate-500">Everyone in the room can see your shared screen. Use “Share Screen” in the dock again to stop.</p>
            </div>
          ) : (
            <FocusLayout trackRef={share} />
          )}
          {liveHookLabel && <LiveHookBanner label={liveHookLabel} />}
          {caption && <CaptionBar text={caption} />}
        </div>
      </div>
    )
  }

  if (viewMode === 'presentation') {
    return (
      <div className="relative min-h-0 flex-1 overflow-hidden bg-gray-900 p-2">
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <Monitor className="size-8 text-slate-600" />
          <div className="text-[14px] font-semibold text-slate-300">No one is sharing their screen</div>
          <p className="max-w-xs text-[12px] text-slate-500">Use “Share Screen” in the dock to present slides, OCT scans or an exam to the room.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative grid h-full grid-cols-4 grid-rows-3 gap-1.5 overflow-hidden bg-gray-900 p-2">
      {/* Presenter — 2×2 large tile */}
      <div className="relative col-span-2 row-span-2 overflow-hidden rounded-2xl ring-2 ring-teal-500/70 ring-offset-1 ring-offset-gray-900">
        <ParticipantStageTile participant={presenter} track={presenter ? trackFor(presenter) : undefined} big presenterBadge mutedAll={mutedAll} />
        {myReaction && <div className="absolute top-3 left-3 z-10 animate-in zoom-in-50 text-3xl">{myReaction}</div>}
        {liveHookLabel && <LiveHookBanner label={liveHookLabel} />}
      </div>

      {/* Up to 8 more participant tiles fill the remaining cells; empty cells stay blank. */}
      {others.slice(0, 8).map((p) => (
        <ParticipantStageTile key={p.identity} participant={p} track={trackFor(p)} mutedAll={mutedAll} />
      ))}

      {caption && <CaptionBar text={caption} gallery />}
    </div>
  )
}

function CenterStageOffline({ status }: { status: TokenState['status'] }) {
  const msg =
    status === 'loading' ? 'Connecting to the live room…'
    : status === 'waiting' ? 'Waiting for the host to admit you…'
    : status === 'denied' ? 'Your request to join was declined.'
    : 'The live room is not available right now.'
  const showHint = status === 'loading' || status === 'error'
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-3 bg-gray-900 p-8 text-center">
      <div className="grid size-16 place-items-center rounded-3xl bg-white/[0.04] ring-1 ring-white/[0.08]">
        {status === 'loading'
          ? <Loader2 className="size-7 animate-spin text-slate-400" />
          : <Video className="size-7 text-slate-500" />}
      </div>
      <div className="text-[14px] font-semibold text-slate-200">{msg}</div>
      {showHint && (
        <p className="max-w-sm text-[12px] leading-relaxed text-slate-500">
          Live video connects when the room is reachable. If the LiveKit server is offline in this environment, the conference tools below still work — video joins automatically in production.
        </p>
      )}
    </div>
  )
}
