'use client'

import { useCallback, useEffect, useState } from 'react'
import { Users, Sparkles, Shuffle, Hand, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

type GroupingMode = 'RANDOM' | 'SELF_SELECT' | 'AI_AUTO'
type Status = 'ACTIVE' | 'ENDED'

interface BreakoutView {
  id: string
  sessionId: string
  name: string
  groupingMode: GroupingMode
  livekitRoomName: string
  status: Status
  participants: Array<{ userId: string; name: string; joinedAt: string | null; leftAt: string | null }>
  createdAt: string
  endedAt: string | null
}

interface Props {
  sessionId: string
  isFaculty: boolean
  /** Called when a participant clicks "Join" so the parent live-session can swap rooms */
  onJoin: (breakout: { id: string; name: string }) => void
  currentUserId: string
}

export function BreakoutsPanel({ sessionId, isFaculty, onJoin, currentUserId }: Props) {
  const [items, setItems] = useState<BreakoutView[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<GroupingMode>('RANDOM')
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/classroom/sessions/${sessionId}/breakouts`, { credentials: 'include' })
    const json = await res.json()
    if (json.ok) setItems(json.data.items)
    setLoading(false)
  }, [sessionId])

  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [refresh])

  const create = async () => {
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/breakouts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ groupingMode: mode, groupCount: count }),
      })
      const json = await res.json()
      if (!json.ok) {
        setErrorMsg(json.error?.message ?? 'Failed to create breakouts')
        return
      }
      setOpen(false)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const reconvene = async () => {
    setBusy(true)
    try {
      await fetch(`/api/classroom/sessions/${sessionId}/breakouts/reconvene`, {
        method: 'POST',
        credentials: 'include',
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const endOne = async (breakoutId: string) => {
    await fetch(`/api/classroom/sessions/${sessionId}/breakouts/${breakoutId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    await refresh()
  }

  const claimSeat = async (breakoutId: string) => {
    await fetch(`/api/classroom/sessions/${sessionId}/breakouts/${breakoutId}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: currentUserId }),
    })
    await refresh()
  }

  const active = items.filter((b) => b.status === 'ACTIVE')
  const myBreakout = active.find((b) => b.participants.some((p) => p.userId === currentUserId))

  return (
    <div className="flex h-full flex-col gap-3 border-l bg-background p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Breakouts</h3>
        {isFaculty ? (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => setOpen(true)} disabled={busy}>
              <Users className="mr-1 h-3 w-3" /> Start
            </Button>
            {active.length > 0 ? (
              <Button size="sm" variant="outline" onClick={reconvene} disabled={busy}>
                Reconvene
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : active.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {isFaculty
            ? 'No active breakouts. Click Start to split the room.'
            : 'No active breakouts.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((b) => {
            const inThis = b.participants.some((p) => p.userId === currentUserId)
            return (
              <li key={b.id} className="rounded-md border p-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{b.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.groupingMode === 'RANDOM' ? (
                        <Shuffle className="mr-1 inline h-3 w-3" />
                      ) : (
                        <Hand className="mr-1 inline h-3 w-3" />
                      )}
                      {b.participants.length} member{b.participants.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {inThis ? (
                      <Button size="sm" onClick={() => onJoin({ id: b.id, name: b.name })}>
                        Join
                      </Button>
                    ) : b.groupingMode === 'SELF_SELECT' && !myBreakout ? (
                      <Button size="sm" variant="outline" onClick={() => claimSeat(b.id)}>
                        Take seat
                      </Button>
                    ) : null}
                    {isFaculty ? (
                      <Button size="icon" variant="ghost" onClick={() => endOne(b.id)} className="h-7 w-7">
                        <X className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {b.participants.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {b.participants.map((p) => (
                      <li
                        key={p.userId}
                        className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground"
                      >
                        {p.name}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start breakout rooms</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Grouping</legend>
              <label className="flex items-start gap-2 rounded border p-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'RANDOM'}
                  onChange={() => setMode('RANDOM')}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm font-medium">
                    <Shuffle className="mr-1 inline h-3 w-3" />
                    Random
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Server shuffles current participants into N balanced groups.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 rounded border p-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'SELF_SELECT'}
                  onChange={() => setMode('SELF_SELECT')}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm font-medium">
                    <Hand className="mr-1 inline h-3 w-3" />
                    Self-select
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Empty rooms; participants choose where to go.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 rounded border p-2 opacity-60">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'AI_AUTO'}
                  onChange={() => setMode('AI_AUTO')}
                  className="mt-1"
                />
                <div>
                  <div className="text-sm font-medium">
                    <Sparkles className="mr-1 inline h-3 w-3" />
                    AI auto-group
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-800">
                      Coming soon
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Balances by role, recent scoring, and engagement signals.
                  </div>
                </div>
              </label>
            </fieldset>

            <div className="flex items-center gap-2">
              <label htmlFor="count" className="text-sm">
                Number of rooms
              </label>
              <Input
                id="count"
                type="number"
                min={1}
                max={16}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
                className="w-20"
              />
            </div>

            {errorMsg ? (
              <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{errorMsg}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={busy}>
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
