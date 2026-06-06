'use client'

import { useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ScrollText, Calendar, Filter, Loader2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Role } from '@prisma/client'

export interface AuditRow {
  id: string
  timestamp: string
  user: string
  actorRole: Role | null
  eventType: string
  details: string
  ip: string
  success: boolean
}
export interface EventOption {
  value: string
  count: number
}

// eventType prefix → human category. Drives both the filter <optgroup>s and the
// row badge colour so related events read as a group.
const CATEGORY_OF: Record<string, string> = {
  auth: 'Authentication',
  invitation: 'Invitations',
  user: 'User management',
  faculty: 'User management',
  cohort: 'Cohorts',
  module: 'Permissions',
  session: 'Sessions',
  objectives: 'Sessions',
  objective: 'Sessions',
  recording: 'Recordings',
  recording_share: 'Recordings',
  document: 'Documents',
  deck: 'Decks',
  deck_forge: 'Decks',
  style_profile: 'Decks',
  blueprint: 'Decks',
  case: 'Cases',
  case_forge: 'Cases',
  case_template: 'Cases',
  qa: 'Q&A',
  breakout: 'Breakouts',
  promo: 'Promo & Share',
  promo_share: 'Promo & Share',
  pre_question: 'Pre-Conference',
  pre_case: 'Pre-Conference',
  readiness: 'Pre-Conference',
  study_pack: 'Study Pack',
  live_hook: 'Engagement',
  presenter_alert: 'Engagement',
  kirkpatrick: 'Engagement',
  captions: 'Captions',
  transcript: 'Post-session',
  post_session: 'Post-session',
  whatsapp: 'WhatsApp',
  retention: 'Retention',
  dsr: 'DPDPA',
  worker: 'System',
}

const CATEGORY_BADGE: Record<string, string> = {
  Authentication: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  Invitations: 'bg-teal-500/10 text-teal-700 dark:text-teal-300',
  'User management': 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  Permissions: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  Cohorts: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  Sessions: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  Recordings: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  Documents: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  Decks: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  Cases: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  'Q&A': 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  Engagement: 'bg-lime-500/10 text-lime-700 dark:text-lime-300',
  DPDPA: 'bg-red-500/10 text-red-700 dark:text-red-300',
}

function categoryOf(eventType: string): string {
  return CATEGORY_OF[eventType.split('.')[0]] ?? 'Other'
}

// 'auth.login.success' → 'Login success'; 'session.created' → 'Session created'
function humanizeEvent(eventType: string): string {
  const parts = eventType.split('.')
  // Drop the leading domain segment when a category already covers it, so the
  // label reads as the action rather than "Auth login success".
  const body = parts.length > 1 ? parts.slice(1) : parts
  const phrase = body.join(' ').replace(/_/g, ' ').trim()
  return phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : eventType
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

export function AuditLogsClient({
  events,
  eventOptions,
  total,
  pageSize,
  initialFilters,
}: {
  events: AuditRow[]
  eventOptions: EventOption[]
  total: number
  pageSize: number
  initialFilters: { from: string; to: string; user: string; action: string }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.push(`${pathname}?${next.toString()}`))
  }

  const hasFilters = Boolean(
    initialFilters.from || initialFilters.to || initialFilters.user || initialFilters.action,
  )

  // Group the present event types by category for the filter <optgroup>s.
  const groups = new Map<string, EventOption[]>()
  for (const opt of eventOptions) {
    const cat = categoryOf(opt.value)
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push(opt)
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => startTransition(() => router.push(pathname))}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" /> Clear filters
          </button>
        )}
      </div>

      {/* Filter row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2">
          <Calendar className="size-4 text-muted-foreground" />
          <Input
            type="date"
            defaultValue={initialFilters.from}
            onChange={(e) => setParam('from', e.target.value)}
            className="w-[160px]"
            aria-label="From date"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            defaultValue={initialFilters.to}
            onChange={(e) => setParam('to', e.target.value)}
            className="w-[160px]"
            aria-label="To date"
          />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const v = new FormData(e.currentTarget).get('user')
            setParam('user', typeof v === 'string' ? v : '')
          }}
          className="relative"
        >
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="user"
            placeholder="Filter by user (name or email)…"
            defaultValue={initialFilters.user}
            onBlur={(e) => setParam('user', e.target.value)}
            className="w-[240px] pl-8"
          />
        </form>

        {/* Event-type filter — grouped by category, with live counts. */}
        <select
          value={initialFilters.action}
          onChange={(e) => setParam('action', e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-primary"
          aria-label="Event type"
        >
          <option value="">All events</option>
          {sortedGroups.map(([cat, opts]) => (
            <optgroup key={cat} label={cat}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {humanizeEvent(o.value)} ({o.count})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Timestamp</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Event</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Details</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  No audit events match these filters.
                </td>
              </tr>
            ) : (
              events.map((event, index) => {
                const cat = categoryOf(event.eventType)
                return (
                  <tr
                    key={event.id}
                    className={cn('border-b last:border-0', index % 2 === 1 && 'bg-muted/20')}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                      {fmtTimestamp(event.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {event.user}
                      {event.actorRole && (
                        <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                          {event.actorRole.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        title={event.eventType}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                          CATEGORY_BADGE[cat] ?? 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
                        )}
                      >
                        {!event.success && <span className="size-1.5 rounded-full bg-rose-500" />}
                        {humanizeEvent(event.eventType)}
                      </span>
                    </td>
                    <td className="max-w-sm truncate px-4 py-3 text-muted-foreground" title={event.details}>
                      {event.details || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                      {event.ip}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {events.length} of {total} matching event{total === 1 ? '' : 's'}
        {total > pageSize && ` (most recent ${pageSize} shown — narrow the filters to see older events)`}
        .
      </p>
    </div>
  )
}
