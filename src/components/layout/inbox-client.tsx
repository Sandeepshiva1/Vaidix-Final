'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  Check,
  Loader2,
  Settings2,
  ChevronRight,
  Video,
  MessageSquare,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ensureCsrfHeaders } from '@/lib/csrf-client'
import { Tabs, TabsContent } from '@/components/ui/tabs'

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface PreferenceView {
  kind: string
  channel: string
  enabled: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

const PREF_LABELS: Record<string, string> = {
  'session.proposed':    'Session approval requests',
  'session.approved':    'Session approved',
  'session.rejected':    'Session declined',
  'session.rescheduled': 'Session rescheduled',
  'session.cancelled':   'Session cancelled',
  'session.reminder':    'Session reminders',
  'session.started':     'Session went live',
  'session.ended':       'Session ended',
  'prequestion.posted':  'New pre-class questions',
  'invitation.accepted': 'Invitation accepted',
  'objective.achieved':  'Learning objective achieved',
  'recording.ready':     'Recording & transcript ready',
}

const SESSION_KINDS = new Set([
  'session.proposed', 'session.approved', 'session.rejected',
  'session.rescheduled', 'session.cancelled', 'session.reminder',
  'session.started', 'session.ended',
])
const QUESTION_KINDS = new Set(['prequestion.posted'])
const ACHIEVEMENT_KINDS = new Set(['objective.achieved'])
const RECORDING_KINDS = new Set(['recording.ready'])
const INVITATION_KINDS = new Set(['invitation.accepted'])

const ADMIN_PD_ROLES = new Set(['admin', 'program_director'])

type TabId = 'all' | 'sessions' | 'questions' | 'achievements' | 'recordings' | 'invitations'

function filterByTab(items: NotificationView[], tab: TabId): NotificationView[] {
  switch (tab) {
    case 'sessions':    return items.filter((n) => SESSION_KINDS.has(n.kind))
    case 'questions':   return items.filter((n) => QUESTION_KINDS.has(n.kind))
    case 'achievements':return items.filter((n) => ACHIEVEMENT_KINDS.has(n.kind))
    case 'recordings':  return items.filter((n) => RECORDING_KINDS.has(n.kind))
    case 'invitations': return items.filter((n) => INVITATION_KINDS.has(n.kind))
    default:            return items
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InboxClient({ role }: { role: string }) {
  const [items, setItems] = useState<NotificationView[]>([])
  const [loading, setLoading] = useState(true)
  const [busyAll, setBusyAll] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('all')

  // Preferences panel
  const [showPrefs, setShowPrefs] = useState(false)
  const [prefs, setPrefs] = useState<PreferenceView[]>([])
  const [prefsLoading, setPrefsLoading] = useState(false)
  const [busyKind, setBusyKind] = useState<string | null>(null)
  const prefsRef = useRef<HTMLDivElement>(null)

  // ── Data fetching ────────────────────────────────────────────────────────

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?limit=100', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const json = await res.json()
      if (json.ok) setItems(json.data.items)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadNotifications() }, [loadNotifications])

  // Close prefs panel on outside click
  useEffect(() => {
    if (!showPrefs) return
    function onDown(e: MouseEvent) {
      if (prefsRef.current && !prefsRef.current.contains(e.target as Node)) {
        setShowPrefs(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPrefs])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleRowClick(n: NotificationView) {
    if (n.readAt) return
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
    )
    try {
      const headers = await ensureCsrfHeaders()
      await fetch(`/api/notifications/${n.id}/read`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
      })
    } catch { /* reconcile on next refresh */ }
  }

  async function handleMarkAll() {
    if (busyAll) return
    setBusyAll(true)
    const now = new Date().toISOString()
    setItems((prev) => prev.map((x) => (x.readAt ? x : { ...x, readAt: now })))
    try {
      // First mutation of the session may not have a CSRF cookie yet — bootstrap.
      const headers = await ensureCsrfHeaders()
      await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
      })
    } finally {
      setBusyAll(false)
    }
  }

  async function handleOpenPrefs() {
    setShowPrefs(true)
    if (prefs.length > 0) return
    setPrefsLoading(true)
    try {
      const res = await fetch('/api/notifications/preferences', { credentials: 'same-origin' })
      const json = await res.json()
      if (json.ok) setPrefs(json.data)
    } finally {
      setPrefsLoading(false)
    }
  }

  async function handleTogglePref(kind: string, current: boolean) {
    if (busyKind) return
    setBusyKind(kind)
    const next = !current
    setPrefs((prev) => prev.map((p) => (p.kind === kind ? { ...p, enabled: next } : p)))
    try {
      const headers = await ensureCsrfHeaders()
      await fetch('/api/notifications/preferences', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, channel: 'IN_APP', enabled: next }),
      })
    } catch {
      // roll back on error
      setPrefs((prev) => prev.map((p) => (p.kind === kind ? { ...p, enabled: current } : p)))
    } finally {
      setBusyKind(null)
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const unread = items.filter((n) => !n.readAt).length
  const showInvitationsTab = ADMIN_PD_ROLES.has(role)

  // ── Tab badge counts ──────────────────────────────────────────────────────

  function unreadCount(filter: (n: NotificationView) => boolean) {
    return items.filter((n) => !n.readAt && filter(n)).length
  }

  const badges: Record<TabId, number> = {
    all:          unread,
    sessions:     unreadCount((n) => SESSION_KINDS.has(n.kind)),
    questions:    unreadCount((n) => QUESTION_KINDS.has(n.kind)),
    achievements: unreadCount((n) => ACHIEVEMENT_KINDS.has(n.kind)),
    recordings:   unreadCount((n) => RECORDING_KINDS.has(n.kind)),
    invitations:  unreadCount((n) => INVITATION_KINDS.has(n.kind)),
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {unread > 0 ? `${unread} unread` : 'All caught up'}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAll}
            disabled={busyAll || unread === 0}
            className="gap-1.5"
          >
            <Check className="size-3.5" />
            Mark all read
          </Button>
          <div className="relative" ref={prefsRef}>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Notification settings"
              onClick={handleOpenPrefs}
            >
              <Settings2 className="size-3.5" />
            </Button>

            {/* Preferences flyout */}
            <AnimatePresence>
              {showPrefs && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl shadow-black/10 dark:shadow-black/40"
                >
                  <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                    <p className="text-sm font-semibold">Notification settings</p>
                    <button
                      onClick={() => setShowPrefs(false)}
                      className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {prefsLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <ul className="divide-y divide-border/30">
                        {prefs.map((p) => (
                          <li key={p.kind} className="flex items-center justify-between px-4 py-2.5">
                            <span className="text-sm text-foreground">
                              {PREF_LABELS[p.kind] ?? p.kind}
                            </span>
                            <button
                              onClick={() => handleTogglePref(p.kind, p.enabled)}
                              disabled={busyKind === p.kind}
                              aria-label={`Toggle ${p.kind}`}
                              className={cn(
                                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                                p.enabled ? 'bg-teal-500' : 'bg-muted'
                              )}
                            >
                              <span
                                className={cn(
                                  'pointer-events-none inline-block size-3.5 rounded-full bg-white shadow transition-transform',
                                  p.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                                )}
                              />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="border-t border-border/40 px-4 py-2.5">
                    <p className="text-[11px] text-muted-foreground">
                      In-app notifications only. Email preferences are managed separately.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabId)}
        className="w-full"
      >
        <div className="flex flex-wrap gap-2 pb-2">
          {(
            [
              { id: 'all',          label: 'All',          icon: Bell,          activeColor: 'bg-teal-500 text-white border-teal-500' },
              { id: 'sessions',     label: 'Sessions',     icon: Video,         activeColor: 'bg-blue-500 text-white border-blue-500' },
              { id: 'questions',    label: 'Questions',    icon: MessageSquare, activeColor: 'bg-amber-500 text-white border-amber-500' },
              { id: 'achievements', label: 'Achievements', icon: Trophy,        activeColor: 'bg-purple-500 text-white border-purple-500' },
              { id: 'recordings',   label: 'Recordings',   icon: Video,         activeColor: 'bg-rose-500 text-white border-rose-500' },
              ...(showInvitationsTab ? [{ id: 'invitations', label: 'Invitations', icon: Users, activeColor: 'bg-emerald-500 text-white border-emerald-500' }] : []),
            ] as { id: TabId; label: string; icon: React.ElementType; activeColor: string }[]
          ).map(({ id, label, icon: Icon, activeColor }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-all',
                activeTab === id
                  ? activeColor
                  : 'border-border bg-background text-foreground/70 hover:border-foreground/30 hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {label}
              {badges[id] > 0 && (
                <span className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold',
                  activeTab === id ? 'bg-white/25 text-white' : 'bg-foreground/10 text-foreground/70',
                )}>
                  {badges[id] > 99 ? '99+' : badges[id]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content — shared panel, filtered by activeTab */}
        {(['all', 'sessions', 'questions', 'achievements', 'recordings', 'invitations'] as TabId[]).map((tid) => (
          <TabsContent key={tid} value={tid} className="mt-0 pt-3">
            <NotificationList
              items={filterByTab(items, tid)}
              loading={loading}
              onRowClick={handleRowClick}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

// ─── Notification list ────────────────────────────────────────────────────────

function NotificationList({
  items,
  loading,
  onRowClick,
}: {
  items: NotificationView[]
  loading: boolean
  onRowClick: (n: NotificationView) => void
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-16 text-center"
      >
        <Bell className="mb-3 size-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground">Nothing here</p>
        <p className="mt-1 text-xs text-muted-foreground">
          New notifications will appear as your sessions and activities progress.
        </p>
      </motion.div>
    )
  }

  return (
    <motion.ul
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card overflow-hidden"
    >
      <AnimatePresence initial={false}>
        {items.map((n) => {
          const Wrapper: React.ElementType = n.linkUrl ? Link : 'div'
          const wrapperProps: Record<string, unknown> = n.linkUrl
            ? { href: n.linkUrl, onClick: () => onRowClick(n) }
            : { onClick: () => onRowClick(n) }
          const unreadRow = !n.readAt

          return (
            <motion.li
              key={n.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <Wrapper
                {...wrapperProps}
                className={cn(
                  'group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 cursor-pointer',
                  unreadRow && 'bg-teal-500/3'
                )}
              >
                {/* Unread dot */}
                <span
                  className={cn(
                    'mt-2 size-1.5 shrink-0 rounded-full',
                    unreadRow ? 'bg-teal-500' : 'bg-transparent'
                  )}
                />

                {/* Content */}
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
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                  )}
                </div>

                {/* Arrow hint for linked rows */}
                {n.linkUrl && (
                  <ChevronRight className="mt-1.5 size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                )}
              </Wrapper>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </motion.ul>
  )
}
