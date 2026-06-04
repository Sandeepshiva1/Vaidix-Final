'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Clock, Users, Repeat, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

interface PendingSession {
  id: string
  title: string
  description: string | null
  sessionType: string
  scheduledStart: string
  scheduledEnd: string
  recurrenceRule: string | null
  openToAll: boolean
  cohort: { id: string; name: string } | null
  inviteCount: number
  proposer: { id: string; name: string; email: string }
}

export function ApprovalsInbox({ sessions: initial }: { sessions: PendingSession[] }) {
  const router = useRouter()
  const [sessions, setSessions] = useState(initial)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function approve(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${id}/approve`, { method: 'POST' })
      const json = await res.json()
      if (!json.ok) {
        throw new Error(json.error?.message ?? 'Approve failed')
      }
      // Teams-style overlapping schedules are allowed; surface the conflict
      // info as a non-blocking note after approval succeeds.
      const conflicts = (json.data?.warnings?.hostConflicts ?? []) as Array<{
        title: string; scheduledStart: string
      }>
      if (conflicts.length > 0) {
        const c = conflicts[0]
        if (typeof window !== 'undefined') {
          window.alert(`Approved. Heads up: you also have "${c.title}" at ${new Date(c.scheduledStart).toLocaleString()}.`)
        }
      }
      setSessions((prev) => prev.filter((s) => s.id !== id))
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    if (rejectReason.trim().length < 3) {
      setError('Please provide a reason (at least 3 characters).')
      return
    }
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? 'Reject failed')
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setRejectingId(null)
      setRejectReason('')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center">
        <p className="text-muted-foreground">No sessions pending your approval.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {sessions.map((s) => {
        const start = new Date(s.scheduledStart)
        const end = new Date(s.scheduledEnd)
        return (
          <div key={s.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{s.title}</h2>
                  <Badge variant="secondary">{s.sessionType.replace(/_/g, ' ')}</Badge>
                  {s.recurrenceRule && (
                    <Badge variant="outline">
                      <Repeat className="size-3 mr-1" /> Recurring
                    </Badge>
                  )}
                </div>
                {s.description && (
                  <p className="text-sm text-muted-foreground">{s.description}</p>
                )}
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" />
                    {start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    {Math.round((end.getTime() - start.getTime()) / 60000)} min
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    {audienceSummary(s)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Proposed by <span className="font-medium">{s.proposer.name}</span> ({s.proposer.email})
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => approve(s.id)} disabled={busyId === s.id}>
                  <Check className="size-4 mr-1.5" /> Accept
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejectingId(s.id)}>
                  <X className="size-4 mr-1.5" /> Decline
                </Button>
              </div>
            </div>

            {rejectingId === s.id && (
              <div className="mt-4 space-y-2 border-t pt-4">
                <label className="text-sm font-medium">Reason for declining</label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Conflicts with OR schedule, out of town, etc."
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => reject(s.id)} disabled={busyId === s.id}>
                    Confirm decline
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setRejectingId(null); setRejectReason('') }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Compose the audience line shown on a pending-approval card. Mirrors the
// new orthogonal-flags model: any combination is possible, so describe each
// axis that's set rather than picking a single label.
function audienceSummary(s: PendingSession): string {
  const parts: string[] = []
  if (s.cohort) parts.push(`Cohort: ${s.cohort.name}`)
  if (s.inviteCount > 0) parts.push(`${s.inviteCount} invitee${s.inviteCount === 1 ? '' : 's'}`)
  if (s.openToAll) parts.push('Anyone with link')
  return parts.length > 0 ? parts.join(' · ') : 'Private (host only)'
}
