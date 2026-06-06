'use client'

// ════════════════════════════════════════════════════════════════════════════
// WorkflowShell — the real platform shell, a faithful reproduction of the
// /demo prototype's DemoShell, wired to REAL routes and the REAL logged-in
// user. Sidebar: real Vaidix logo + "WORKFLOW" (Pre/Live/Post) + My Sessions /
// My Calendar / Active Learners / Settings. Topbar: bot + notifications + a
// user-chip dropdown (Profile / Sign out).
//
// Responsive: the persistent left sidebar is desktop-only (md+). Below md it is
// hidden and replaced by a hamburger button in the topbar that opens the same
// navigation as an off-canvas drawer (Sheet → Base UI Dialog: focus-trapped,
// Escape-to-close, scroll-locked, portal-rendered).
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BookOpen,
  BotMessageSquare,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  ListChecks,
  LogOut,
  Mail,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  ScrollText,
  Settings,
  User,
  Users2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { NotificationBell } from '@/components/layout/notification-bell'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
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
  href: (sessionId: string | null, isLearner: boolean) => string
  /** If set, only these roles see this nav item. Omit to show to all teaching roles. */
  allowedRoles?: UserRole[]
  /** When viewing a session that has reached its Post-Conference phase, earlier
   *  workflow stages (Pre / Live) are over — show the item but make it a
   *  non-clickable, greyed-out marker instead of a live link. */
  disabledInPost?: boolean
}

// Teaching workflow nav — faculty / resident / program-director / guest.
const TEACHING_NAV: NavItem[] = [
  {
    label: 'Pre-Conference',
    icon: <Clock className="size-4.5" />,
    match: (p) => /\/session\/[^/]+\/(pre|prepare|studio|learners|promo|questions|ready)/.test(p) || /\/classroom\/[^/]+\/prepare/.test(p),
    href: (sid, isLearner) => sid ? (isLearner ? `/classroom/${sid}/prepare` : `/session/${sid}/pre`) : '/dashboard',
    disabledInPost: true,
  },
  {
    label: 'Live Conference',
    icon: <PlayCircle className="size-4.5" />,
    match: (p) => /\/session\/[^/]+\/live/.test(p) || /\/classroom\/[^/]+$/.test(p),
    href: (sid, isLearner) => sid ? (isLearner ? `/classroom/${sid}` : `/session/${sid}/live`) : '/dashboard',
    disabledInPost: true,
  },
  {
    label: 'Post-Conference',
    icon: <CheckCircle2 className="size-4.5" />,
    match: (p) => /\/session\/[^/]+\/post/.test(p) || /\/classroom\/[^/]+\/post/.test(p) || p === '/sessions/completed',
    href: (sid, isLearner) => sid ? (isLearner ? `/classroom/${sid}/post` : `/session/${sid}/post`) : '/sessions/completed',
  },
  { label: 'My Sessions', icon: <CalendarDays className="size-4.5" />, match: (p) => p === '/dashboard', href: () => '/dashboard' },
  { label: 'My Calendar', icon: <CalendarDays className="size-4.5" />, match: (p) => p.startsWith('/calendar'), href: () => '/calendar' },
  { label: 'Active Learners', icon: <Users2 className="size-4.5" />, match: (p) => p.startsWith('/teacher/learners'), href: () => '/teacher/learners', allowedRoles: ['faculty', 'program_director'] },
  { label: 'My Documents', icon: <FolderOpen className="size-4.5" />, match: (p) => p.startsWith('/teacher/documents'), href: () => '/teacher/documents' },
  { label: 'Settings', icon: <Settings className="size-4.5" />, match: (p) => p.startsWith('/profile') || p.startsWith('/settings'), href: () => '/profile' },
]

// Admin-console nav — ADMIN role only. Maps to the real /admin/* routes. The
// server-side gate in src/app/(platform)/admin/layout.tsx (role === ADMIN) is
// the security boundary; this nav is UX so admins can reach the console they're
// already authorised for instead of navigating by raw URL.
const ADMIN_NAV: NavItem[] = [
  { label: 'Users', icon: <Users2 className="size-4.5" />, match: (p) => p.startsWith('/admin/users'), href: () => '/admin/users' },
  { label: 'Invitations', icon: <Mail className="size-4.5" />, match: (p) => p.startsWith('/admin/invitations'), href: () => '/admin/invitations' },
  { label: 'Cohorts', icon: <Users2 className="size-4.5" />, match: (p) => p.startsWith('/admin/cohorts'), href: () => '/admin/cohorts' },
  { label: 'Institution', icon: <Building2 className="size-4.5" />, match: (p) => p.startsWith('/admin/institution'), href: () => '/admin/institution' },
  { label: 'Knowledge Base', icon: <BookOpen className="size-4.5" />, match: (p) => p.startsWith('/admin/knowledge-base'), href: () => '/admin/knowledge-base' },
  { label: 'Training Queue', icon: <ListChecks className="size-4.5" />, match: (p) => p.startsWith('/admin/training-queue'), href: () => '/admin/training-queue' },
  { label: 'Audit Logs', icon: <ScrollText className="size-4.5" />, match: (p) => p.startsWith('/admin/audit-logs'), href: () => '/admin/audit-logs' },
  { label: 'Settings', icon: <Settings className="size-4.5" />, match: (p) => p.startsWith('/admin/settings'), href: () => '/admin/settings' },
]

// Pick the nav set + section label + landing route for the signed-in role.
// Admins get the admin console; every teaching role keeps the workflow nav.
function navForRole(role: UserRole): { sectionLabel: string; items: NavItem[]; home: string } {
  if (role === 'admin') return { sectionLabel: 'Admin', items: ADMIN_NAV, home: '/admin/users' }
  return { sectionLabel: 'Workflow', items: TEACHING_NAV, home: '/dashboard' }
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter((p) => !p.startsWith('Dr.')).map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}

export function WorkflowShell({ identity, children }: { identity: ShellIdentity; children: ReactNode }) {
  const pathname = usePathname() || ''
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [prevPathname, setPrevPathname] = useState(pathname)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the mobile drawer on every route change — nav-link taps, the browser
  // back button, and any programmatic navigation. Adjusting state during render
  // is React's documented alternative to a route-change effect; it avoids the
  // extra render + paint (and the set-state-in-effect cascade).
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setMobileNavOpen(false)
  }

  const { sessionIdFromPath, isLearnerContext } = useMemo(() => {
    const hostMatch = pathname.match(/\/session\/([^/]+)/)
    const hostId = hostMatch?.[1] ?? null
    if (hostId && hostId !== 'new') return { sessionIdFromPath: hostId, isLearnerContext: false }
    // Attendee/learner paths: /classroom/[id]/prepare|post|study|pre-questions|recording
    const learnerMatch = pathname.match(/\/classroom\/([^/]+)/)
    const learnerId = learnerMatch?.[1] ?? null
    return { sessionIdFromPath: learnerId, isLearnerContext: !!learnerId }
  }, [pathname])

  // Viewing a session in its Post-Conference phase — the earlier workflow stages
  // (Pre / Live) are over, so their nav items are shown but disabled.
  const inPostPhase = /\/session\/[^/]+\/post/.test(pathname) || /\/classroom\/[^/]+\/post/.test(pathname)

  const roleLabel = ROLE_LABEL[identity.role] ?? 'Member'
  const subtitle = identity.specialization ? `${roleLabel} · ${identity.specialization}` : roleLabel
  const initials = initialsOf(identity.name || identity.email)
  const { sectionLabel, items: navItems, home } = navForRole(identity.role)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Immersive routes (the live conference) take the full viewport — no sidebar,
  // no topbar; the room UI carries its own chrome. Every hook above runs
  // unconditionally, so this early return is Rules-of-Hooks safe.
  const isImmersive = /\/session\/[^/]+\/live(?:\/|$)/.test(pathname)
  if (isImmersive) {
    return <div className="h-dvh w-full overflow-hidden bg-gray-950">{children}</div>
  }

  const avatar = (size: string, text: string) =>
    identity.avatarUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={identity.avatarUrl} alt={identity.name} className={cn(size, 'shrink-0 rounded-full object-cover')} />
    ) : (
      <div className={cn(size, 'grid shrink-0 place-items-center rounded-full bg-linear-to-br from-teal-500 to-emerald-600 font-semibold text-white shadow-sm', text)}>{initials}</div>
    )

  // Single source of truth for the nav links — rendered both in the desktop
  // sidebar (collapsible) and the mobile drawer (always expanded), so the two
  // can never drift apart.
  const renderNavLinks = (collapsed: boolean, onNavigate?: () => void) =>
    navItems.filter((item) => !item.allowedRoles || item.allowedRoles.includes(identity.role)).map((item) => {
      const active = item.match(pathname)
      // Only disable a stage we have a real session to disable it for — never on
      // the standalone /sessions/completed list (no sessionId in the path).
      const disabled = inPostPhase && !!item.disabledInPost && !!sessionIdFromPath

      if (disabled) {
        return (
          <div
            key={item.label}
            aria-disabled="true"
            title={collapsed ? `${item.label} (session ended)` : 'This phase is over — the session has moved to Post-Conference'}
            className={cn(
              'group relative flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium text-muted-foreground/40 cursor-not-allowed select-none',
              collapsed && 'justify-center',
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </div>
        )
      }

      return (
        <Link
          key={item.label}
          href={item.href(sessionIdFromPath, isLearnerContext)}
          title={collapsed ? item.label : undefined}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'group relative flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[13.5px] font-medium transition-all',
            collapsed && 'justify-center',
            active
              ? 'bg-linear-to-r from-teal-500/15 via-teal-500/8 to-transparent text-teal-700 shadow-[inset_0_0_0_1px_oklch(0.85_0.05_165/0.4)] dark:text-teal-300'
              : 'text-muted-foreground hover:bg-foreground/4 hover:text-foreground',
          )}
        >
          {active && !collapsed && <span className="absolute left-0 h-5 w-1 -translate-x-2 rounded-r-full bg-linear-to-b from-teal-500 to-emerald-500" />}
          <span className={cn('shrink-0 transition-transform', active ? 'text-teal-600 dark:text-teal-300' : 'group-hover:scale-110')}>{item.icon}</span>
          {!collapsed && (<><span>{item.label}</span>{active && <ChevronRight className="ml-auto size-4 opacity-70" />}</>)}
        </Link>
      )
    })

  return (
    <div className="min-h-screen bg-[var(--background)] text-foreground antialiased">
      <div className="flex">
        {/* Sidebar — desktop only (md+). On mobile it's hidden and replaced by
            the hamburger-triggered drawer below. */}
        <aside className={cn('premium-sidebar sticky top-0 hidden h-screen shrink-0 flex-col transition-[width] duration-200 md:flex', sidebarCollapsed ? 'w-14' : 'w-64')}>
          {/* Logo + collapse toggle */}
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border/60 px-3">
            {!sidebarCollapsed && (
              <Link href={home} className="flex min-w-0 flex-1 items-center gap-2.5">
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

          {!sidebarCollapsed && <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">{sectionLabel}</div>}

          <nav className="flex flex-col gap-1 px-2 pt-2">
            {renderNavLinks(sidebarCollapsed)}
          </nav>
        </aside>

        {/* Main */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-30 border-b border-border/60 bg-white/85 backdrop-blur-xl dark:bg-background/80">
            <div className="flex h-14 items-center gap-3 px-4 md:px-6">
              {/* Mobile-only: open navigation + compact brand (the sidebar is
                  hidden below md, so the topbar carries the brand + menu). */}
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation menu"
                aria-expanded={mobileNavOpen}
                className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground md:hidden"
              >
                <Menu className="size-5" />
              </button>
              <Link href={home} aria-label="Vaidix home" className="flex items-center gap-2 md:hidden">
                <Image src="/logo.png" alt="" width={28} height={28} className="size-7 shrink-0 object-contain" />
                <span className="text-[14px] font-semibold tracking-tight">Vaidix</span>
              </Link>

              <div className="ml-auto flex items-center gap-3">
                <Link href="/bot" title="Teaching &amp; Reflection Bot" aria-label="Teaching & Reflection Bot" className="relative grid size-9 place-items-center rounded-full border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                  <BotMessageSquare className="size-4" />
                </Link>

                {/* Notifications — real popover backed by /api/notifications
                    (polls unread count, opens a list, marks rows read). Replaces
                    the earlier static demo bell that never fetched anything. */}
                <NotificationBell />

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

          <main className="min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
        </div>
      </div>

      {/* Mobile navigation drawer (md:hidden via the hamburger). Sheet is the
          Base UI Dialog primitive — it focus-traps, closes on Escape, locks body
          scroll, and renders in a portal, so there's nothing to hand-roll. */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="gap-0 p-0">
          <SheetTitle className="sr-only">Main navigation</SheetTitle>
          <SheetDescription className="sr-only">Primary navigation links for the Vaidix platform.</SheetDescription>

          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border/60 px-3">
            <Link href={home} onClick={() => setMobileNavOpen(false)} className="flex min-w-0 flex-1 items-center gap-2.5">
              <Image src="/logo.png" alt="" width={36} height={36} className="size-9 shrink-0 object-contain" />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[15px] font-semibold tracking-tight">Vaidix</div>
                <div className="text-[11px] font-medium text-muted-foreground">Clinical Teaching OS</div>
              </div>
            </Link>
          </div>

          <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">{sectionLabel}</div>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pt-2 pb-4">
            {renderNavLinks(false, () => setMobileNavOpen(false))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  )
}
