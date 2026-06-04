'use client'

// ════════════════════════════════════════════════════════════════════════════
// WorkflowShell — the real platform shell, a faithful reproduction of the
// /demo prototype's DemoShell, wired to REAL routes and the REAL logged-in
// user. Sidebar: real Vaidix logo + "WORKFLOW" (Pre/Live/Post) + My Sessions /
// My Calendar / Active Learners / Settings. Topbar: bot + notifications + a
// user-chip dropdown (Profile / Sign out).
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bell,
  BotMessageSquare,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Settings,
  User,
  Users2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/types'

interface ShellIdentity {
  name: string
  email: string
  role: UserRole
  avatarUrl: string | null
  specialization: string | null
}

const ROLE_LABEL: Record<UserRole, string> = {
  resident: 'Resident',
  faculty: 'Faculty',
  program_director: 'HOD',
  admin: 'Admin',
  external_learner: 'Guest',
}

interface NavItem {
  label: string
  icon: ReactNode
  match: (path: string) => boolean
  href: (sessionId: string | null) => string
}

const NAV: NavItem[] = [
  { label: 'Pre-Conference', icon: <Clock className="size-[18px]" />, match: (p) => /\/session\/[^/]+\/(pre|prepare|studio|learners|promo|questions|ready)/.test(p), href: (sid) => (sid ? `/session/${sid}/pre` : '/dashboard') },
  { label: 'Live Conference', icon: <PlayCircle className="size-[18px]" />, match: (p) => /\/session\/[^/]+\/live/.test(p), href: (sid) => (sid ? `/session/${sid}/live` : '/dashboard') },
  { label: 'Post-Conference', icon: <CheckCircle2 className="size-[18px]" />, match: (p) => /\/session\/[^/]+\/post/.test(p), href: (sid) => (sid ? `/session/${sid}/post` : '/dashboard') },
  { label: 'My Sessions', icon: <CalendarDays className="size-[18px]" />, match: (p) => p === '/dashboard', href: () => '/dashboard' },
  { label: 'My Calendar', icon: <CalendarDays className="size-[18px]" />, match: (p) => p.startsWith('/calendar'), href: () => '/calendar' },
  { label: 'Active Learners', icon: <Users2 className="size-[18px]" />, match: (p) => p.startsWith('/teacher/learners'), href: () => '/teacher/learners' },
  { label: 'My Documents', icon: <FolderOpen className="size-[18px]" />, match: (p) => p.startsWith('/teacher/documents'), href: () => '/teacher/documents' },
  { label: 'Settings', icon: <Settings className="size-[18px]" />, match: (p) => p.startsWith('/profile') || p.startsWith('/settings'), href: () => '/profile' },
]

function initialsOf(name: string): string {
  return name.split(/\s+/).filter((p) => !p.startsWith('Dr.')).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}

export function WorkflowShell({ identity, children }: { identity: ShellIdentity; children: ReactNode }) {
  const pathname = usePathname() || ''
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const sessionIdFromPath = useMemo(() => {
    const m = pathname.match(/\/session\/([^/]+)/)
    const id = m?.[1] ?? null
    return id === 'new' ? null : id
  }, [pathname])

  const roleLabel = ROLE_LABEL[identity.role] ?? 'Member'
  const subtitle = identity.specialization ? `${roleLabel} · ${identity.specialization}` : roleLabel
  const initials = initialsOf(identity.name || identity.email)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const avatar = (size: string, text: string) =>
    identity.avatarUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={identity.avatarUrl} alt={identity.name} className={cn(size, 'shrink-0 rounded-full object-cover')} />
    ) : (
      <div className={cn(size, 'grid shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-500 to-emerald-600 font-semibold text-white shadow-sm', text)}>{initials}</div>
    )

  return (
    <div className="min-h-screen bg-[var(--background)] text-foreground antialiased">
      <div className="flex">
        {/* Sidebar */}
        <aside className={cn('sticky top-0 flex h-screen shrink-0 flex-col border-r border-border/60 bg-white/80 backdrop-blur-xl transition-[width] duration-200 dark:bg-background/80', sidebarCollapsed ? 'w-[56px]' : 'w-64')}>
          {/* Logo + collapse toggle */}
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border/60 px-3">
            {!sidebarCollapsed && (
              <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2.5">
                <Image
                  src="/logo.png"
                  alt="Vaidix"
                  width={36}
                  height={36}
                  priority
                  className="size-9 shrink-0 object-contain"
                  style={{ filter: 'drop-shadow(0 0 1px rgba(15,23,42,0.4)) drop-shadow(0 0 4px rgba(255,255,255,0.5)) drop-shadow(0 0 10px rgba(20,184,166,0.4))' }}
                />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[15px] font-semibold tracking-tight">Vaidix</div>
                  <div className="text-[11px] font-medium text-muted-foreground">Clinical Teaching OS</div>
                </div>
              </Link>
            )}
            <button type="button" title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed((v) => !v)} className={cn('grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground', sidebarCollapsed && 'mx-auto')}>
              {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>

          {!sidebarCollapsed && <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">Workflow</div>}

          <nav className="flex flex-col gap-1 px-2 pt-2">
            {NAV.map((item) => {
              const active = item.match(pathname)
              return (
                <Link key={item.label} href={item.href(sessionIdFromPath)} title={sidebarCollapsed ? item.label : undefined} className={cn('group relative flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium transition-all', sidebarCollapsed && 'justify-center', active ? 'bg-linear-to-r from-teal-500/15 via-teal-500/8 to-transparent text-teal-700 shadow-[inset_0_0_0_1px_oklch(0.85_0.05_165/0.4)] dark:text-teal-300' : 'text-muted-foreground hover:bg-foreground/4 hover:text-foreground')}>
                  {active && !sidebarCollapsed && <span className="absolute left-0 h-5 w-1 -translate-x-2 rounded-r-full bg-linear-to-b from-teal-500 to-emerald-500" />}
                  <span className={cn('shrink-0 transition-transform', active ? 'text-teal-600 dark:text-teal-300' : 'group-hover:scale-110')}>{item.icon}</span>
                  {!sidebarCollapsed && (<><span>{item.label}</span>{active && <ChevronRight className="ml-auto size-4 opacity-70" />}</>)}
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* Main */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-30 border-b border-border/60 bg-white/85 backdrop-blur-xl dark:bg-background/80">
            <div className="flex h-14 items-center gap-4 px-6">
              <div className="ml-auto flex items-center gap-3">
                <button type="button" title="Teaching &amp; Reflection Bot" className="relative grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                  <BotMessageSquare className="size-4" />
                </button>

                <button type="button" aria-label="Notifications" className="relative grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                  <Bell className="size-4" />
                  <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-rose-500 ring-2 ring-background" />
                </button>

                {/* User chip → dropdown (Profile / Sign out) */}
                <div className="relative" ref={menuRef}>
                  <button type="button" onClick={() => setMenuOpen((v) => !v)} className={cn('flex h-9 items-center gap-2.5 rounded-full border border-border/60 bg-background/60 pl-1 pr-2.5 transition-colors hover:bg-foreground/5', menuOpen && 'bg-foreground/5')}>
                    {avatar('size-7', 'text-[11px]')}
                    <div className="hidden text-[12px] leading-tight md:block">
                      <div className="font-semibold">{identity.name}</div>
                      <div className="text-[10.5px] text-muted-foreground">{subtitle}</div>
                    </div>
                    <ChevronDown className={cn('size-3 text-muted-foreground/60 transition-transform', menuOpen && 'rotate-180')} />
                  </button>

                  {menuOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl shadow-black/10 dark:shadow-black/40">
                      <div className="border-b border-border/40 px-4 py-3">
                        <p className="text-sm font-semibold text-foreground">{identity.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{identity.email}</p>
                      </div>
                      <div className="space-y-px p-1.5">
                        <Link href="/profile" onClick={() => setMenuOpen(false)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/60">
                          <User className="size-3.5 text-muted-foreground" /> Profile
                        </Link>
                        <button type="button" onClick={() => { setMenuOpen(false); void signOut({ callbackUrl: '/login' }) }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:hover:bg-rose-500/10">
                          <LogOut className="size-3.5" /> Sign out
                        </button>
                      </div>
                    </div>
                  )}
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
