'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowUp, AlertCircle, Send, Sparkles, Loader2, MessageCircleQuestion,
  Flame, Minus, CornerDownRight, ShieldCheck, X, Mic, Square, Paperclip,
  FileAudio, File as FileIcon, Download,
} from 'lucide-react'

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const sec = Math.max(1, Math.floor(diffMs / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Attachment metadata is embedded as a JSON prefix in the content field so
// no schema migration is needed. Format: first line = JSON {"_a":{...}}, rest = text.
interface AttachMeta { id: string; n: string; t: string }

function encodeAttach(id: string, name: string, type: string, text: string): string {
  const prefix = JSON.stringify({ _a: { id, n: name, t: type } })
  return text ? `${prefix}\n${text}` : prefix
}

function decodeContent(content: string): { attach: AttachMeta | null; text: string } {
  const nl = content.indexOf('\n')
  const firstLine = nl === -1 ? content : content.slice(0, nl)
  try {
    const parsed = JSON.parse(firstLine) as { _a?: AttachMeta }
    if (parsed._a?.id) {
      return { attach: parsed._a, text: nl === -1 ? '' : content.slice(nl + 1) }
    }
  } catch { /* not an attachment prefix */ }
  return { attach: null, text: content }
}

type Urgency = 'LOW' | 'NORMAL' | 'HIGH'

interface PreQuestionReplyView {
  id: string
  userId: string
  authorName: string
  content: string
  isPresenter: boolean
  createdAt: string
}

interface PreQuestionView {
  id: string
  userId: string
  authorName: string
  content: string
  urgency: Urgency
  voteCount: number
  votedByMe: boolean
  themeLabel: string | null
  isPresenter: boolean
  createdAt: string
  replies: PreQuestionReplyView[]
}

interface ThemeView {
  id: string
  label: string
  summary: string
  questionCount: number
  rank: number
  generatedAt: string
}

interface Props {
  sessionId: string
  currentUserId: string
}

interface PendingAttach {
  id: string
  name: string
  type: string
  sizeBytes: number
}

const URGENCY_CONFIG: Record<Urgency, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string; activeCls: string }> = {
  LOW:    { label: 'Low',    icon: Minus,  cls: 'border-border/60 text-muted-foreground hover:border-border', activeCls: 'border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  NORMAL: { label: 'Normal', icon: Send,   cls: 'border-border/60 text-muted-foreground hover:border-border', activeCls: 'border-primary bg-primary/10 text-primary' },
  HIGH:   { label: 'Urgent', icon: Flame,  cls: 'border-border/60 text-muted-foreground hover:border-border', activeCls: 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400' },
}

interface DoubtPromptView {
  id: string
  text: string
}

export function PreQuestionsBoard({ sessionId, currentUserId }: Props) {
  const [items, setItems] = useState<PreQuestionView[]>([])
  const [themes, setThemes] = useState<ThemeView[]>([])
  const [doubtPrompts, setDoubtPrompts] = useState<DoubtPromptView[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('NORMAL')
  const [posting, setPosting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [votingId, setVotingId] = useState<string | null>(null)
  const [replyOpenFor, setReplyOpenFor] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyPosting, setReplyPosting] = useState(false)
  const [replyErrorMsg, setReplyErrorMsg] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Attachment state — main compose form
  const [pendingAttachMain, setPendingAttachMain] = useState<PendingAttach | null>(null)
  const [uploadingMain, setUploadingMain] = useState(false)
  const [uploadErrMain, setUploadErrMain] = useState<string | null>(null)
  const fileInputMainRef = useRef<HTMLInputElement>(null)

  // Attachment state — reply form
  const [pendingAttachReply, setPendingAttachReply] = useState<PendingAttach | null>(null)
  const [uploadingReply, setUploadingReply] = useState(false)
  const [uploadErrReply, setUploadErrReply] = useState<string | null>(null)
  const fileInputReplyRef = useRef<HTMLInputElement>(null)

  // Voice recorder (shared — only one recording at a time)
  const [recording, setRecording] = useState(false)
  const [recordTarget, setRecordTarget] = useState<'main' | 'reply'>('main')
  const [recordSec, setRecordSec] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    const [qRes, tRes, sRes] = await Promise.all([
      fetch(`/api/classroom/sessions/${sessionId}/pre-questions`, { credentials: 'include' }),
      fetch(`/api/classroom/sessions/${sessionId}/pre-questions/themes`, { credentials: 'include' }),
      fetch(`/api/classroom/sessions/${sessionId}`, { credentials: 'include' }),
    ])
    const qJson = await qRes.json()
    const tJson = await tRes.json()
    if (qJson.ok) setItems(qJson.data.items)
    if (tJson.ok) setThemes(tJson.data.items)
    if (sRes.ok) {
      try {
        const sJson = await sRes.json()
        const meta = (sJson?.data?.session?.metadata ?? {}) as Record<string, unknown>
        const dps = Array.isArray(meta.doubtPrompts) ? (meta.doubtPrompts as DoubtPromptView[]) : []
        setDoubtPrompts(dps)
      } catch { /* non-critical */ }
    }
    setLoading(false)
  }, [sessionId])

  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const getCsrf = () => decodeURIComponent(document.cookie.match(/vaidix-csrf=([^;]+)/)?.[1] ?? '')

  async function uploadFile(file: File, target: 'main' | 'reply') {
    if (file.size > 50 * 1024 * 1024) {
      if (target === 'main') setUploadErrMain('File too large (50 MB max)')
      else setUploadErrReply('File too large (50 MB max)')
      return
    }
    if (target === 'main') { setUploadingMain(true); setUploadErrMain(null) }
    else { setUploadingReply(true); setUploadErrReply(null) }
    try {
      const presignRes = await fetch(`/api/classroom/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
        credentials: 'include',
        body: JSON.stringify({ name: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size }),
      })
      const presignJson = await presignRes.json()
      if (!presignJson.ok) throw new Error(presignJson.error?.message ?? 'Reserve failed')

      const { file: { id: fileId }, uploadUrl } = presignJson
      const buf = await file.arrayBuffer()
      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: buf })
      if (!putRes.ok) throw new Error('Upload failed')

      const sha = await sha256Hex(buf)
      const finalRes = await fetch(`/api/classroom/sessions/${sessionId}/files/${fileId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
        credentials: 'include',
        body: JSON.stringify({ sha256: sha }),
      })
      const finalJson = await finalRes.json()
      if (!finalJson.ok) throw new Error(finalJson.error?.message ?? 'Finalise failed')

      const attach: PendingAttach = { id: fileId, name: file.name, type: file.type || 'application/octet-stream', sizeBytes: file.size }
      if (target === 'main') setPendingAttachMain(attach)
      else setPendingAttachReply(attach)
    } catch (err) {
      const msg = (err as Error).message ?? 'Upload failed'
      if (target === 'main') setUploadErrMain(msg)
      else setUploadErrReply(msg)
    } finally {
      if (target === 'main') setUploadingMain(false)
      else setUploadingReply(false)
      if (target === 'main' && fileInputMainRef.current) fileInputMainRef.current.value = ''
      if (target === 'reply' && fileInputReplyRef.current) fileInputReplyRef.current.value = ''
    }
  }

  async function startRecording(target: 'main' | 'reply') {
    if (recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType })
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (timerRef.current) window.clearInterval(timerRef.current)
        const blob = new Blob(chunksRef.current, { type: mimeType.split(';')[0] })
        const ext = mimeType.includes('ogg') ? '.ogg' : '.webm'
        const file = new File([blob], `voice-note${ext}`, { type: blob.type })
        void uploadFile(file, target)
        setRecording(false)
        setRecordSec(0)
      }
      recorderRef.current = rec
      setRecordTarget(target)
      setRecording(true)
      setRecordSec(0)
      rec.start()
      timerRef.current = window.setInterval(() => setRecordSec((s) => s + 1), 1000)
    } catch {
      if (target === 'main') setUploadErrMain('Microphone access denied')
      else setUploadErrReply('Microphone access denied')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
  }

  const submit = async () => {
    const textPart = draft.trim()
    if (!textPart && !pendingAttachMain) { setErrorMsg('Write a question or attach a file'); return }
    if (textPart && textPart.length < 5) { setErrorMsg('At least 5 characters needed'); return }
    const content = pendingAttachMain
      ? encodeAttach(pendingAttachMain.id, pendingAttachMain.name, pendingAttachMain.type, textPart)
      : textPart
    setPosting(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/pre-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
        credentials: 'include',
        body: JSON.stringify({ content, urgency }),
      })
      const json = await res.json()
      if (!json.ok) { setErrorMsg(json.error?.message ?? 'Failed to submit'); return }
      setDraft('')
      setUrgency('NORMAL')
      setPendingAttachMain(null)
      await refresh()
    } finally {
      setPosting(false)
    }
  }

  const toggleVote = async (q: PreQuestionView) => {
    setVotingId(q.id)
    setItems(prev => prev.map(item => item.id === q.id
      ? { ...item, votedByMe: !item.votedByMe, voteCount: item.votedByMe ? item.voteCount - 1 : item.voteCount + 1 }
      : item
    ))
    try {
      await fetch(`/api/classroom/sessions/${sessionId}/pre-questions/${q.id}/vote`, {
        method: q.votedByMe ? 'DELETE' : 'POST',
        headers: { 'x-csrf-token': getCsrf() },
        credentials: 'include',
      })
    } finally {
      setVotingId(null)
      await refresh()
    }
  }

  const openReplyFor = (parentId: string) => {
    setReplyOpenFor(parentId)
    setReplyDraft('')
    setReplyErrorMsg(null)
    setPendingAttachReply(null)
    setUploadErrReply(null)
  }

  const cancelReply = () => {
    setReplyOpenFor(null)
    setReplyDraft('')
    setReplyErrorMsg(null)
    setPendingAttachReply(null)
  }

  const submitReply = async (parentId: string) => {
    const textPart = replyDraft.trim()
    if (!textPart && !pendingAttachReply) { setReplyErrorMsg('Write a reply or attach a file'); return }
    if (textPart && textPart.length < 2) { setReplyErrorMsg('Reply too short'); return }
    const content = pendingAttachReply
      ? encodeAttach(pendingAttachReply.id, pendingAttachReply.name, pendingAttachReply.type, textPart)
      : textPart
    setReplyPosting(true)
    setReplyErrorMsg(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/pre-questions/${parentId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
        credentials: 'include',
        body: JSON.stringify({ content }),
      })
      const json = await res.json()
      if (!json.ok) { setReplyErrorMsg(json.error?.message ?? 'Failed to reply'); return }
      cancelReply()
      await refresh()
    } finally {
      setReplyPosting(false)
    }
  }

  const canSubmit = (!draft.trim() && !pendingAttachMain) ? false : (!posting && !uploadingMain && !recording)
  const canSubmitReply = (!replyDraft.trim() && !pendingAttachReply) ? false : (!replyPosting && !uploadingReply && !recording)

  const hasThemes = themes.length > 0

  return (
    <div className={hasThemes ? 'grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]' : 'space-y-5'}>
      <div className="space-y-5">

        {/* Hidden file inputs */}
        <input ref={fileInputMainRef} type="file" className="hidden"
          accept="image/*,application/pdf,application/vnd.openxmlformats-officedocument.*,application/msword,text/plain,text/csv,audio/webm,audio/ogg"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f, 'main') }} />
        <input ref={fileInputReplyRef} type="file" className="hidden"
          accept="image/*,application/pdf,application/vnd.openxmlformats-officedocument.*,application/msword,text/plain,text/csv,audio/webm,audio/ogg"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f, 'reply') }} />

        {/* Compose */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-2xl border border-border/60 bg-card">
          <div className="flex items-center gap-3 border-b border-border/40 px-5 py-3.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <MessageCircleQuestion className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-[13px] font-bold">Ask before the session</p>
              <p className="text-[11px] text-muted-foreground">Questions are visible to all — presenter sees them ranked by votes</p>
            </div>
          </div>

          <div className="p-4 space-y-3">
            {doubtPrompts.length > 0 && (
              <div data-testid="doubt-prompts" className="rounded-xl border border-violet-200/60 bg-violet-50/40 px-3 py-2.5 dark:border-violet-800/30 dark:bg-violet-900/10">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-700 dark:text-violet-300">
                  <Sparkles className="size-3" /> Presenter is asking
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {doubtPrompts.map(p => (
                    <button key={p.id} onClick={() => { setDraft(p.text); textareaRef.current?.focus() }}
                      title="Use this as a starter"
                      className="rounded-full border border-violet-200/70 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-800 transition hover:bg-violet-100 dark:border-violet-700/40 dark:bg-card dark:text-violet-200">
                      {p.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit() }}
              placeholder="What would you like the presenter to address?"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-border/60 bg-background/80 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition dark:bg-card/60"
            />

            {/* Pending attachment preview */}
            {pendingAttachMain && (
              <AttachPreview attach={pendingAttachMain} onRemove={() => setPendingAttachMain(null)} />
            )}
            {uploadErrMain && (
              <p className="flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />{uploadErrMain}
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              {/* Urgency chips */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground mr-1">Priority:</span>
                {(Object.keys(URGENCY_CONFIG) as Urgency[]).map(u => {
                  const cfg = URGENCY_CONFIG[u]
                  const Icon = cfg.icon
                  const active = urgency === u
                  return (
                    <button key={u} onClick={() => setUrgency(u)}
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all ${active ? cfg.activeCls : cfg.cls}`}>
                      <Icon className="size-3" />
                      {cfg.label}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Voice note button */}
                {recording && recordTarget === 'main' ? (
                  <button type="button" onClick={stopRecording}
                    className="flex items-center gap-1 rounded-full bg-rose-500 px-2.5 py-1.5 text-[11px] font-semibold text-white animate-pulse">
                    <Square className="size-3 fill-current" />{recordSec}s
                  </button>
                ) : (
                  <button type="button" disabled={uploadingMain || !!pendingAttachMain || recording}
                    onClick={() => void startRecording('main')}
                    title="Record voice note"
                    className="flex items-center justify-center size-8 rounded-full border border-border/60 text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-40">
                    {uploadingMain && recordTarget !== 'main' ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
                  </button>
                )}
                {/* File attach button */}
                <button type="button" disabled={uploadingMain || !!pendingAttachMain || recording}
                  onClick={() => fileInputMainRef.current?.click()}
                  title="Attach file"
                  className="flex items-center justify-center size-8 rounded-full border border-border/60 text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-40">
                  {uploadingMain ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                </button>
                <span className="text-[10px] text-muted-foreground">{draft.length}/500</span>
                <button onClick={() => void submit()} disabled={!canSubmit}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-[12px] font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
                  {posting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                  {posting ? 'Posting…' : 'Submit'}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {errorMsg && (
                <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-1.5 text-[11px] text-destructive overflow-hidden">
                  <AlertCircle className="size-3.5 shrink-0" />{errorMsg}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Question list */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              All Questions {!loading && `(${items.length})`}
            </p>
            {items.length > 0 && (
              <p className="text-[10px] text-muted-foreground">Sorted by votes</p>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground justify-center">
              <Loader2 className="size-4 animate-spin" /> Loading questions…
            </div>
          ) : items.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 py-12 text-center">
              <MessageCircleQuestion className="size-8 text-muted-foreground/40" />
              <div>
                <p className="text-sm font-semibold text-muted-foreground">No questions yet</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground/70">Be the first to ask something</p>
              </div>
            </motion.div>
          ) : (
            <motion.ul className="space-y-2.5" variants={{ show: { transition: { staggerChildren: 0.05 } } }} initial="show" animate="show">
              {[...items].sort((a, b) => b.voteCount - a.voteCount).map((q, idx) => {
                const isOwnQuestion = q.userId === currentUserId
                const replyOpen = replyOpenFor === q.id
                const { attach: qAttach, text: qText } = decodeContent(q.content)
                return (
                  <motion.li key={q.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                    className="rounded-2xl border border-border/60 bg-card transition-all hover:border-border hover:shadow-sm">

                    {/* Question row */}
                    <div className="flex items-start gap-4 px-4 py-4">
                      {/* Vote button */}
                      <button onClick={() => void toggleVote(q)} disabled={votingId === q.id || isOwnQuestion}
                        aria-label={q.votedByMe ? 'Remove upvote' : 'Upvote'}
                        aria-pressed={q.votedByMe}
                        title={isOwnQuestion ? "You can't upvote your own question" : undefined}
                        className={`group/vote flex min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border px-2.5 py-2 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                          q.votedByMe
                            ? 'border-teal-500 bg-linear-to-b from-teal-500 to-emerald-600 text-white shadow-sm shadow-teal-900/20'
                            : 'border-border bg-muted/40 text-muted-foreground hover:-translate-y-0.5 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950/30 dark:hover:text-teal-300'
                        }`}>
                        {votingId === q.id
                          ? <Loader2 className="size-4 animate-spin" />
                          : <ArrowUp className={`size-4 transition-transform ${q.votedByMe ? '' : 'group-hover/vote:-translate-y-0.5'}`} strokeWidth={2.5} />
                        }
                        <span className="text-sm font-black tabular-nums leading-none">{q.voteCount}</span>
                      </button>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex items-center gap-2">
                          <AuthorAvatar name={q.authorName} isPresenter={q.isPresenter} />
                          <span className="text-[13px] font-semibold text-foreground">{q.authorName}</span>
                          {q.isPresenter && <PresenterBadge />}
                          <span className="text-[11px] text-muted-foreground/70">·</span>
                          <span className="text-[11px] text-muted-foreground/70">{formatRelativeTime(q.createdAt)}</span>
                          {idx === 0 && q.voteCount > 0 && (
                            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              <Flame className="size-3" /> TOP
                            </span>
                          )}
                        </div>
                        {qText && <p className="text-[15px] leading-relaxed text-foreground">{qText}</p>}
                        {qAttach && (
                          <AttachChip sessionId={sessionId} attach={qAttach} />
                        )}
                        {(q.urgency === 'HIGH' || q.themeLabel) && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            {q.urgency === 'HIGH' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                                <Flame className="size-3" /> Urgent
                              </span>
                            )}
                            {q.themeLabel && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                                <Sparkles className="size-3" />{q.themeLabel}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Reply action */}
                        <div className="mt-3 flex items-center gap-3 text-[12px]">
                          <button onClick={() => replyOpen ? cancelReply() : openReplyFor(q.id)}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition ${
                              replyOpen
                                ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`}>
                            <CornerDownRight className="size-3.5" />
                            {replyOpen ? 'Cancel' : 'Reply'}
                          </button>
                          {q.replies.length > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {q.replies.length} {q.replies.length === 1 ? 'reply' : 'replies'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Reply thread + form */}
                    <AnimatePresence initial={false}>
                      {(q.replies.length > 0 || replyOpen) && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: 'easeOut' }}
                          className="overflow-hidden border-t border-border/40 bg-muted/20"
                        >
                          <div className="px-4 py-3 pl-16 space-y-2.5">
                            {q.replies.map((r) => (
                              <ReplyItem key={r.id} reply={r} sessionId={sessionId} />
                            ))}

                            {replyOpen && (
                              <ReplyForm
                                draft={replyDraft}
                                setDraft={setReplyDraft}
                                onSubmit={() => void submitReply(q.id)}
                                onCancel={cancelReply}
                                posting={replyPosting}
                                errorMsg={replyErrorMsg}
                                canSubmit={canSubmitReply}
                                pendingAttach={pendingAttachReply}
                                uploading={uploadingReply}
                                uploadError={uploadErrReply}
                                onRemoveAttach={() => setPendingAttachReply(null)}
                                recording={recording && recordTarget === 'reply'}
                                recordSec={recordSec}
                                onStartRecord={() => void startRecording('reply')}
                                onStopRecord={stopRecording}
                                onFileClick={() => fileInputReplyRef.current?.click()}
                              />
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                )
              })}
            </motion.ul>
          )}
        </div>
      </div>

      {/* Themes sidebar */}
      {hasThemes && (
        <aside className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-violet-500" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">AI-Clustered Themes</p>
          </div>
          <div className="space-y-2">
            {themes.map((t, i) => (
              <motion.div key={t.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                className="rounded-xl border border-border/60 bg-card p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-bold leading-snug">{t.label}</p>
                  <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                    {t.questionCount}
                  </span>
                </div>
                {t.summary && <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed">{t.summary}</p>}
              </motion.div>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}

// ─── Attachment helpers ──────────────────────────────────────────────────────

function AttachPreview({ attach, onRemove }: { attach: PendingAttach; onRemove: () => void }) {
  const isAudio = attach.type.startsWith('audio/')
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[12px]">
      <span className="flex items-center gap-1.5 truncate text-foreground">
        {isAudio ? <FileAudio className="size-3.5 shrink-0 text-teal-500" /> : <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate">{attach.name}</span>
        <span className="shrink-0 text-muted-foreground">{formatBytes(attach.sizeBytes)}</span>
      </span>
      <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function AttachChip({ sessionId, attach }: { sessionId: string; attach: AttachMeta }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const isAudio = attach.t.startsWith('audio/')

  const fetchUrl = async () => {
    if (url) { window.open(url, '_blank'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/files/${attach.id}`, { credentials: 'include' })
      const json = await res.json()
      if (json.ok) {
        setUrl(json.data.file.downloadUrl)
        window.open(json.data.file.downloadUrl, '_blank')
      }
    } finally { setLoading(false) }
  }

  return (
    <button type="button" onClick={() => void fetchUrl()}
      className="mt-2 flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-1.5 text-[12px] text-foreground transition hover:border-primary/40 hover:bg-primary/5">
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : isAudio ? <FileAudio className="size-3.5 text-teal-500" /> : <FileIcon className="size-3.5 text-muted-foreground" />}
      <span className="truncate max-w-[200px]">{attach.n}</span>
      <Download className="size-3 shrink-0 text-muted-foreground ml-1" />
    </button>
  )
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

// ─── Reply subcomponents ─────────────────────────────────────────────────────

function AuthorAvatar({ name, isPresenter }: { name: string; isPresenter: boolean }) {
  const initials = name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  return (
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white ${
      isPresenter
        ? 'bg-linear-to-br from-amber-500 to-orange-600 ring-2 ring-amber-300/60 dark:ring-amber-500/30'
        : 'bg-linear-to-br from-violet-500 to-indigo-600'
    }`}>
      {initials || '?'}
    </span>
  )
}

function PresenterBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow-sm">
      <ShieldCheck className="size-3" strokeWidth={2.5} />
      Presenter
    </span>
  )
}

function ReplyItem({ reply, sessionId }: { reply: PreQuestionReplyView; sessionId: string }) {
  const { attach, text } = decodeContent(reply.content)
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
        reply.isPresenter
          ? 'border-amber-300/60 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-900/15'
          : 'border-border/50 bg-card'
      }`}
    >
      <AuthorAvatar name={reply.authorName} isPresenter={reply.isPresenter} />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold text-foreground">{reply.authorName}</span>
          {reply.isPresenter && <PresenterBadge />}
          <span className="text-[10px] text-muted-foreground/70">·</span>
          <span className="text-[10px] text-muted-foreground/70">{formatRelativeTime(reply.createdAt)}</span>
        </div>
        {text && <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap wrap-break-word">{text}</p>}
        {attach && <AttachChip sessionId={sessionId} attach={attach} />}
      </div>
    </motion.div>
  )
}

function ReplyForm({
  draft, setDraft, onSubmit, onCancel, posting, errorMsg, canSubmit,
  pendingAttach, uploading, uploadError, onRemoveAttach,
  recording, recordSec, onStartRecord, onStopRecord, onFileClick,
}: {
  draft: string
  setDraft: (s: string) => void
  onSubmit: () => void
  onCancel: () => void
  posting: boolean
  errorMsg: string | null
  canSubmit: boolean
  pendingAttach: PendingAttach | null
  uploading: boolean
  uploadError: string | null
  onRemoveAttach: () => void
  recording: boolean
  recordSec: number
  onStartRecord: () => void
  onStopRecord: () => void
  onFileClick: () => void
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-teal-300/60 bg-card p-3 shadow-sm">
      <textarea
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Write a reply… (text, voice note, or file)"
        rows={2}
        maxLength={2000}
        className="w-full resize-none rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/15 transition dark:bg-card/60"
      />

      {pendingAttach && (
        <div className="mt-2">
          <AttachPreview attach={pendingAttach} onRemove={onRemoveAttach} />
        </div>
      )}
      {uploadError && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />{uploadError}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {/* Voice record */}
          {recording ? (
            <button type="button" onClick={onStopRecord}
              className="flex items-center gap-1 rounded-full bg-rose-500 px-2 py-1 text-[10px] font-semibold text-white animate-pulse">
              <Square className="size-2.5 fill-current" />{recordSec}s
            </button>
          ) : (
            <button type="button" disabled={uploading || !!pendingAttach}
              onClick={onStartRecord} title="Record voice note"
              className="flex items-center justify-center size-6 rounded-full border border-border/50 text-muted-foreground transition hover:border-teal-400 hover:text-teal-600 disabled:opacity-40">
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
            </button>
          )}
          {/* File attach */}
          <button type="button" disabled={uploading || !!pendingAttach || recording}
            onClick={onFileClick} title="Attach file"
            className="flex items-center justify-center size-6 rounded-full border border-border/50 text-muted-foreground transition hover:border-teal-400 hover:text-teal-600 disabled:opacity-40">
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
          </button>
          <span className="text-[9px] text-muted-foreground/60">
            <kbd className="rounded border border-border/60 bg-muted px-1 py-0.5 font-mono text-[9px]">⌘↩</kbd> post
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground tabular-nums">{draft.length}/2000</span>
          <button onClick={onCancel}
            className="rounded-lg border border-border/60 bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
            aria-label="Cancel reply">
            <X className="size-3.5" />
          </button>
          <button onClick={onSubmit} disabled={!canSubmit}
            aria-label="Post reply"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
            {posting ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
            {posting ? 'Posting…' : 'Reply'}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {errorMsg && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive overflow-hidden">
            <AlertCircle className="size-3.5 shrink-0" />{errorMsg}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
