'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { Send, Paperclip, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useVideoRoomClient } from './video-room-client'

// Detects an in-progress @mention in the input. Returns the query (chars
// after @) and the index of the @ in the value, or null if the cursor
// isn't sitting on an open @-token. The token is "open" if @ is at the
// start or follows whitespace, and the chars after it are word-chars only.
function detectMention(value: string, cursor: number): { query: string; anchor: number } | null {
  const before = value.slice(0, cursor)
  const match = before.match(/(?:^|\s)@(\w*)$/)
  if (!match) return null
  const anchor = before.length - match[1].length - 1
  return { query: match[1], anchor }
}

// Mentions are stored as `@Word_Word` tokens in message text — we collapse
// whitespace in the participant's display name to keep the token a single
// /\w+/ run. This keeps both the picker insertion and the message renderer
// simple (regex split on /(@\w+)/).
function mentionToken(name: string): string {
  return `@${name.trim().replace(/\s+/g, '_')}`
}

// Renders message content with @mentions highlighted. Splits on /(@\w+)/
// and wraps each match in a styled span; everything else stays as plain
// text so search / copy-paste still works as expected.
function renderMessageContent(content: string): React.ReactNode {
  const parts = content.split(/(@\w+)/g)
  return parts.map((part, i) =>
    part.startsWith('@') && part.length > 1 ? (
      <span
        key={i}
        className="rounded bg-teal-500/15 px-1 py-0.5 text-teal-600 dark:text-teal-300 font-medium"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

interface ChatAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  downloadUrl: string
}

interface ChatMessage {
  id: string
  userId: string
  userName: string
  content: string
  createdAt: string
  attachment: ChatAttachment | null
}

const MAX_FILE_BYTES = 50 * 1024 * 1024 // matches the API cap; client-side
                                        // mirror so the upload button rejects
                                        // large files before round-tripping.

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface PendingAttachment {
  fileId: string
  name: string
  mimeType: string
  sizeBytes: number
}

const DC_TOPIC = 'chat'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function ChatPanel({
  sessionId,
  currentUser,
  onNewMessages,
}: {
  sessionId: string
  currentUser: { id: string; name: string }
  /// Called with the count of truly-new messages whenever polling finds
  /// messages not previously seen. Allows InnerRoom to show a badge even
  /// when the data channel missed the delivery (e.g. during reconnect).
  onNewMessages?: (count: number) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { localParticipant } = useLocalParticipant()
  const participants = useParticipants()
  const room = useRoomContext()
  const client = useVideoRoomClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Track which IDs we've already shown so the poll-based badge doesn't
  // fire for messages that were already in the list before onNewMessages
  // was hooked up. Stable ref — no re-render needed.
  const seenIdsRef = useRef<Set<string>>(new Set())
  const onNewMessagesRef = useRef(onNewMessages)
  useEffect(() => { onNewMessagesRef.current = onNewMessages }, [onNewMessages])

  // @mention picker state. mentionQuery === null means the picker is closed;
  // empty-string means user just typed `@` and we're showing all candidates.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionAnchor, setMentionAnchor] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    return participants
      .filter((p) => p.identity !== localParticipant.identity)
      .map((p) => ({
        identity: p.identity,
        name: ((p.name ?? '').trim() || p.identity),
      }))
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 6)
  }, [mentionQuery, participants, localParticipant.identity])

  // Clamp the highlight index whenever the suggestion list shrinks below it
  // (e.g. user kept typing and the list narrowed from 5 → 2 candidates).
  useEffect(() => {
    if (mentionIndex >= suggestions.length && suggestions.length > 0) {
      setMentionIndex(0)
    }
  }, [suggestions.length, mentionIndex])

  function handleDraftChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setDraft(value)
    const cursor = e.target.selectionStart ?? value.length
    const detected = detectMention(value, cursor)
    if (detected) {
      setMentionQuery(detected.query)
      setMentionAnchor(detected.anchor)
    } else if (mentionQuery !== null) {
      setMentionQuery(null)
    }
  }

  function insertMention(name: string) {
    const cursor = inputRef.current?.selectionStart ?? draft.length
    const before = draft.slice(0, mentionAnchor)
    const after = draft.slice(cursor)
    const inserted = `${mentionToken(name)} `
    const newDraft = `${before}${inserted}${after}`
    setDraft(newDraft)
    setMentionQuery(null)
    // Restore focus + put the cursor right after the inserted mention so
    // the user can keep typing without clicking back into the input.
    setTimeout(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const pos = before.length + inserted.length
      el.setSelectionRange(pos, pos)
    }, 0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (mentionQuery === null || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Intercept Enter so it picks the highlighted suggestion instead
      // of submitting the form.
      e.preventDefault()
      insertMention(suggestions[mentionIndex].name)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setMentionQuery(null)
    }
  }

  // Load scrollback on mount and poll every 15s as a fallback for data-channel
  // misses (e.g. during reconnects when publishData is skipped). The data
  // channel handles instant delivery; this catches anything that slips through.
  // Merge by ID so optimistic (tmp-*) and DC-arrived messages aren't overwritten
  // by the poll returning a snapshot that doesn't include the very latest items.
  useEffect(() => {
    let mounted = true
    const load = () =>
      client
        .loadChat(sessionId, 100)
        .then((msgs) => {
          if (!mounted) return
          // Count messages from OTHER users that polling sees for the first
          // time. These are the ones the data channel missed (e.g. during
          // reconnect). Own messages are never "new" from badge perspective.
          let newFromPoll = 0
          setMessages((prev) => {
            const apiMap = new Map(msgs.map((m) => [m.id, m]))
            const out: ChatMessage[] = []
            const merged = new Set<string>()
            for (const m of prev) {
              if (m.id.startsWith('tmp-')) {
                out.push(m)
                merged.add(m.id)
              } else if (apiMap.has(m.id)) {
                out.push(apiMap.get(m.id)!)
                merged.add(m.id)
              } else {
                out.push(m)
                merged.add(m.id)
              }
            }
            for (const m of msgs) {
              if (!merged.has(m.id)) {
                out.push(m)
                // Only badge on messages from others that we haven't seen yet
                if (m.userId !== currentUser.id && !seenIdsRef.current.has(m.id)) {
                  newFromPoll++
                }
              }
              seenIdsRef.current.add(m.id)
            }
            out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            return out
          })
          if (newFromPoll > 0) onNewMessagesRef.current?.(newFromPoll)
        })
        .catch(() => {})
    void load()
    const iv = setInterval(load, 15_000)
    return () => { mounted = false; clearInterval(iv) }
  }, [sessionId, client, currentUser.id])

  // Real-time data-channel receive
  const { message: lastDc } = useDataChannel(DC_TOPIC)
  useEffect(() => {
    if (!lastDc) return
    try {
      const parsed = JSON.parse(decoder.decode(lastDc.payload)) as ChatMessage
      // Ignore echoes from self (we already appended on send)
      if (parsed.userId === currentUser.id) return
      setMessages((prev) => [...prev, parsed])
    } catch {
      /* malformed, ignore */
    }
  }, [lastDc, currentUser.id])

  // Auto-scroll to bottom — runs after DOM paint so scrollHeight reflects
  // the newly rendered message row.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
  }, [messages])

  async function uploadFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setUploadError('File too large (50 MB max)')
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      // 1) Reserve via the client (LMS impl returns presigned upload URL).
      let reservation
      try {
        reservation = await client.reserveFile(sessionId, {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        })
      } catch (err) {
        setUploadError((err as Error).message || 'Upload not allowed')
        return
      }

      // 2) PUT directly to the storage backend (URL provided by reserve).
      const buf = await file.arrayBuffer()
      const putRes = await fetch(reservation.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: buf,
      })
      if (!putRes.ok) {
        setUploadError('Upload failed')
        return
      }

      // 3) Finalize — server records the FILE_SHARE replay event.
      const sha = await sha256Hex(buf)
      try {
        await client.finalizeFile(sessionId, reservation.id, sha)
      } catch (err) {
        setUploadError((err as Error).message || 'Finalise failed')
        return
      }

      setPendingAttachment({
        fileId: reservation.id,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      })
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const content = draft.trim()
    if (!content && !pendingAttachment) return
    setSending(true)
    try {
      // Optimistic append
      const optimistic: ChatMessage = {
        id: `tmp-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        content,
        createdAt: new Date().toISOString(),
        attachment: null, // attachment download URL only available post-persist
      }
      setMessages((prev) => [...prev, optimistic])
      setDraft('')

      // Persist via the room client (carries attachmentId if present).
      let persisted
      try {
        persisted = await client.sendChat(sessionId, content, pendingAttachment?.fileId)
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        return
      }

      // Replace optimistic with persisted (attachment now has downloadUrl)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id
            ? {
                id: persisted.id,
                userId: currentUser.id,
                userName: currentUser.name,
                content,
                createdAt: persisted.createdAt,
                attachment: persisted.attachment,
              }
            : m,
        ),
      )
      setPendingAttachment(null)

      // Broadcast to room — only when the engine is actually up. LiveKit logs
      // a NegotiationError ("cannot negotiate on closed engine") synchronously
      // before the publishData promise rejects, so we have to skip the call
      // entirely instead of relying on a .catch().
      if (room.state === ConnectionState.Connected) {
        try {
          await localParticipant.publishData(
            encoder.encode(
              JSON.stringify({
                id: persisted.id,
                userId: currentUser.id,
                userName: currentUser.name,
                content,
                createdAt: persisted.createdAt,
                attachment: persisted.attachment,
              }),
            ),
            { topic: DC_TOPIC, reliable: true },
          )
        } catch {
          /* late-rejection (race vs disconnect) — message already persisted */
        }
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-8">No messages yet</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="rounded-md bg-muted/40 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold">{m.userName}</span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(m.createdAt).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {m.content && <div className="text-sm">{renderMessageContent(m.content)}</div>}
            {m.attachment && (
              <AttachmentChip
                name={m.attachment.name}
                mimeType={m.attachment.mimeType}
                sizeBytes={m.attachment.sizeBytes}
                href={m.attachment.downloadUrl}
              />
            )}
          </div>
        ))}
      </div>

      {pendingAttachment && (
        <div className="px-3 pt-2 pb-1 border-t bg-muted/20">
          <div className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 truncate">
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{pendingAttachment.name}</span>
              <span className="text-muted-foreground shrink-0">
                {formatBytes(pendingAttachment.sizeBytes)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="text-muted-foreground hover:text-foreground p-0.5"
              title="Remove attachment"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      {uploadError && (
        <div className="px-3 pt-1 text-[11px] text-red-500">{uploadError}</div>
      )}

      <form onSubmit={send} className="flex gap-2 border-t p-3">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadFile(f)
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={uploading || sending || !!pendingAttachment}
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        </Button>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            placeholder={pendingAttachment ? 'Add a message (optional)…' : 'Type a message…  (@ to mention)'}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            // Slight delay so a click on a popover item registers before
            // we close the picker on blur.
            onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
            maxLength={2000}
            className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          {mentionQuery !== null && suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-1.5 z-50 overflow-hidden rounded-lg border border-border bg-popover shadow-xl shadow-black/30">
              <div className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Mention
              </div>
              <ul className="max-h-56 overflow-y-auto py-1">
                {suggestions.map((p, i) => (
                  <li key={p.identity}>
                    <button
                      type="button"
                      // onMouseDown (not onClick) — fires before the input's
                      // onBlur, so the suggestion is inserted before the
                      // popover gets dismissed.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        insertMention(p.name)
                      }}
                      onMouseEnter={() => setMentionIndex(i)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                        i === mentionIndex
                          ? 'bg-teal-500/15 text-foreground'
                          : 'text-foreground/80 hover:bg-accent',
                      )}
                    >
                      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-600 dark:text-emerald-300">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Button
          type="submit"
          size="icon"
          disabled={sending || (!draft.trim() && !pendingAttachment)}
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  )
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function AttachmentChip({
  name,
  mimeType,
  sizeBytes,
  href,
}: {
  name: string
  mimeType: string
  sizeBytes: number
  href: string
}) {
  const isImg = mimeType.startsWith('image/')
  const Icon = isImg ? ImageIcon : FileText
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'mt-1.5 flex items-center gap-2 rounded-md border bg-background/80 px-2 py-1.5 text-xs transition-colors hover:bg-background'
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate flex-1">{name}</span>
      <span className="text-muted-foreground shrink-0">{formatBytes(sizeBytes)}</span>
    </a>
  )
}
