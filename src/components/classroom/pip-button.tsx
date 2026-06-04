'use client'

// Picture-in-Picture button + auto-PiP-on-tab-switch.
//
// Two behaviours bundled here:
//
//  1. CLICK to open PiP. Prefers the Document Picture-in-Picture API
//     (Chrome/Edge) so we can embed the LiveKit video *and* a control
//     row (mic, speaker, return-to-room) inside the floating window —
//     same UX as Zoom / Teams / Meet. If the browser doesn't support
//     document PiP (Safari/Firefox) we fall back to the universal
//     video-element PiP, which gives an OS-rendered overlay with no
//     custom controls.
//
//  2. AUTO-PIP when the user switches tabs. Driven by the standard
//     mediaSession 'enterpictureinpicture' action handler. Chrome fires
//     it on visibility change without needing a fresh user gesture, as
//     long as the page is actively capturing camera/mic (which LiveKit
//     is the moment the user joins a room). Browser auto-closes the PiP
//     window when the user returns to the tab.
//
//     See Chrome's spec note:
//     developer.chrome.com/blog/automatic-picture-in-picture

import { useCallback, useEffect, useRef, useState } from 'react'
import { PictureInPicture } from 'lucide-react'
import { useRoomContext } from '@livekit/components-react'
import { Track, RemoteAudioTrack } from 'livekit-client'
import type { TrackPublication, Room } from 'livekit-client'
import { useSessionEvents } from '@/hooks/use-session-events'
import { cn } from '@/lib/utils'

type DocumentWithPip = Document & {
  pictureInPictureElement?: HTMLVideoElement | null
  exitPictureInPicture?: () => Promise<void>
}

interface DocumentPictureInPicture {
  requestWindow: (opts?: {
    width?: number
    height?: number
    disallowReturnToOpener?: boolean
    preferInitialWindowPlacement?: boolean
  }) => Promise<Window>
  window: Window | null
}
interface WindowWithDocPip extends Window {
  documentPictureInPicture?: DocumentPictureInPicture
}

export function PictureInPictureButton({
  sessionId,
  sessionTitle,
  selfDisplayName,
}: {
  sessionId: string
  sessionTitle?: string
  selfDisplayName?: string
}) {
  const room = useRoomContext()
  const { emit } = useSessionEvents({ sessionId, filter: ['PIP_TOGGLE'] })
  const [active, setActive] = useState(false)
  const [supported, setSupported] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /// Handle to the currently open document-PiP window so we can close it
  /// programmatically (e.g. when the tab becomes visible again the
  /// browser closes it for us, but we still want to clear React state).
  const pipWinRef = useRef<Window | null>(null)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const docPipOk = typeof window !== 'undefined' &&
      Boolean((window as WindowWithDocPip).documentPictureInPicture)
    const videoPipOk = Boolean((document as DocumentWithPip).pictureInPictureEnabled)
    setSupported(docPipOk || videoPipOk)
  }, [])

  useEffect(() => {
    if (!err) return
    const t = setTimeout(() => setErr(null), 3500)
    return () => clearTimeout(t)
  }, [err])

  useEffect(() => {
    function onLeave() {
      setActive(false)
    }
    document.addEventListener('leavepictureinpicture', onLeave)
    return () => document.removeEventListener('leavepictureinpicture', onLeave)
  }, [])

  // toggle() is intentionally stable across renders — captured by the
  // mediaSession action handler below and by the button onClick.
  const toggle = useCallback(async () => {
    const doc = document as DocumentWithPip
    const win = window as WindowWithDocPip

    // Already open: close whichever path is active and bail.
    if (active) {
      try {
        if (pipWinRef.current && !pipWinRef.current.closed) {
          pipWinRef.current.close()
        } else {
          await doc.exitPictureInPicture?.()
        }
      } finally {
        pipWinRef.current = null
        setActive(false)
        void emit('PIP_TOGGLE', { details: { enabled: false } })
      }
      return
    }

    // Find the best video to show: screen-share > remote camera >
    // local screen > local camera. This is the same priority used
    // before the rewrite; people care about slides over faces.
    const remotePubs = Array.from(room.remoteParticipants.values())
      .flatMap((p) => Array.from(p.trackPublications.values()))
      .filter((pub) => pub.isSubscribed && pub.track)
    const localPubs = Array.from(room.localParticipant.trackPublications.values())
      .filter((pub) => pub.track)

    const target: TrackPublication | undefined =
      remotePubs.find((t) => t.source === Track.Source.ScreenShare) ??
      remotePubs.find((t) => t.source === Track.Source.Camera) ??
      localPubs.find((t) => t.source === Track.Source.ScreenShare) ??
      localPubs.find((t) => t.source === Track.Source.Camera)

    const docPip = win.documentPictureInPicture

    // Preferred path: Document PiP with our own UI. Lets us render
    // mic + speaker + return controls alongside the video.
    if (docPip) {
      try {
        const pipWin = await docPip.requestWindow({ width: 360, height: 280 })
        pipWinRef.current = pipWin

        const friendlyTitle = (sessionTitle ?? '').trim() || room.name || 'Live class'
        const friendlyName =
          (selfDisplayName ?? '').trim() ||
          room.localParticipant.name ||
          'Participant'

        renderRoomMiniWindow(pipWin, {
          title: friendlyTitle,
          name: friendlyName,
          parent: window,
          room,
          videoTrack: target?.track ?? null,
        })

        pipWin.addEventListener('pagehide', () => {
          pipWinRef.current = null
          setActive(false)
          try { window.focus() } catch { /* focus blocked — silent */ }
        }, { once: true })

        setActive(true)
        void emit('PIP_TOGGLE', { details: { enabled: true, mode: 'document' } })
        return
      } catch (e) {
        console.warn('[PiP] documentPictureInPicture failed', e)
        // Fall through to video-element PiP if possible.
      }
    }

    // Fallback for Safari/Firefox: OS-rendered video PiP. No custom
    // controls, just the video.
    const videoEl = (target?.track?.attachedElements?.[0] ?? null) as HTMLVideoElement | null
    if (!videoEl) {
      setErr('No video to pop out — use Chrome or Edge for a mini-window with controls')
      return
    }
    try {
      await videoEl.requestPictureInPicture()
      setActive(true)
      void emit('PIP_TOGGLE', { details: { enabled: true, mode: 'video' } })
    } catch (e) {
      const name = (e as { name?: string })?.name
      const msg =
        name === 'NotAllowedError' ? 'Browser blocked picture-in-picture' :
        name === 'InvalidStateError' ? 'Video not ready yet — try again in a moment' :
        'Could not start picture-in-picture'
      setErr(msg)
    }
  }, [active, room, emit, sessionTitle, selfDisplayName])

  // Auto-PiP wiring. Chrome's auto-PiP needs ALL of:
  //   1. mediaSession 'enterpictureinpicture' handler registered.
  //   2. Page actively producing audible media (getUserMedia capture
  //      OR a media element that the browser considers "playing audio").
  //   3. User hasn't disabled the browser-level auto-PiP setting.
  //
  // If the user joined cam+mic off and isn't subscribed to anything,
  // (2) isn't satisfied and Chrome silently declines. To make auto-PiP
  // reliable in that case we run a near-silent Web Audio loop so the
  // page always looks like it's playing media. Side effect: the tab
  // gets the "audio playing" speaker icon, which honestly doubles as
  // a useful "you're in a meeting" indicator.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return
    type ActionHandler = Parameters<MediaSession['setActionHandler']>[1]
    type ExtendedAction = MediaSessionAction | 'enterpictureinpicture'
    const ms = navigator.mediaSession
    const setHandler = ms.setActionHandler.bind(ms) as
      (action: ExtendedAction, handler: ActionHandler) => void

    const prevState = ms.playbackState
    const prevMetadata = ms.metadata
    try {
      ms.playbackState = 'playing'
      if (typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({
          title: (sessionTitle ?? '').trim() || room.name || 'Live class',
          artist: 'Vaidix',
        })
      }
    } catch { /* noop — some browsers reject playbackState writes */ }

    // Silent-but-non-zero audio loop to satisfy Chrome's "playing media"
    // check. Gain is tiny (0.0001) so it's inaudible to humans but
    // Chrome's media-detection considers the page as playing audio.
    let audioCtx: AudioContext | null = null
    let osc: OscillatorNode | null = null
    let silentAudio: HTMLAudioElement | null = null
    let resumeHandler: (() => void) | null = null
    try {
      type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }
      const Ctx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
      if (Ctx) {
        audioCtx = new Ctx()
        osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        gain.gain.value = 0.0001
        const dest = audioCtx.createMediaStreamDestination()
        osc.connect(gain)
        gain.connect(dest)
        osc.start()

        silentAudio = document.createElement('audio')
        silentAudio.srcObject = dest.stream
        silentAudio.autoplay = true
        silentAudio.loop = true
        silentAudio.style.display = 'none'
        silentAudio.setAttribute('aria-hidden', 'true')
        document.body.appendChild(silentAudio)
        silentAudio.play().catch((e) => {
          console.warn('[PiP] silent audio play() blocked — waiting for user gesture', e)
        })

        // Chrome may suspend the AudioContext until a user gesture. We
        // resume on the next click/keypress; the user is already in a
        // session so this fires near-instantly in practice.
        if (audioCtx.state === 'suspended') {
          resumeHandler = () => {
            audioCtx?.resume().catch(() => { /* noop */ })
          }
          window.addEventListener('click', resumeHandler, { once: false, capture: true })
          window.addEventListener('keydown', resumeHandler, { once: false, capture: true })
        }
      }
    } catch (e) {
      console.warn('[PiP] silent-audio setup failed', e)
    }

    let registered = false
    try {
      setHandler('enterpictureinpicture', () => {
        console.info('[PiP] auto-PiP handler invoked by browser')
        if (pipWinRef.current && !pipWinRef.current.closed) return
        void toggle()
      })
      registered = true
      console.info('[PiP] auto-PiP handler registered. mediaSession.playbackState=', ms.playbackState)
    } catch (e) {
      console.warn('[PiP] enterpictureinpicture action not supported by this browser', e)
    }
    if (!registered) {
      // Belt and braces: visibilitychange won't satisfy user-activation
      // for requestWindow on its own, but log when it fires so the user
      // can confirm tab-switch is detected even if PiP can't open.
      const onVis = () => {
        if (document.hidden) console.info('[PiP] visibilitychange: tab hidden')
      }
      document.addEventListener('visibilitychange', onVis)
    }

    return () => {
      try { setHandler('enterpictureinpicture', null) } catch { /* noop */ }
      try {
        ms.playbackState = prevState
        ms.metadata = prevMetadata
      } catch { /* noop */ }
      if (resumeHandler) {
        window.removeEventListener('click', resumeHandler, { capture: true })
        window.removeEventListener('keydown', resumeHandler, { capture: true })
      }
      try { osc?.stop() } catch { /* noop */ }
      try { silentAudio?.pause() } catch { /* noop */ }
      try { silentAudio?.remove() } catch { /* noop */ }
      void audioCtx?.close().catch(() => { /* noop */ })
    }
  }, [toggle, sessionTitle, room])

  if (!supported) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        title={active ? 'Exit picture-in-picture' : 'Picture-in-picture'}
        className={cn(
          'flex items-center justify-center w-9 h-9 rounded-full border transition-all duration-150',
          active
            ? 'bg-teal-500/25 text-teal-300 border-teal-500/50'
            : 'bg-white/8 text-white/70 border-white/10 hover:bg-white/14',
        )}
      >
        <PictureInPicture className="w-4 h-4" />
      </button>
      {err && (
        <div
          role="alert"
          className="absolute bottom-full right-0 mb-2 w-56 rounded-lg bg-zinc-900/95 border border-amber-400/40 px-3 py-2 text-[11px] text-amber-100 shadow-xl backdrop-blur-md"
        >
          {err}
        </div>
      )}
    </div>
  )
}

// Builds the Document PiP window's DOM: header, video stage, control
// row (mic / speaker / return). Stylesheet is inlined because the PiP
// window inherits no styles from the parent document.
//
// Note on the video element: we *don't* reach into the LiveKit DOM and
// move its <video> node into the PiP window. That would tear down
// LiveKit's component tree the moment the PiP window closes. Instead
// we create a fresh <video> in the PiP doc and `track.attach()` the
// LiveKit track to it — LiveKit happily attaches the same track to
// multiple elements. On pagehide we `track.detach()` from our copy.
function renderRoomMiniWindow(
  pipWin: Window,
  ctx: {
    title: string
    name: string
    parent: Window
    room: Room
    videoTrack: Track | null
  },
) {
  const doc = pipWin.document
  doc.title = `${ctx.title} — picture in picture`

  const style = doc.createElement('style')
  style.textContent = `
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: #0b0b0e;
      color: #fff;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .dot {
      width: 8px; height: 8px; border-radius: 999px; background: #ef4444;
      animation: pulse 1.4s ease-in-out infinite; flex: none;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    .live { font-size: 10px; font-weight: 800; letter-spacing: 1px; color: #fca5a5; flex: none; }
    .title {
      flex: 1; min-width: 0; font-size: 12px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .stage {
      flex: 1; position: relative; background: #000;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .stage video {
      width: 100%; height: 100%; object-fit: contain; background: #000;
    }
    .stage .empty {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 16px;
    }
    .empty .label { font-size: 11px; color: rgba(255,255,255,0.55); }
    .empty .name  { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.92); }
    .controls {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.08);
    }
    button.ctrl {
      width: 36px; height: 36px; border-radius: 999px;
      background: rgba(255,255,255,0.10); color: #fff;
      border: 1px solid rgba(255,255,255,0.12);
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; transition: background 120ms;
    }
    button.ctrl:hover { background: rgba(255,255,255,0.18); }
    button.ctrl.off {
      background: rgba(239,68,68,0.22); border-color: rgba(239,68,68,0.55); color: #fecaca;
    }
    button.ctrl svg { width: 18px; height: 18px; }
    .spacer { flex: 1; }
    button.return {
      background: #10b981; color: #fff; border: none;
      padding: 0 14px; height: 36px; border-radius: 999px;
      font-size: 12px; font-weight: 700; cursor: pointer;
    }
    button.return:hover { background: #34d399; }
  `
  doc.head.appendChild(style)

  const hasVideo = Boolean(ctx.videoTrack)
  doc.body.innerHTML = `
    <div class="header">
      <span class="dot"></span>
      <span class="live">LIVE</span>
      <span class="title">${escapeHtml(ctx.title)}</span>
    </div>
    <div class="stage">
      ${hasVideo ? '' : `
        <div class="empty">
          <span class="label">Joined as</span>
          <span class="name">${escapeHtml(ctx.name)}</span>
        </div>
      `}
    </div>
    <div class="controls">
      <button class="ctrl mic" type="button" title="Toggle microphone" aria-label="Toggle microphone"></button>
      <button class="ctrl spk" type="button" title="Toggle remote audio" aria-label="Toggle remote audio"></button>
      <span class="spacer"></span>
      <button class="return" type="button">Return to room</button>
    </div>
  `

  // Mount the LiveKit video into the stage if we have one. attach()
  // on the same track to a second element is safe and supported.
  let pipVideoEl: HTMLVideoElement | null = null
  if (ctx.videoTrack) {
    pipVideoEl = doc.createElement('video')
    pipVideoEl.autoplay = true
    pipVideoEl.playsInline = true
    // Mute the PiP <video> tag — audio is already playing through the
    // parent page's audio elements. Without this we'd double the audio.
    pipVideoEl.muted = true
    ctx.videoTrack.attach(pipVideoEl)
    doc.querySelector('.stage')?.appendChild(pipVideoEl)
  }

  // ---- mic toggle ----
  const micBtn = doc.querySelector('button.mic') as HTMLButtonElement | null
  function renderMic() {
    if (!micBtn) return
    const on = ctx.room.localParticipant.isMicrophoneEnabled
    micBtn.classList.toggle('off', !on)
    micBtn.innerHTML = on ? ICON_MIC_ON : ICON_MIC_OFF
    micBtn.setAttribute('aria-pressed', String(!on))
  }
  micBtn?.addEventListener('click', async () => {
    try {
      const on = ctx.room.localParticipant.isMicrophoneEnabled
      await ctx.room.localParticipant.setMicrophoneEnabled(!on)
    } catch (e) {
      console.warn('[PiP] mic toggle failed', e)
    }
    renderMic()
  })
  renderMic()

  // ---- remote-audio (speaker) toggle ----
  // LiveKit doesn't expose a single "mute remote audio" knob, so we
  // walk every subscribed RemoteAudioTrack and setVolume(0|1). We
  // store the desired state on the window object so it survives across
  // event refreshes within the same PiP session.
  let speakerMuted = false
  const spkBtn = doc.querySelector('button.spk') as HTMLButtonElement | null
  function applySpeaker() {
    ctx.room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub) => {
        const t = pub.track
        if (t instanceof RemoteAudioTrack) t.setVolume(speakerMuted ? 0 : 1)
      })
    })
  }
  function renderSpeaker() {
    if (!spkBtn) return
    spkBtn.classList.toggle('off', speakerMuted)
    spkBtn.innerHTML = speakerMuted ? ICON_SPK_OFF : ICON_SPK_ON
    spkBtn.setAttribute('aria-pressed', String(speakerMuted))
  }
  spkBtn?.addEventListener('click', () => {
    speakerMuted = !speakerMuted
    applySpeaker()
    renderSpeaker()
  })
  renderSpeaker()

  // ---- return-to-room ----
  // window.focus() can lift the parent browser window but cannot switch
  // tabs in that window — same limitation noted in the prior version.
  doc.querySelector('button.return')?.addEventListener('click', () => {
    try { ctx.parent.focus() } catch { /* focus blocked — silent */ }
    try {
      const opener = (pipWin as Window & { opener?: Window | null }).opener
      opener?.focus()
    } catch { /* focus blocked — silent */ }
    pipWin.close()
  })

  // Cleanup when the user (or the browser, on tab-visible) closes PiP.
  // Detach our video copy so LiveKit doesn't keep rendering frames into
  // a dead element, and restore any muted remote audio so the user
  // isn't silent after returning to the room.
  pipWin.addEventListener('pagehide', () => {
    if (pipVideoEl && ctx.videoTrack) {
      try { ctx.videoTrack.detach(pipVideoEl) } catch { /* noop */ }
    }
    if (speakerMuted) {
      speakerMuted = false
      applySpeaker()
    }
  }, { once: true })
}

// Inline SVGs so we don't depend on parent stylesheets / icon fonts.
const ICON_MIC_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>`
const ICON_MIC_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 11v-1"/><path d="M5 10v1a7 7 0 0 0 12 5"/><path d="M15 9.34V4a3 3 0 0 0-5.94-.6"/><line x1="12" y1="18" x2="12" y2="22"/></svg>`
const ICON_SPK_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`
const ICON_SPK_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
