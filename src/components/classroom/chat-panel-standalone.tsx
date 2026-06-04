'use client'

// ChatPanelStandalone — REST-only chat panel for the pop-out window.
//
// The pop-out doesn't sit inside a `<LiveKitRoom>` so it can't use the
// data-channel hooks the live `ChatPanel` depends on. We trade instant
// propagation for a 3s poll: new messages appear up to 3s after they were
// sent in the parent tab. That's an acceptable degradation given the
// pop-out is a "keep visible while I'm in another app" surface, not a
// primary chat target.
//
// Send + file-upload paths are identical to the live panel — both write
// through the same /chat + /files endpoints. The live tab's data channel
// will pick up the persisted message via its existing scrollback fetch on
// reconnect, so a message sent from the popout still propagates instantly
// to anyone in the room (just not via DC fan-out from the popout itself).
//
// Why duplicate UI rather than refactor `ChatPanel`?  The visual surface
// is small (~150 lines) and the two wrappers have meaningfully different
// state machines (DC echo dedupe, optimistic publish, LK identity). A
// shared sub-component would force a render-prop or a context dance that
// adds more lines than it saves. We accept the duplication and align
// behaviour through the shared API contract instead.

import { useEffect, useRef, useState } from 'react'
import { Send, Paperclip, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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

interface PendingAttachment {
  fileId: string
  name: string
  mimeType: string
  sizeBytes: number
}

const POLL_INTERVAL_MS = 3000
const MAX_FILE_BYTES = 50 * 1024 * 1024

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function ChatPanelStandalone({
  sessionId,
  currentUser,
}: {
  sessionId: string
  currentUser: { id: string; name: string }
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Poll for new messages. Server returns the most recent N messages each
  // call; we de-dupe by id so re-fetching the full window doesn't flood the
  // list with duplicates.
  useEffect(() => {
    let cancelled = false
    async function fetchMessages() {
      try {
        const res = await fetch(`/api/classroom/sessions/${sessionId}/chat?limit=100`, {
          credentials: 'include',
        })
        const json = await res.json()
        if (cancelled || !json.ok) return
        const incoming: ChatMessage[] = json.data.messages.map(
          (m: {
            id: string
            userId: string
            content: string
            createdAt: string
            user: { name: string }
            attachment: ChatAttachment | null
          }) => ({
            id: m.id,
            userId: m.userId,
            userName: m.user.name,
            content: m.content,
            createdAt: m.createdAt,
            attachment: m.attachment,
          })
        )
        setMessages(incoming)
      } catch {/* silent — next tick retries */}
    }
    void fetchMessages()
    const iv = window.setInterval(fetchMessages, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(iv)
    }
  }, [sessionId])

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function uploadFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setUploadError('File too large (50 MB max)')
      return
    }
    setUploadError(null)
    setUploading(true)
    try {
      const reserveRes = await fetch(`/api/classroom/sessions/${sessionId}/files`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      })
      const reserveJson = await reserveRes.json()
      if (!reserveJson.ok) {
        setUploadError(reserveJson.error?.message ?? 'Upload not allowed')
        return
      }
      const { file: reservation, uploadUrl } = reserveJson.data as {
        file: { id: string; name: string }
        uploadUrl: string
      }
      const buf = await file.arrayBuffer()
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: buf,
      })
      if (!putRes.ok) {
        setUploadError('Upload failed')
        return
      }
      const sha = await sha256Hex(buf)
      const finRes = await fetch(
        `/api/classroom/sessions/${sessionId}/files/${reservation.id}/finalize`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha256: sha }),
        }
      )
      const finJson = await finRes.json()
      if (!finJson.ok) {
        setUploadError(finJson.error?.message ?? 'Finalise failed')
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
      const optimistic: ChatMessage = {
        id: `tmp-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        content,
        createdAt: new Date().toISOString(),
        attachment: null,
      }
      setMessages((prev) => [...prev, optimistic])
      setDraft('')
      const res = await fetch(`/api/classroom/sessions/${sessionId}/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          attachmentId: pendingAttachment?.fileId,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        return
      }
      // Don't bother stitching server reply into the list — the next poll
      // round will fetch the persisted version with its proper id +
      // attachment download URL.
      setPendingAttachment(null)
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
            {m.content && <div className="text-sm">{m.content}</div>}
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
        <Input
          placeholder={pendingAttachment ? 'Add a message (optional)…' : 'Type a message…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
        />
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
