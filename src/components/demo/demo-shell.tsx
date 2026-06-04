'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState, type ReactNode } from 'react'
import {
  Bell,
  BotMessageSquare,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  RotateCcw,
  Settings,
  Sparkles,
  Stethoscope,
  Users2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDemoState, stepCompletion } from './demo-state'

interface NavItem {
  label: string
  icon: ReactNode
  match: (path: string) => boolean
  href: (sessionId: string | null) => string
}

const NAV: NavItem[] = [
  {
    label: 'Pre-Conference',
    icon: <Clock className="size-[18px]" />,
    match: (p) => p.includes('/demo/sessions/') && /prepare|studio|learners|promo|questions|ready/.test(p),
    href: (sid) => (sid ? `/demo/sessions/${sid}/prepare` : '/demo'),
  },
  {
    label: 'Live Conference',
    icon: <PlayCircle className="size-[18px]" />,
    match: (p) => p.endsWith('/live'),
    href: (sid) => (sid ? `/demo/sessions/${sid}/live` : '/demo'),
  },
  {
    label: 'Post-Conference',
    icon: <CheckCircle2 className="size-[18px]" />,
    match: (p) => p.includes('/demo/sessions/') && p.endsWith('/post'),
    href: (sid) => (sid ? `/demo/sessions/${sid}/post` : '/demo'),
  },
  {
    label: 'My Sessions',
    icon: <CalendarDays className="size-[18px]" />,
    match: (p) => p === '/demo' || p.startsWith('/demo?'),
    href: () => '/demo',
  },
  {
    label: 'My Calendar',
    icon: <CalendarDays className="size-[18px]" />,
    match: (p) => p.startsWith('/demo/calendar'),
    href: () => '/demo/calendar',
  },
  {
    label: 'Active Learners',
    icon: <Users2 className="size-[18px]" />,
    match: (p) => p.startsWith('/demo/learners'),
    href: () => '/demo/learners',
  },
  {
    label: 'Settings',
    icon: <Settings className="size-[18px]" />,
    match: (p) => p.startsWith('/demo/settings'),
    href: () => '/demo',
  },
]

export function DemoShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || ''
  const router = useRouter()
  const { sessions, resetDemo } = useDemoState()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const sessionIdFromPath = useMemo(() => {
    const m = pathname.match(/\/demo\/sessions\/([^/]+)/)
    const id = m?.[1] ?? null
    // `/demo/sessions/new` is the create form, not a real session — treat it
    // as no active session so the session-scoped nav (Prepare/Live/Post) falls
    // back to /demo instead of linking to non-existent /demo/sessions/new/*.
    return id === 'new' ? null : id
  }, [pathname])

  const currentSession = sessionIdFromPath ? sessions.find((s) => s.id === sessionIdFromPath) : null
  const progress = currentSession ? stepCompletion(currentSession) : null

  return (
    <div className="min-h-screen bg-[var(--background)] text-foreground antialiased">
      <div className="flex">
        {/* Sidebar */}
        <aside
          className={cn(
            'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border/60 bg-white/80 backdrop-blur-xl transition-[width] duration-200 dark:bg-background/80',
            sidebarCollapsed ? 'w-[56px]' : 'w-64'
          )}
        >
          {/* Logo + collapse toggle */}
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border/60 px-3">
            {!sidebarCollapsed && (
              <>
                <div className="relative size-9 shrink-0 overflow-hidden rounded-xl bg-linear-to-br from-teal-500/15 to-emerald-500/15 ring-1 ring-teal-500/20">
                  <Stethoscope className="absolute inset-0 m-auto size-5 text-teal-700 dark:text-teal-300" />
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[15px] font-semibold tracking-tight">Vaidix</div>
                  <div className="text-[11px] font-medium text-muted-foreground">Clinical Teaching OS</div>
                </div>
              </>
            )}
            <button
              type="button"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setSidebarCollapsed((v) => !v)}
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground',
                sidebarCollapsed && 'mx-auto'
              )}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>

          {!sidebarCollapsed && (
            <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">Workflow</div>
          )}

          <nav className="flex flex-col gap-1 px-2 pt-2">
            {NAV.map((item) => {
              const active = item.match(pathname)
              return (
                <Link
                  key={item.label}
                  href={item.href(sessionIdFromPath)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium transition-all',
                    sidebarCollapsed && 'justify-center',
                    active
                      ? 'bg-linear-to-r from-teal-500/15 via-teal-500/8 to-transparent text-teal-700 shadow-[inset_0_0_0_1px_oklch(0.85_0.05_165/0.4)] dark:text-teal-300'
                      : 'text-muted-foreground hover:bg-foreground/4 hover:text-foreground'
                  )}
                >
                  {active && !sidebarCollapsed && (
                    <span className="absolute left-0 h-5 w-1 -translate-x-2 rounded-r-full bg-linear-to-b from-teal-500 to-emerald-500" />
                  )}
                  <span className={cn('shrink-0 transition-transform', active ? 'text-teal-600 dark:text-teal-300' : 'group-hover:scale-110')}>
                    {item.icon}
                  </span>
                  {!sidebarCollapsed && (
                    <>
                      <span>{item.label}</span>
                      {active && <ChevronRight className="ml-auto size-4 opacity-70" />}
                    </>
                  )}
                </Link>
              )
            })}
          </nav>

          {!sidebarCollapsed && <div className="mx-3 my-3 h-px bg-linear-to-r from-transparent via-border/60 to-transparent" />}

          {currentSession && !sidebarCollapsed && (
            <div className="mx-3 mb-3 rounded-2xl border border-teal-500/20 bg-linear-to-br from-teal-500/8 via-transparent to-emerald-500/8 p-3">
              <div className="text-[11px] font-semibold tracking-wider text-teal-700/80 uppercase dark:text-teal-300/80">Active session</div>
              <div className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug">{currentSession.title}</div>
              <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted-foreground">
                <span>{progress?.done ?? 0}/{progress?.total ?? 5} steps</span>
                <span className="font-mono tabular-nums">{progress?.pct ?? 0}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/5">
                <div
                  className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500 transition-[width] duration-700 ease-out"
                  style={{ width: `${progress?.pct ?? 0}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-auto px-2 pb-4">
            <button
              type="button"
              title={sidebarCollapsed ? 'Reset demo data' : undefined}
              onClick={() => {
                resetDemo()
                router.push('/demo')
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-foreground/4 hover:text-foreground',
                sidebarCollapsed && 'justify-center'
              )}
            >
              <RotateCcw className="size-4 shrink-0" />
              {!sidebarCollapsed && 'Reset demo data'}
            </button>
            {!sidebarCollapsed && (
              <div className="mt-3 rounded-xl bg-foreground/4 p-3">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-500 to-emerald-600 text-[12px] font-semibold text-white shadow-sm">AP</div>
                  <div className="min-w-0 leading-tight">
                    <div className="truncate text-[12.5px] font-semibold">Dr. Avinash Pathengay</div>
                    <div className="truncate text-[11px] text-muted-foreground">Faculty · LV Prasad Eye Institute</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-30 border-b border-border/60 bg-white/85 backdrop-blur-xl dark:bg-background/80">
            <div className="flex h-14 items-center gap-4 px-6">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Sparkles className="size-3.5 text-teal-600 dark:text-teal-300" />
                <span className="font-medium">Demo Prototype</span>
                <span className="text-border">·</span>
                <span>For client preview only</span>
              </div>

              <div className="ml-auto flex items-center gap-3">
                {progress && (
                  <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 md:flex">
                    <span className="text-[11.5px] font-medium text-muted-foreground">Session Readiness</span>
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-foreground/5">
                      <div
                        className="h-full rounded-full bg-linear-to-r from-teal-500 to-emerald-500"
                        style={{ width: `${progress.pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11.5px] font-semibold tabular-nums text-teal-700 dark:text-teal-300">
                      {progress.pct}%
                    </span>
                  </div>
                )}

                <Link
                  href="/demo/bot"
                  title="Teaching &amp; Reflection Bot"
                  className="relative grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <BotMessageSquare className="size-4" />
                </Link>

                <button
                  type="button"
                  aria-label="Notifications"
                  className="relative grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <Bell className="size-4" />
                  <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-rose-500 ring-2 ring-background" />
                </button>

                <div className="flex h-9 items-center gap-2.5 rounded-full border border-border/60 bg-background/60 pl-1 pr-3">
                  <Image
                    src="/logo.png"
                    alt="LVPEI"
                    width={28}
                    height={28}
                    className="size-7 rounded-full object-contain"
                  />
                  <div className="hidden text-[12px] leading-tight md:block">
                    <div className="font-semibold">Dr. Avinash Pathengay</div>
                    <div className="text-[10.5px] text-muted-foreground">Faculty · Ophthalmology</div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
    </div>
  )
}
