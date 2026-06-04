'use client'

// SharedNotesPanel.
//
// One textarea per session. Edits are auto-saved every 1.5s of idle (debounced)
// to /api/.../notes with the version we last fetched. On version conflict
// (someone else saved first) we rebase on the server's content and surface a
// non-blocking toast — last-writer-wins is fine for a classroom note where
// editors usually take turns.
//
// The recording-viewer reads the SharedNoteEdit log to scrub through how the
// note evolved. Here we only show the latest snapshot for live editors.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, NotebookPen, Lock, Unlock, Check, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NoteState {
  id: string
  content: string
  version: number
  editableByResidents: boolean
}

const SAVE_DEBOUNCE_MS = 1500

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'conflict' | 'forbidden' | 'error'

export function SharedNotesPanel({
  sessionId,
  isHostish,
}: {
  sessionId: string
  isHostish: boolean
}) {
  const [note, setNote] = useState<NoteState | null>(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const saveTimerRef = useRef<number | null>(null)
  const inFlightRef = useRef<AbortController | null>(null)

  // Initial load.
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/classroom/sessions/${sessionId}/notes`, {
      credentials: 'include',
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return
        setNote({
          id: json.data.note.id,
          content: json.data.note.content,
          version: json.data.note.version,
          editableByResidents: json.data.note.editableByResidents,
        })
        setDraft(json.data.note.content)
      })
      .catch(() => {/* component unmounted or fetch aborted */})
    return () => ctrl.abort()
  }, [sessionId])

  const canEdit = isHostish || (note?.editableByResidents ?? false)

  const flush = useCallback(async () => {
    if (!note) return
    if (draft === note.content) {
      setStatus('saved')
      return
    }
    inFlightRef.current?.abort()
    const ctrl = new AbortController()
    inFlightRef.current = ctrl
    setStatus('saving')
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          content: draft,
          expectedVersion: note.version,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setNote({
          id: json.data.note.id,
          content: json.data.note.content,
          version: json.data.note.version,
          editableByResidents: json.data.note.editableByResidents,
        })
        setStatus('saved')
        return
      }
      if (json.error?.code === 'VERSION_CONFLICT') {
        setStatus('conflict')
        // Rebase: replace draft with server content. The user's unsaved
        // characters are lost, which is the cost of last-writer-wins. We
        // could merge with diff3 but that's overkill for a single textarea.
        setNote((prev) =>
          prev
            ? {
                ...prev,
                content: json.error.details.currentContent,
                version: json.error.details.currentVersion,
              }
            : prev
        )
        setDraft(json.error.details.currentContent)
        return
      }
      if (json.error?.code === 'FORBIDDEN') {
        setStatus('forbidden')
        return
      }
      setStatus('error')
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setStatus('error')
      }
    }
  }, [draft, note, sessionId])

  // Debounced auto-save. Status flips to 'pending' inside the textarea
  // onChange handler, not here, so this effect only schedules the flush —
  // keeping the effect free of cascading setStates.
  useEffect(() => {
    if (!note) return
    if (draft === note.content) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void flush()
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [draft, note, flush])

  async function toggleEditableByResidents() {
    if (!note || !isHostish) return
    setStatus('saving')
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/notes`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draft,
          expectedVersion: note.version,
          editableByResidents: !note.editableByResidents,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setStatus('error')
        return
      }
      setNote({
        id: json.data.note.id,
        content: json.data.note.content,
        version: json.data.note.version,
        editableByResidents: json.data.note.editableByResidents,
      })
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2.5 shrink-0">
        <NotebookPen className="w-3.5 h-3.5 text-white/60" />
        <span className="flex-1 text-xs font-semibold text-white/65">Shared notes</span>
        {isHostish && (
          <button
            type="button"
            onClick={toggleEditableByResidents}
            disabled={!note}
            title={
              note?.editableByResidents
                ? 'Lock to host edits only'
                : 'Allow residents to edit'
            }
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-white/65 hover:bg-white/8"
          >
            {note?.editableByResidents ? (
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
        <SaveBadge status={status} />
      </div>

      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          // 'pending' is shown only while the user is actively typing — the
          // auto-save effect schedules the flush; this lets the badge react
          // immediately without a setState inside the effect body.
          if (note && e.target.value !== note.content) setStatus('pending')
        }}
        readOnly={!canEdit || !note}
        placeholder={
          !note
            ? 'Loading…'
            : canEdit
              ? 'Type shared notes for the room…'
              : 'The host has the floor for notes'
        }
        className={cn(
          'flex-1 w-full bg-transparent px-3 py-3 text-sm text-white/90 placeholder:text-white/30 outline-none resize-none',
          !canEdit && 'cursor-not-allowed opacity-90'
        )}
      />

      <div className="px-3 py-2 border-t border-white/8 text-[10px] text-white/40 shrink-0">
        Notes are saved with the session and replay alongside the recording.
      </div>
    </div>
  )
}

function SaveBadge({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  const map = {
    pending: { icon: Loader2, text: 'Editing…', cls: 'text-white/40', spin: false },
    saving: { icon: Loader2, text: 'Saving…', cls: 'text-white/65', spin: true },
    saved: { icon: Check, text: 'Saved', cls: 'text-teal-300', spin: false },
    conflict: { icon: AlertCircle, text: 'Rebased', cls: 'text-amber-300', spin: false },
    forbidden: { icon: Lock, text: 'Read-only', cls: 'text-white/40', spin: false },
    error: { icon: AlertCircle, text: 'Save failed', cls: 'text-red-400', spin: false },
  } as const
  const e = map[status]
  const Icon = e.icon
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px]', e.cls)}>
      <Icon className={cn('w-3 h-3', e.spin && 'animate-spin')} />
      {e.text}
    </span>
  )
}
