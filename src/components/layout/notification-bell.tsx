'use client'

// NotificationBell — header bell + popover. Polls /api/notifications every
// 30s for the unread count, fetches the full list when the popover opens,
// and ack-marks rows on click via PATCH /api/notifications/[id]/read.
//
// Phase 1 of the inbox work. Phase 2 will start writing rows on the events
// that currently only fire emails (rescheduled, cancelled, pre-question
// posted, etc.) — the UI here will pick them up automatically.

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Bell, Check, ChevronRight, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ensureCsrfHeaders } from '@/lib/csrf-client'

const POLL_INTERVAL_MS = 30_000
// Popover shows a short stack; full history lives on /inbox.
const POPOVER_LIMIT = 10
const KIND_LABELS: Record<string, string> = {
  'session.proposed':    'Approval needed',
  'session.approved':    'Session approved',
  'session.rejected':    'Session declined',
  'session.rescheduled': 'Session rescheduled',
  'session.cancelled':   'Session cancelled',
  'session.reminder':    'Session reminder',
  'session.started':     'Session started',
  'session.ended':       'Session ended',
  'prequestion.posted':  'New pre-class question',
  'invitation.accepted': 'Invitation accepted',
  'objective.achieved':  'Objective marked',
  'recording.ready':     'Recording ready',
}

interface NotificationView {
  id: string
  kind: string
  title: string
  body: string | null
  payload: unknown
  linkUrl: string | null
  readAt: string | null
  createdAt: string
}

interface ListResponse {
  ok: true
  data: { items: NotificationView[]; unreadCount: number }
}

async function fetchList(onlyUnread = false): Promise<ListResponse['data']> {
  const url = onlyUnread
    ? '/api/notifications?unread=1&limit=1'
    : `/api/notifications?limit=${POPOVER_LIMIT}`
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as ListResponse | { ok: false }
  if (!body.ok) throw new Error('list failed')
  return body.data
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationView[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [busyAll, setBusyAll] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Background unread-count poll. Runs whether or not the popover is open
  // so the dot stays accurate. Cheap query (count only) — 1 row max returned.
  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const data = await fetchList(true)
        if (!cancelled) setUnread(data.unreadCount)
      } catch {
        // network blips are fine — we'll catch up on the next tick.
      }
    }
    void tick()
    const id = window.setInterval(tick, POLL_INTERVAL_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [])

  // Click-outside to close — same pattern as the profile dropdown above.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const loadFull = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchList(false)
      setItems(data.items)
      setUnread(data.unreadCount)
      setHydrated(true)
    } catch {
      // Surface nothing — empty state already covers it.
    } finally {
      setLoading(false)
    }
  }, [])

  function handleToggle() {
    setOpen((prev) => {
      const next = !prev
      if (next) void loadFull()
      return next
    })
  }

  async function handleRowClick(n: NotificationView) {
    // Optimistic: flip read locally so the row de-emphasises immediately.
    if (!n.readAt) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
      )
      setUnread((c) => Math.max(0, c - 1))
      try {
        const headers = await ensureCsrfHeaders()
        await fetch(`/api/notifications/${n.id}/read`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers,
        })
      } catch {
        // If the PATCH fails the next poll will reconcile.
      }
    }
    // Link navigation is handled by the wrapping <Link>.
  }

  async function handleMarkAll() {
    if (busyAll) return
    setBusyAll(true)
    const now = new Date().toISOString()
    setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })))
    setUnread(0)
    try {
      // Bootstrap the CSRF cookie if this is the user's first mutation of the
      // session — otherwise the POST 403s and the badge re-appears on refresh.
      const headers = await ensureCsrfHeaders()
      await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
      })
    } catch {
      // Reconcile on next poll.
    } finally {
      setBusyAll(false)
    }
  }

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative size-8"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        onClick={handleToggle}
      >
        <Bell className="size-4 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-500 px-1 text-[9px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-200 mt-2 w-88 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl shadow-black/10 dark:shadow-black/40">
          {/* Header row */}
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <button
              onClick={handleMarkAll}
              disabled={busyAll || unread === 0}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="size-3" />
              Mark all read
            </button>
          </div>

          {/* Body */}
          <div className="max-h-96 overflow-y-auto">
            {loading && !hydrated ? (
              <div className="flex items-center justify-center px-4 py-12 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <Bell className="mb-2 size-6 text-muted-foreground/50" />
                <p className="text-sm font-medium text-foreground">You&rsquo;re all caught up</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Session approvals, reminders, and replies will land here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {items.map((n) => {
                  const Wrapper: React.ElementType = n.linkUrl ? Link : 'div'
                  const wrapperProps: Record<string, unknown> = n.linkUrl
                    ? { href: n.linkUrl, onClick: () => { handleRowClick(n); setOpen(false) } }
                    : { onClick: () => handleRowClick(n) }
                  const unreadRow = !n.readAt
                  return (
                    <li key={n.id}>
                      <Wrapper
                        {...wrapperProps}
                        className={cn(
                          'flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 cursor-pointer',
                          unreadRow && 'bg-teal-500/4'
                        )}
                      >
                        <span
                          className={cn(
                            'mt-1.5 size-1.5 shrink-0 rounded-full',
                            unreadRow ? 'bg-teal-500' : 'bg-transparent'
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {KIND_LABELS[n.kind] ?? n.kind.replace(/\./g, ' ')}
                            </p>
                            <time className="shrink-0 text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                            </time>
                          </div>
                          <p className={cn('text-sm leading-snug text-foreground', unreadRow && 'font-medium')}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {n.body}
                            </p>
                          )}
                          <PayloadScheduledTime payload={n.payload} />
                        </div>
                      </Wrapper>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Footer — always link to the full inbox so older items are reachable */}
          <Link
            href="/inbox"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between border-t border-border/40 px-4 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <span>View all notifications</span>
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      )}
    </div>
  )
}

/**
 * Renders `payload.scheduledStart` (ISO) in the user's local timezone.
 * Server-side `.toLocaleString()` would use the container's UTC clock and
 * mis-render times for everyone outside UTC (QA #14). We always format on
 * the client so the rendered time matches the wall clock the user reads.
 *
 * Hidden for notifications without a scheduled timestamp (auth events,
 * recording-ready, etc.).
 */
function PayloadScheduledTime({ payload }: { payload: unknown }) {
  // Render the raw ISO on the server (and on the first client render to
  // match the server output), then swap to the locale-formatted string
  // after hydration. This avoids the server vs. client locale mismatch
  // warning while still keeping Intl rendering on the client where the
  // user's actual timezone lives. `useMounted` reads `false` on SSR + the
  // initial client render, then flips to `true` once we're past hydration.
  const mounted = useMounted()

  const iso =
    payload && typeof payload === 'object' && 'scheduledStart' in payload
      ? (payload as { scheduledStart?: unknown }).scheduledStart
      : null
  if (typeof iso !== 'string') return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null

  const text = mounted
    ? d.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : iso
  return (
    <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground/80">
      {text}
    </p>
  )
}

// `useSyncExternalStore` is the React-blessed way to derive a value that
// differs between SSR and the client without tripping the hydration mismatch
// warning. `getServerSnapshot` returns false (SSR + first paint), `getSnapshot`
// returns true (post-hydration). We never re-subscribe because the value is
// monotonic — once mounted, always mounted.
const NO_OP = (): (() => void) => () => {}
function useMounted(): boolean {
  return useSyncExternalStore(NO_OP, () => true, () => false)
}
