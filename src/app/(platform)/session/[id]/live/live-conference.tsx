'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  BellOff,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eraser,
  Globe,
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
  Palette,
  Pencil,
  Plus,
  Settings,
  SmilePlus,
  Sparkles,
  Square,
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
} from '@livekit/components-react'
import { Track, type Participant } from 'livekit-client'
import '@livekit/components-styles'
import { isAgentParticipant } from '@/lib/livekit-helpers'
import { cn } from '@/lib/utils'
import type { SessionView } from '@/lib/medlearn/session-view'
import {
  useLiveToken, useEngagement, useLiveHooks, useLeaderboard, useBreakouts,
  useCaptions, usePresenterAlerts, suggestHooks,
  type TokenState, type ApiHookKind, type SuggestedPoll,
} from './live-data'

type ViewMode = 'gallery' | 'presentation'
type RightTab = 'hooks' | 'transcript' | 'ai' | 'breakout'
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
  const tok = useLiveToken(session.id)
  const [lkError, setLkError] = useState(false)
  const canConnect = tok.status === 'joined' && !!tok.token && !!tok.url && !lkError
  const body = (
    <LiveConferenceBody
      session={session}
      isHost={isHost}
      connected={canConnect}
      role={tok.role}
      tokenStatus={lkError ? 'error' : tok.status}
    />
  )
  if (canConnect) {
    return (
      <LiveKitRoom
        token={tok.token}
        serverUrl={tok.url}
        connect
        data-lk-theme="default"
        className="contents"
        onError={() => setLkError(true)}
        onDisconnected={() => setLkError(true)}
      >
        {body}
        <RoomAudioRenderer />
      </LiveKitRoom>
    )
  }
  return body
}

function LiveConferenceBody({ session, isHost, connected, role, tokenStatus }: {
  session: SessionView
  isHost: boolean
  connected: boolean
  role?: string
  tokenStatus: TokenState['status']
}) {
  const [viewMode, setViewMode]           = useState<ViewMode>('gallery')
  const [sharingScreen, setSharingScreen] = useState(false)
  const [leftCollapsed, setLeftCollapsed]   = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [rightTab, setRightTab]             = useState<RightTab>('hooks')
  const [showWhiteboard, setShowWhiteboard] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [wbColor, setWbColor]               = useState('#ffffff')
  const [wbSize, setWbSize]                 = useState(3)
  const [wbTool, setWbTool]                 = useState<'pen' | 'eraser' | 'shape' | 'text'>('pen')
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
  const [drawTool, setDrawTool]           = useState<'draw' | 'laser' | 'annotate' | null>(null)

  void role

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
    <div className="-mx-6 -my-8 flex h-[calc(100vh-56px)] flex-col overflow-hidden bg-gray-950 text-slate-100">

      {/* ── TOP STATUS BAR ─────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-600 bg-gray-700 px-4 backdrop-blur-sm">
        <Link
          href={`/session/${session.id}/pre`}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <ArrowLeft className="size-3.5" />
          Exit live
        </Link>

        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-rose-300 uppercase">
            <span className="size-1.5 animate-pulse rounded-full bg-rose-400" />
            Live
          </span>
          <span className="font-semibold tracking-tight text-white">{session.title}</span>
        </div>

        {/* View toggle */}
        <div className="ml-4 flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5">
          {(['gallery', 'presentation'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { setViewMode(v); if (v === 'presentation') setSharingScreen(false) }}
              className={cn(
                'rounded-full px-3 py-1 text-[10.5px] font-medium capitalize transition-colors',
                viewMode === v ? 'bg-white/[0.12] text-white' : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {v === 'gallery' ? 'Gallery View' : 'Presentation'}
            </button>
          ))}
        </div>

        {sharingScreen && (
          <span className="rounded-full border border-teal-500/30 bg-teal-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-teal-300">
            You are sharing screen
          </span>
        )}

        <div className="ml-auto flex items-center gap-4 text-[11.5px] text-slate-400">
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
        <div className={cn('flex shrink-0 flex-col border-r border-gray-200 bg-white transition-all duration-300', leftCollapsed ? 'w-10' : 'w-[188px]')}>
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

              <div className="mt-1 border-t border-gray-200 pt-2.5">
                <div className="mb-1.5 text-[9px] font-semibold tracking-widest text-gray-400 uppercase">Mod tools</div>
                <button
                  type="button"
                  onClick={() => setMutedAll(true)}
                  className={cn('mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] transition-colors hover:bg-gray-100', mutedAll ? 'text-rose-600 font-medium' : 'text-gray-600 hover:text-gray-900')}
                >
                  <MicOff className="size-3" />
                  {mutedAll ? 'All muted' : 'Mute all'}
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
                <button
                  type="button"
                  className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10.5px] text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                >
                  <Settings className="size-3" />
                  Settings
                </button>
              </div>
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
              drawTool={drawTool}
              onDrawTool={setDrawTool}
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
        <div className={cn('flex shrink-0 flex-col border-l border-gray-200 bg-white transition-all duration-300', rightCollapsed ? 'w-10' : 'w-[264px]')}>
          {/* Collapse toggle row */}
          <div className="flex h-9 shrink-0 items-center border-b border-gray-200 px-2.5">
            <button type="button" onClick={() => setRightCollapsed((v) => !v)} className="rounded-md p-1 text-gray-400 hover:text-gray-900">
              {rightCollapsed ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
            {!rightCollapsed && <span className="ml-1 text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Panel</span>}
          </div>
          {!rightCollapsed && <>
          <div className="grid shrink-0 grid-cols-4 border-b border-gray-200">
            {([
              { key: 'hooks'      as RightTab, icon: <Zap className="size-[13px]" />,        label: 'Hooks' },
              { key: 'transcript' as RightTab, icon: <Globe className="size-[13px]" />,      label: 'Captions' },
              { key: 'ai'         as RightTab, icon: <Sparkles className="size-[13px]" />,   label: 'AI' },
              { key: 'breakout'   as RightTab, icon: <Layers className="size-[13px]" />,     label: 'Rooms' },
            ] as const).map((tab) => (
              <button key={tab.key} type="button" onClick={() => setRightTab(tab.key)}
                className={cn('flex flex-col items-center gap-0.5 border-b-2 py-2 text-[9px] font-medium transition-colors', rightTab === tab.key ? 'border-teal-500 text-teal-600' : 'border-transparent text-gray-400 hover:text-gray-700')}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">

            {rightTab === 'hooks' && (
              <div className="space-y-2 p-3">
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
                </div>
              </div>
              )
            })()}

            {rightTab === 'ai' && (
              <div className="p-3">
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
              <div className="p-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[9.5px] font-semibold tracking-widest text-gray-400 uppercase">Smart Breakouts</span>
                  <button type="button" onClick={refreshRooms} className="rounded-full border border-gray-200 px-2.5 py-0.5 text-[10px] text-gray-500 transition-colors hover:bg-gray-50">Refresh</button>
                </div>

                {/* Create — random auto-grouping (the real /breakouts contract) */}
                <div className="mb-3 space-y-2 rounded-2xl border border-teal-200 bg-teal-50 p-2.5">
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
                </div>

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
          <MediaControls onSharingChange={setSharingScreen} canShare={role === 'HOST' || role === 'CO_HOST'} onPresent={() => setViewMode('presentation')} />
        ) : (
          <>
            <DockBtn active={undefined} icon={<MicOff className="size-5" />}   label="Mic"          onClick={undefined} />
            <DockBtn active={undefined} icon={<VideoOff className="size-5" />} label="Camera"       onClick={undefined} />
            <DockBtn active={undefined} icon={<Monitor className="size-5" />}  label="Share Screen" onClick={undefined} />
          </>
        )}

        <div className="mx-1 h-8 w-px bg-white/[0.08]" />

        <DockBtn active={showWhiteboard}  icon={<Pencil className="size-5" />}  label="Whiteboard"   onClick={() => setShowWhiteboard((v) => !v)} />
        <DockBtn active={showLeaderboard} icon={<Trophy className="size-5" />}  label="Leaderboard"  onClick={() => setShowLeaderboard((v) => !v)} />
        <DockBtn icon={<Zap className="size-5" />}       label="Hooks"        onClick={() => setRightTab('hooks')} />
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

        <button type="button" onClick={openSjt}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 text-[12px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20">
          <HelpCircle className="size-4" />End &amp; SJT
        </button>

        <div className="mx-1 h-8 w-px bg-white/[0.08]" />

        <Link href={`/session/${session.id}/post`}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-500 px-4 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-rose-500/90">
          <AlertCircle className="size-4" />End Session
        </Link>
      </div>

      {/* ── FULL-SCREEN WHITEBOARD ─────────────────────────────────────── */}
      {showWhiteboard && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-white">
          {/* Toolbar */}
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 shadow-sm">
            <span className="mr-2 text-[13px] font-semibold text-gray-800">Whiteboard</span>
            {/* Tools */}
            <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
              {([
                { key: 'pen'    as const, icon: <Pencil className="size-4" />,  label: 'Pen' },
                { key: 'eraser' as const, icon: <Eraser className="size-4" />,  label: 'Eraser' },
                { key: 'shape'  as const, icon: <Square className="size-4" />,  label: 'Shape' },
                { key: 'text'   as const, icon: <Minus className="size-4" />,   label: 'Text' },
              ]).map((t) => (
                <button key={t.key} type="button" title={t.label} onClick={() => setWbTool(t.key)}
                  className={cn('grid size-8 place-items-center rounded-lg transition-colors', wbTool === t.key ? 'bg-teal-500 text-white' : 'text-gray-500 hover:bg-gray-100')}>
                  {t.icon}
                </button>
              ))}
            </div>
            {/* Size */}
            <div className="flex items-center gap-1.5">
              <button onClick={() => setWbSize((s) => Math.max(1, s - 1))} className="grid size-6 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100"><Minus className="size-3" /></button>
              <span className="w-5 text-center text-[11px] font-mono font-semibold text-gray-700">{wbSize}</span>
              <button onClick={() => setWbSize((s) => Math.min(16, s + 1))} className="grid size-6 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 hover:bg-gray-100"><Plus className="size-3" /></button>
            </div>
            {/* Colors */}
            <div className="flex items-center gap-1">
              {['#111827','#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#6366f1','#ffffff'].map((c) => (
                <button key={c} type="button" onClick={() => setWbColor(c)}
                  className={cn('size-6 rounded-full border-2 transition-transform hover:scale-110', wbColor === c ? 'border-teal-500 scale-110' : 'border-gray-300')}
                  style={{ backgroundColor: c }} />
              ))}
              <label className="ml-1 flex size-6 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-gray-300 hover:border-teal-400" title="Custom colour">
                <Palette className="size-3 text-gray-400" />
                <input type="color" value={wbColor} onChange={(e) => setWbColor(e.target.value)} className="sr-only" />
              </label>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-teal-700">Shared with all participants</span>
              <button type="button" onClick={() => setShowWhiteboard(false)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
                <X className="size-3.5" /> Close
              </button>
            </div>
          </div>
          {/* Canvas area */}
          <div className="relative flex-1 overflow-hidden bg-white" style={{ cursor: wbTool === 'eraser' ? 'cell' : 'crosshair' }}>
            <div className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[13px] font-medium text-gray-300 select-none">Draw freely · {wbTool === 'pen' ? 'Pen' : wbTool === 'eraser' ? 'Eraser' : wbTool === 'shape' ? 'Shape' : 'Text'} selected · Size {wbSize}</span>
            </div>
          </div>
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
                <Link href={`/session/${session.id}/post`} className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-teal-600 px-8 text-[14px] font-semibold text-white hover:bg-teal-500">
                  Post Conference
                  <ChevronRight className="size-4" />
                </Link>
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
  icon, label, onClick, active,
}: {
  icon: React.ReactNode; label: string; onClick?: () => void; active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex h-12 flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 transition-colors',
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
        const micOff = p.isMicrophoneEnabled === false || mutedAll
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

// Mic / camera / screen-share dock buttons driven by the local LiveKit participant.
function MediaControls({ onSharingChange, canShare, onPresent }: {
  onSharingChange: (v: boolean) => void
  canShare: boolean
  onPresent: () => void
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant()
  useEffect(() => { onSharingChange(!!isScreenShareEnabled) }, [isScreenShareEnabled, onSharingChange])
  return (
    <>
      <DockBtn
        active={isMicrophoneEnabled}
        onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        icon={isMicrophoneEnabled ? <Mic className="size-5" /> : <MicOff className="size-5" />}
        label={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
      />
      <DockBtn
        active={isCameraEnabled}
        onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        icon={isCameraEnabled ? <Video className="size-5" /> : <VideoOff className="size-5" />}
        label="Camera"
      />
      {canShare && (
        <DockBtn
          active={isScreenShareEnabled ? true : undefined}
          onClick={async () => {
            const next = !isScreenShareEnabled
            try { await localParticipant.setScreenShareEnabled(next) } catch { /* user cancelled picker */ }
            if (next) onPresent()
          }}
          icon={<Monitor className="size-5" />}
          label="Share Screen"
        />
      )}
    </>
  )
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
  const micOff = participant.isMicrophoneEnabled === false || mutedAll
  return (
    <div className="relative overflow-hidden rounded-2xl">
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

const DRAW_TOOLS = [
  { key: 'draw' as const, icon: <Pencil className="size-3" />, label: 'Draw' },
  { key: 'laser' as const, icon: <Wand2 className="size-3" />, label: 'Laser' },
  { key: 'annotate' as const, icon: <HelpCircle className="size-3" />, label: 'Annotate' },
]

function CenterStageLive({ hostId, viewMode, mutedAll, drawTool, onDrawTool, myReaction, liveHookLabel, caption }: {
  hostId: string
  viewMode: ViewMode
  mutedAll: boolean
  drawTool: 'draw' | 'laser' | 'annotate' | null
  onDrawTool: (t: 'draw' | 'laser' | 'annotate' | null) => void
  myReaction: string | null
  liveHookLabel: string | null
  caption: string | null
}) {
  const participants = useParticipants().filter((p) => !isAgentParticipant(p))
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false })
  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false })
    .filter((t) => !isAgentParticipant(t.participant))
  const trackFor = (p: Participant) =>
    cameraTracks.find((t) => t.participant.identity === p.identity && t.source === Track.Source.Camera)

  const presenter = participants.find((p) => p.identity === hostId) ?? participants[0]
  const others = participants.filter((p) => p !== presenter)

  if (viewMode === 'presentation') {
    const share = screenTracks[screenTracks.length - 1]
    return (
      <div className="relative min-h-0 flex-1 overflow-hidden bg-gray-900 p-2">
        {share ? (
          <div className="relative h-full overflow-hidden rounded-2xl ring-1 ring-white/10">
            <FocusLayout trackRef={share} />
            {liveHookLabel && <LiveHookBanner label={liveHookLabel} />}
            {caption && <CaptionBar text={caption} />}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Monitor className="size-8 text-slate-600" />
            <div className="text-[14px] font-semibold text-slate-300">No one is sharing their screen</div>
            <p className="max-w-xs text-[12px] text-slate-500">Use “Share Screen” in the dock to present slides, OCT scans or an exam to the room.</p>
          </div>
        )}
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
        <div className="absolute bottom-10 left-3 z-10 flex items-center gap-1 rounded-xl border border-white/[0.08] bg-black/40 p-1 backdrop-blur">
          {DRAW_TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.label}
              onClick={() => onDrawTool(drawTool === t.key ? null : t.key)}
              className={cn('rounded-lg p-1.5 transition-colors', drawTool === t.key ? 'bg-teal-500/30 text-teal-300' : 'text-slate-400 hover:bg-white/10 hover:text-white')}
            >
              {t.icon}
            </button>
          ))}
        </div>
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
