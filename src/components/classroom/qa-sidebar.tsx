'use client'

// ════════════════════════════════════════════════════════════════════════════
// QaSidebar — Live discussion panel for the recording page.
// Pre-session content lives in the Pre-session tab (left column).
// This panel is LIVE-only: timestamped questions asked during / after watch.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart, Pin, MessageCircleReply, Send, Clock, CheckCircle2,
  Edit3, Sparkles, MessageSquare, Loader2, TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface QaItemView {
  id: string
  recordingId: string
  userId: string
  userName: string
  timestampSec: number
  question: string
  pinned: boolean
  likeCount: number
  parentId: string | null
  createdAt: string
  replies: QaItemView[]
  likedByMe: boolean
  answer: string | null
  answeredById: string | null
  answeredByName: string | null
  answeredAt: string | null
}

interface Props {
  sessionId: string
  currentUser: { id: string; role: string }
  currentTimeSec: number
  onSeek: (sec: number) => void
  canPin: boolean
  canAnswer: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTs(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ─── LIVE badge ───────────────────────────────────────────────────────────────

function LiveBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-primary ring-1 ring-primary/25">
      LIVE
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function QaSidebar({
  sessionId, currentUser, currentTimeSec, onSeek, canPin, canAnswer,
}: Props) {
  const [items, setItems] = useState<QaItemView[]>([])
  const [loading, setLoading] = useState(true)

  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [answerDraft, setAnswerDraft] = useState('')
  const [answerSubmitting, setAnswerSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/classroom/sessions/${sessionId}/qa`, { credentials: 'include' })
    const json = await res.json()
    if (json.ok) setItems(json.data.items)
    setLoading(false)
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])

  // ─── Actions ──────────────────────────────────────────────────────────────

  const post = async () => {
    const text = draft.trim()
    if (text.length < 2) return
    setPosting(true)
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ timestampSec: Math.floor(currentTimeSec), question: text }),
      })
      const json = await res.json()
      if (json.ok) { setDraft(''); await refresh() }
    } finally { setPosting(false) }
  }

  const postReply = async (parentId: string) => {
    const text = replyDraft.trim()
    if (text.length < 2) return
    const res = await fetch(`/api/classroom/sessions/${sessionId}/qa/${parentId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ question: text }),
    })
    const json = await res.json()
    if (json.ok) { setReplyDraft(''); setReplyingTo(null); await refresh() }
  }

  const toggleLike = async (item: QaItemView) => {
    const method = item.likedByMe ? 'DELETE' : 'POST'
    const res = await fetch(`/api/classroom/sessions/${sessionId}/qa/${item.id}/likes`, {
      method, credentials: 'include',
    })
    const json = await res.json()
    if (json.ok) await refresh()
  }

  const togglePin = async (item: QaItemView) => {
    if (!canPin) return
    const res = await fetch(`/api/classroom/sessions/${sessionId}/qa/${item.id}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ pinned: !item.pinned }),
    })
    const json = await res.json()
    if (json.ok) await refresh()
  }

  const startAnswering = (item: QaItemView) => {
    setAnsweringId(item.id)
    setAnswerDraft(item.answer ?? '')
  }

  const submitAnswer = async (qaId: string, clear = false) => {
    setAnswerSubmitting(true)
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/qa/${qaId}/answer`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ answer: clear ? null : answerDraft.trim() }),
      })
      const json = await res.json()
      if (json.ok) { setAnsweringId(null); setAnswerDraft(''); await refresh() }
    } finally { setAnswerSubmitting(false) }
  }

  const topLevel = items.filter((i) => !i.parentId)
  const answeredCount = topLevel.filter((q) => q.answer).length

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Gradient header ── */}
      <div className="relative shrink-0 overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-br from-primary to-[oklch(0.38_0.13_210)]" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '14px 14px' }}
        />
        <div className="relative z-10 px-4 py-3.5 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm ring-1 ring-white/30">
                <MessageSquare className="size-3.5" />
              </div>
              <div>
                <p className="text-sm font-bold leading-none">Live Discussion</p>
                <p className="mt-0.5 text-[10px] text-white/65">
                  Ask questions · Timestamped to playhead
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs font-bold ring-1 ring-white/30">
                {topLevel.length}
              </span>
              {answeredCount > 0 && (
                <span className="text-[9px] text-white/55">{answeredCount} answered</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Compose box ── */}
      <div className="shrink-0 border-b border-border/60 bg-card p-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs">
          <Clock className="size-3 text-primary" />
          <span className="font-bold text-primary">{fmtTs(currentTimeSec)}</span>
          <span className="text-muted-foreground">· posting at this timestamp</span>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask a question at this timestamp…"
          rows={2}
          className="resize-none text-sm"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void post() }}
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            onClick={post}
            disabled={posting || draft.trim().length < 2}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {posting ? <Loader2 className="mr-1.5 size-3 animate-spin" /> : <Send className="mr-1.5 size-3" />}
            Post
          </Button>
        </div>
      </div>

      {/* ── Questions list ── */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary/50" />
              <p className="text-xs">Loading…</p>
            </div>
          ) : topLevel.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-8 text-center">
              <TriangleAlert className="size-4 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No live questions yet. Ask the first one above.</p>
            </div>
          ) : (
            topLevel.map((q, idx) => (
              <LiveCard
                key={q.id}
                item={q}
                idx={idx}
                currentUser={currentUser}
                canPin={canPin}
                canAnswer={canAnswer}
                replyingTo={replyingTo}
                replyDraft={replyDraft}
                answeringId={answeringId}
                answerDraft={answerDraft}
                answerSubmitting={answerSubmitting}
                onSeek={onSeek}
                onToggleLike={toggleLike}
                onTogglePin={togglePin}
                onStartAnswering={startAnswering}
                onSubmitAnswer={submitAnswer}
                onSetReplyingTo={setReplyingTo}
                onSetReplyDraft={setReplyDraft}
                onPostReply={postReply}
                onSetAnsweringId={setAnsweringId}
                onSetAnswerDraft={setAnswerDraft}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── LIVE question card ───────────────────────────────────────────────────────

interface LiveCardProps {
  item: QaItemView
  idx: number
  currentUser: { id: string; role: string }
  canPin: boolean
  canAnswer: boolean
  replyingTo: string | null
  replyDraft: string
  answeringId: string | null
  answerDraft: string
  answerSubmitting: boolean
  onSeek: (sec: number) => void
  onToggleLike: (item: QaItemView) => void
  onTogglePin: (item: QaItemView) => void
  onStartAnswering: (item: QaItemView) => void
  onSubmitAnswer: (qaId: string, clear?: boolean) => void
  onSetReplyingTo: (id: string | null) => void
  onSetReplyDraft: (v: string) => void
  onPostReply: (parentId: string) => void
  onSetAnsweringId: (id: string | null) => void
  onSetAnswerDraft: (v: string) => void
}

function LiveCard({
  item: q, idx, currentUser, canPin, canAnswer,
  replyingTo, replyDraft, answeringId, answerDraft, answerSubmitting,
  onSeek, onToggleLike, onTogglePin, onStartAnswering, onSubmitAnswer,
  onSetReplyingTo, onSetReplyDraft, onPostReply, onSetAnsweringId, onSetAnswerDraft,
}: LiveCardProps) {
  const isAnswered = !!q.answer
  const isMine = q.userId === currentUser.id

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(idx * 0.05, 0.3), duration: 0.22, ease: 'easeOut' }}
      className={cn(
        'rounded-xl border border-l-2 bg-card p-3 shadow-sm transition-shadow hover:shadow-md',
        q.pinned
          ? 'border-primary/30 border-l-primary bg-primary/5'
          : isAnswered
          ? 'border-emerald-500/30 border-l-emerald-500 bg-emerald-500/5'
          : 'border-border/60 border-l-primary/40',
      )}
    >
      {/* Top row: badge + timestamp + pin toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <LiveBadge />
          <button
            type="button"
            onClick={() => onSeek(q.timestampSec)}
            className="text-xs font-bold text-primary transition-colors hover:underline"
          >
            {fmtTs(q.timestampSec)}
          </button>
          {q.pinned && (
            <span className="flex items-center gap-0.5 text-[10px] text-primary/70">
              <Pin className="size-3" /> Pinned
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isAnswered && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-2.5" /> Answered
            </span>
          )}
          {canPin && (
            <button
              onClick={() => onTogglePin(q)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Pin question"
            >
              <Pin className={cn('size-3', q.pinned && 'fill-current text-primary')} />
            </button>
          )}
        </div>
      </div>

      {/* Question */}
      <p className="mt-1.5 text-sm leading-relaxed">{q.question}</p>

      {/* Faculty answer */}
      {isAnswered && (
        <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              <Sparkles className="size-3" />
              {q.answeredByName ?? 'Faculty'}
            </div>
            {canAnswer && (
              <button onClick={() => onStartAnswering(q)} className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                <Edit3 className="size-3" />
              </button>
            )}
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed">{q.answer}</p>
          {q.answeredAt && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {new Date(q.answeredAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
        </div>
      )}

      {/* Action row */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">{q.userName}{isMine && ' (you)'}</span>
        <button
          type="button"
          onClick={() => onToggleLike(q)}
          className={cn('inline-flex items-center gap-1 transition-colors hover:text-foreground', q.likedByMe && 'text-rose-500')}
        >
          <Heart className={cn('size-3', q.likedByMe && 'fill-current')} />
          {q.likeCount}
        </button>
        <button
          type="button"
          onClick={() => onSetReplyingTo(replyingTo === q.id ? null : q.id)}
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <MessageCircleReply className="size-3" />
          Reply{q.replies.length > 0 && ` (${q.replies.length})`}
        </button>
        {canAnswer && !isAnswered && (
          <button
            type="button"
            onClick={() => onStartAnswering(q)}
            className="inline-flex items-center gap-1 font-semibold text-emerald-600 transition-colors hover:text-emerald-700 dark:text-emerald-400"
          >
            <CheckCircle2 className="size-3" />
            Mark answered
          </button>
        )}
      </div>

      {/* Answer composer */}
      <AnimatePresence>
        {answeringId === q.id && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
              <Textarea
                value={answerDraft}
                onChange={(e) => onSetAnswerDraft(e.target.value)}
                placeholder="Write the official answer…"
                rows={3}
                className="resize-none text-sm"
                autoFocus
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div>
                  {isAnswered && (
                    <Button size="sm" variant="ghost" className="text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10" onClick={() => onSubmitAnswer(q.id, true)} disabled={answerSubmitting}>
                      Clear
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { onSetAnsweringId(null); onSetAnswerDraft('') }} disabled={answerSubmitting}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => onSubmitAnswer(q.id)} disabled={answerSubmitting || answerDraft.trim().length < 2} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    <CheckCircle2 className="mr-1 size-3" />
                    {isAnswered ? 'Update' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reply composer */}
      {replyingTo === q.id && (
        <div className="mt-2 flex gap-2">
          <Input
            value={replyDraft}
            onChange={(e) => onSetReplyDraft(e.target.value)}
            placeholder="Write a reply…"
            className="h-8 text-xs"
            onKeyDown={(e) => e.key === 'Enter' && void onPostReply(q.id)}
          />
          <Button size="sm" onClick={() => onPostReply(q.id)} disabled={replyDraft.trim().length < 2}>
            Send
          </Button>
        </div>
      )}

      {/* Replies */}
      {q.replies.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-border/40 pl-3">
          {q.replies.map((r) => (
            <li key={r.id} className="text-xs">
              <span className="font-semibold text-foreground">{r.userName}: </span>
              <span className="text-muted-foreground">{r.question}</span>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  )
}
