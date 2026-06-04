'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Calendar, Clock, User, AlertCircle, CheckCircle2, XCircle,
  Pencil, Trash2, ArrowLeft, Save, Loader2, Hourglass,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PreConferencePrepBlock } from './pre-conference-prep-block'

interface PendingSessionManagerProps {
  session: {
    id: string
    title: string
    description: string | null
    sessionType: string
    approvalStatus: string
    scheduledStart: string
    scheduledEnd: string
    host: { id: string; name: string; email: string }
  }
  proposer: { id: string; name: string } | null
  currentUser: { id: string; name: string; role: string }
}

function formatRange(start: string, end: string) {
  const s = new Date(start)
  const e = new Date(end)
  const sameDay = s.toDateString() === e.toDateString()
  const dateStr = s.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const startTime = s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const endTime = e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return sameDay ? `${dateStr} · ${startTime} – ${endTime}` : `${s.toLocaleString()} – ${e.toLocaleString()}`
}

export function PendingSessionManager({ session, proposer, currentUser }: PendingSessionManagerProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(session.title)
  const [description, setDescription] = useState(session.description ?? '')
  const [working, setWorking] = useState<'save' | 'cancel' | 'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)

  const isHost = currentUser.id === session.host.id
  const isProposer = proposer?.id === currentUser.id
  const isAdminOrPD = currentUser.role === 'ADMIN' || currentUser.role === 'PROGRAM_DIRECTOR'
  const canEdit = isHost || isProposer || currentUser.role === 'ADMIN'
  const canApprove = isHost
  const canCancel = isHost || isProposer || isAdminOrPD

  async function saveEdits() {
    setWorking('save')
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: description || null }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? 'Failed to save')
      setEditing(false)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWorking(null)
    }
  }

  async function cancelSession() {
    setWorking('cancel')
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${session.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by proposer' }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? 'Failed to cancel')
      router.push('/calendar')
    } catch (e) {
      setError((e as Error).message)
      setWorking(null)
    }
  }

  async function approveSession() {
    setWorking('approve')
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${session.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? 'Failed to approve')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWorking(null)
    }
  }

  async function rejectSession() {
    setWorking('reject')
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${session.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason || 'Declined by host' }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? 'Failed to reject')
      router.push('/calendar')
    } catch (e) {
      setError((e as Error).message)
      setWorking(null)
    }
  }

  const statusConfig = {
    PENDING_FACULTY: {
      label: 'Awaiting host approval',
      bg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
      icon: Hourglass,
    },
    DRAFT: {
      label: 'Draft',
      bg: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
      icon: Pencil,
    },
    REJECTED: {
      label: 'Declined',
      bg: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
      icon: XCircle,
    },
    CANCELLED: {
      label: 'Cancelled',
      bg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30',
      icon: XCircle,
    },
  } as const

  const cfg = statusConfig[session.approvalStatus as keyof typeof statusConfig] ?? statusConfig.PENDING_FACULTY
  const StatusIcon = cfg.icon

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-6">
      {/* Back link */}
      <button
        type="button"
        onClick={() => router.push('/calendar')}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" />
        Back to calendar
      </button>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      >
        {/* Status header */}
        <div className={`border-b ${cfg.bg} px-6 py-3 flex items-center gap-2`}>
          <StatusIcon className="size-4" />
          <span className="text-xs font-bold uppercase tracking-wider">{cfg.label}</span>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Title + description */}
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="rounded-xl border-2 px-3.5 py-2.5"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="rounded-xl border-2 px-3.5 py-2.5"
                  rows={3}
                  maxLength={2000}
                  placeholder="Optional — what will be covered..."
                />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={saveEdits} disabled={working === 'save' || !title.trim()}>
                  {working === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Save changes
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(false)
                    setTitle(session.title)
                    setDescription(session.description ?? '')
                  }}
                  disabled={working === 'save'}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{session.title}</h1>
              {session.description && (
                <p className="mt-2 text-sm text-muted-foreground">{session.description}</p>
              )}
              <p className="mt-2 inline-block rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                {session.sessionType.replace(/_/g, ' ')}
              </p>
            </div>
          )}

          {/* Meta */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 border-t border-border pt-4">
            <Meta icon={Calendar} label="When" value={formatRange(session.scheduledStart, session.scheduledEnd)} />
            <Meta icon={User} label="Host" value={session.host.name} sub={session.host.email} />
            {proposer && (
              <Meta icon={Pencil} label="Proposed by" value={proposer.name} sub={proposer.id === currentUser.id ? 'You' : undefined} />
            )}
            <Meta icon={Clock} label="Duration" value={`${Math.round((new Date(session.scheduledEnd).getTime() - new Date(session.scheduledStart).getTime()) / 60000)} minutes`} />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Role-based notice */}
          {!editing && session.approvalStatus === 'PENDING_FACULTY' && (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              {isHost ? (
                <p className="text-sm text-foreground">
                  <strong>{proposer?.name ?? 'An HOD'}</strong> proposed you host this session.
                  Approve to publish it on attendee calendars, or decline if it doesn&apos;t work for you.
                </p>
              ) : isProposer ? (
                <p className="text-sm text-foreground">
                  Waiting for <strong>{session.host.name}</strong> to approve this session.
                  You can edit details or cancel it while it&apos;s pending.
                </p>
              ) : isAdminOrPD ? (
                <p className="text-sm text-foreground">
                  This session is awaiting <strong>{session.host.name}</strong>&apos;s approval. As {currentUser.role === 'ADMIN' ? 'an admin' : 'an HOD'}, you can edit or cancel it.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This session is pending host approval and not yet visible to attendees.
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          {!editing && session.approvalStatus === 'PENDING_FACULTY' && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {canApprove && !showRejectInput && (
                <>
                  <Button onClick={approveSession} disabled={working !== null} className="bg-emerald-600 text-white hover:bg-emerald-700">
                    {working === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    Approve & publish
                  </Button>
                  <Button variant="outline" onClick={() => setShowRejectInput(true)} disabled={working !== null}>
                    <XCircle className="size-4" />
                    Decline
                  </Button>
                </>
              )}

              {canApprove && showRejectInput && (
                <div className="w-full space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason (optional)</label>
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Schedule conflict, prefer to reschedule..."
                    className="rounded-xl border-2 px-3.5 py-2.5"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button onClick={rejectSession} disabled={working !== null} className="bg-rose-600 text-white hover:bg-rose-700">
                      {working === 'reject' ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                      Confirm decline
                    </Button>
                    <Button variant="outline" onClick={() => setShowRejectInput(false)}>Back</Button>
                  </div>
                </div>
              )}

              {canEdit && !showRejectInput && (
                <Button variant="outline" onClick={() => setEditing(true)} disabled={working !== null}>
                  <Pencil className="size-4" />
                  Edit details
                </Button>
              )}

              {canCancel && !showRejectInput && (
                confirmCancel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Cancel this session?</span>
                    <Button onClick={cancelSession} disabled={working !== null} className="bg-rose-600 text-white hover:bg-rose-700">
                      {working === 'cancel' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      Yes, cancel
                    </Button>
                    <Button variant="outline" onClick={() => setConfirmCancel(false)}>Keep</Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={working !== null} className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10">
                    <Trash2 className="size-4" />
                    Cancel session
                  </Button>
                )
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* W6.8 — Pre-Conference Prep panels (host / faculty / PD only) */}
      {(isHost || isAdminOrPD || currentUser.role === 'FACULTY') && (
        <PreConferencePrepBlock sessionId={session.id} canCurate={isHost || isAdminOrPD} />
      )}
    </div>
  )
}

function Meta({
  icon: Icon, label, value, sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="size-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  )
}
