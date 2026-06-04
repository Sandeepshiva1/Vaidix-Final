'use client'

// WhiteboardPanel — tldraw-backed shared canvas for the live session.
//
// Architecture:
//   • The host edits; participants watch (or co-edit when the host has
//     enabled `editableByResidents`).
//   • Local edits debounce-save (~3s of idle) to /whiteboard, which writes
//     a WhiteboardSnapshot row with a server-assigned tMs offset.
//   • The same snapshot fan-outs over the LiveKit data channel (topic
//     'whiteboard') so other participants reload their tldraw store on
//     arrival. Snapshots are small enough (~tens of KB for typical class
//     diagrams) to broadcast wholesale; the infra cost wasn't worth a CRDT.
//   • Late joiners GET /whiteboard once on mount to hydrate.
//
// tldraw v5 ships ~1.5MB of bundle. We dynamic-import it inside the panel so
// the cost is only paid by users who actually open the whiteboard tab.

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useDataChannel, useLocalParticipant, useRoomContext } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Lock, Unlock, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
// TODO(extraction): replace direct /whiteboard fetches with VideoRoomClient.
// Deferred — the LMS endpoint also carries an `editableByResidents` flag
// that needs a small interface extension to remain product-agnostic.

// Dynamic import — tldraw is heavy and only relevant when this tab is open.
const TldrawSurface = lazy(() => import('./whiteboard-surface'))

const DC_TOPIC = 'whiteboard'
const SAVE_DEBOUNCE_MS = 3000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Wire format for the data-channel broadcast. The recipient sees `kind:
// 'snapshot'` and reloads the tldraw store. We tag with `version` so a
// stale broadcast (e.g. delayed by a slow link) can be ignored if a newer
// snapshot already arrived.
interface WhiteboardWireMessage {
  kind: 'snapshot'
  version: number
  authorId: string
  /// tldraw store snapshot — opaque payload.
  snapshot: unknown
}

interface SurfaceHandle {
  getSnapshot: () => unknown
  loadSnapshot: (snapshot: unknown) => void
}

export function WhiteboardPanel({
  sessionId,
  isHostish,
  fullscreen,
  onFullscreenChange,
}: {
  sessionId: string
  isHostish: boolean
  /// Lifted to LiveRoom (above LiveKitRoom key={bumper}) so fullscreen
  /// survives reconnect remounts. Do NOT move back to local state.
  fullscreen: boolean
  onFullscreenChange: (v: boolean) => void
}) {
  const { localParticipant } = useLocalParticipant()
  const room = useRoomContext()
  const { message: lastDc } = useDataChannel(DC_TOPIC)

  const [editableByResidents, setEditableByResidents] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>(
    'idle'
  )
  const surfaceRef = useRef<SurfaceHandle | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const versionRef = useRef(0)
  const hydratingRef = useRef(false)

  const canEdit = isHostish || editableByResidents

  // Initial hydrate — fetch latest snapshot once tldraw mounts.
  const onSurfaceMount = useCallback((handle: SurfaceHandle) => {
    surfaceRef.current = handle
    hydratingRef.current = true
    fetch(`/api/classroom/sessions/${sessionId}/whiteboard`, { credentials: 'include' })
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return
        setEditableByResidents(json.data.whiteboard?.editableByResidents ?? false)
        if (json.data.snapshot) handle.loadSnapshot(json.data.snapshot)
      })
      .catch(() => {/* fresh canvas */})
      .finally(() => {
        hydratingRef.current = false
        setHydrated(true)
      })
  }, [sessionId])

  // Apply incoming snapshots from peers.
  useEffect(() => {
    if (!lastDc) return
    if (!surfaceRef.current) return
    try {
      const msg = JSON.parse(decoder.decode(lastDc.payload)) as WhiteboardWireMessage
      if (msg.kind !== 'snapshot') return
      // Ignore our own echoes.
      if (msg.authorId === localParticipant.identity) return
      // Stale-arrival guard.
      if (msg.version <= versionRef.current) return
      versionRef.current = msg.version
      hydratingRef.current = true
      surfaceRef.current.loadSnapshot(msg.snapshot)
      // Allow the loadSnapshot-triggered onChange to settle before we trust
      // local edits again. Single-frame delay is enough.
      requestAnimationFrame(() => {
        hydratingRef.current = false
      })
    } catch {
      /* malformed broadcast, ignore */
    }
  }, [lastDc, localParticipant.identity])

  // Persist + broadcast on local edit.
  const onLocalChange = useCallback(() => {
    if (hydratingRef.current) return // avoid re-emitting an inbound snapshot
    if (!canEdit) return
    setSaveStatus('pending')
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      const snapshot = surfaceRef.current?.getSnapshot()
      if (!snapshot) return
      versionRef.current += 1
      const version = versionRef.current
      setSaveStatus('saving')
      // Fire-and-forget broadcast first so peers see the update without
      // waiting on the persistence round-trip. Skipped entirely when the
      // engine is closed/reconnecting — LiveKit logs a NegotiationError
      // synchronously before publishData rejects, so .catch() doesn't help.
      if (room.state === ConnectionState.Connected) {
        void localParticipant
          .publishData(
            encoder.encode(
              JSON.stringify({
                kind: 'snapshot',
                version,
                authorId: localParticipant.identity,
                snapshot,
              } satisfies WhiteboardWireMessage)
            ),
            { topic: DC_TOPIC, reliable: true }
          )
          .catch(() => {/* late-rejection — persistence still attempts below */})
      }
      try {
        const res = await fetch(`/api/classroom/sessions/${sessionId}/whiteboard`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshot }),
        })
        const json = await res.json()
        if (json.ok) {
          setSaveStatus('saved')
        } else {
          setSaveStatus('error')
        }
      } catch {
        setSaveStatus('error')
      }
    }, SAVE_DEBOUNCE_MS)
  }, [canEdit, localParticipant, sessionId, room])

  // Toggle editableByResidents (host-only). Sends a no-op snapshot save
  // alongside the toggle so the round-trip looks atomic to the user.
  async function toggleEditable() {
    if (!isHostish || !surfaceRef.current) return
    const snapshot = surfaceRef.current.getSnapshot()
    setSaveStatus('saving')
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/whiteboard`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot,
          editableByResidents: !editableByResidents,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setEditableByResidents(json.data.whiteboard.editableByResidents)
        setSaveStatus('saved')
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    }
  }

  // The canvas + chrome is identical in sidebar and fullscreen modes — we
  // just render it inside two different shells. Extracting it lets the modal
  // mount the SAME tldraw editor instance (the surfaceRef is shared) so we
  // don't pay a re-hydrate cost when toggling fullscreen.
  const body = (
    <>
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2 shrink-0">
        <span className="flex-1 text-xs font-semibold text-white/65">Whiteboard</span>
        {isHostish && (
          <button
            type="button"
            onClick={toggleEditable}
            disabled={!hydrated}
            title={
              editableByResidents
                ? 'Lock to host edits only'
                : 'Allow residents to draw'
            }
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-white/65 hover:bg-white/8"
          >
            {editableByResidents ? (
              <>
                <Unlock className="w-3 h-3" /> Open
              </>
            ) : (
              <>
                <Lock className="w-3 h-3" /> Locked
              </>
            )}
          </button>
        )}
        <SaveBadge status={saveStatus} />
        <button
          type="button"
          onClick={() => onFullscreenChange(!fullscreen)}
          title={fullscreen ? 'Exit fullscreen' : 'Open in fullscreen'}
          className="flex items-center justify-center w-7 h-7 rounded-md text-white/55 hover:text-white/90 hover:bg-white/8"
        >
          {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className={cn('flex-1 min-h-0 relative bg-zinc-900', !canEdit && 'pointer-events-none')}>
        <Suspense fallback={<LoadingShim />}>
          <TldrawSurface
            ref={surfaceRef as never}
            onMount={onSurfaceMount}
            onChange={onLocalChange}
            readOnly={!canEdit}
          />
        </Suspense>
        {!canEdit && (
          <div className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-white/80 backdrop-blur-md">
            View only — host has the floor
          </div>
        )}
      </div>
    </>
  )

  // Sidebar mode: the regular flex column inside the right-hand panel.
  // Fullscreen mode: a portal-style overlay covering the live-session shell.
  // Note: we render the sidebar version with a ghost placeholder when
  // fullscreen is active so the user has a clear "press to return" affordance.
  return (
    <>
      <div className={cn('flex h-full flex-col', fullscreen && 'pointer-events-none opacity-30')}>
        {fullscreen ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-white/45">
            <Maximize2 className="w-5 h-5" />
            <span className="text-[11px]">Whiteboard is in fullscreen</span>
          </div>
        ) : (
          body
        )}
      </div>

      <AnimatePresence>
        {fullscreen && (
          <motion.div
            key="wb-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-80 flex items-stretch bg-zinc-950/95 backdrop-blur-2xl"
          >
            <motion.div
              initial={{ scale: 0.97 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.97 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="m-4 flex w-full flex-col overflow-hidden rounded-2xl border border-white/8 bg-zinc-900 shadow-2xl shadow-black/80"
            >
              {body}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function LoadingShim() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-white/60 text-xs gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading whiteboard…
    </div>
  )
}

function SaveBadge({
  status,
}: {
  status: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
}) {
  if (status === 'idle') return null
  const map = {
    pending: { text: 'Editing…', cls: 'text-white/40', spin: false },
    saving: { text: 'Saving…', cls: 'text-white/65', spin: true },
    saved: { text: 'Saved', cls: 'text-teal-300', spin: false },
    error: { text: 'Save failed', cls: 'text-red-400', spin: false },
  } as const
  const e = map[status]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px]', e.cls)}>
      {e.spin && <Loader2 className="w-3 h-3 animate-spin" />}
      {e.text}
    </span>
  )
}

// re-export for next/dynamic-style consumers; not strictly needed but keeps
// the import surface clean for the wiring side.
export type { SurfaceHandle }
