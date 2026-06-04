'use client'

// ════════════════════════════════════════════════════════════════════════════
// RoleContext — session-driven identity, with admin-gated demo role override
// ════════════════════════════════════════════════════════════════════════════
//
// Architecture (read this before adding consumers):
//
//   (platform)/layout.tsx (server component)
//     ├─ auth()                                         ← NextAuth session
//     ├─ db.user.findUnique({ include: { profile } })   ← real Prisma row
//     ├─ mapUserToIdentity(user)                        ← see lib/identity.ts
//     └─ <PlatformShell initialIdentity={...}>          ← wraps RoleProvider
//                  └─ <RoleProvider initialIdentity={...}>
//                          └─ children
//
// This file does NOT import next-auth/react or call useSession(). The session
// is resolved exactly once per navigation in the (platform) server layout and
// passed in as a typed object. That keeps every UI consumer (sidebar, header,
// dashboard) free of session-loading states.
//
// Role override (demo / dev only):
//   The header dropdown lets admins switch the *displayed* role for screen-
//   recording demos. It is gated by:
//     1. process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === 'true'    (build flag)
//     2. initialIdentity.role === 'admin'                           (real role)
//   The override only changes UI display. The session JWT is unchanged, so
//   server-side route guards (middleware, requireAuth, route handlers) keep
//   enforcing the user's true role.

import { createContext, useContext, useState, useMemo, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ROLE_LABELS } from '@/lib/constants'
import type { UserRole } from '@/lib/types'
import type { Identity, IdentityProgramMembership } from '@/lib/identity'

const ALL_ROLES: UserRole[] = [
  'resident',
  'faculty',
  'program_director',
  'admin',
  'external_learner',
]

const ROLE_SWITCHER_FLAG = process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === 'true'

interface RoleContextValue {
  /** Always the real authenticated user. Never spoofed. */
  currentUser: Identity
  /** Effective role for UI display — may differ from currentUser.role when an admin is impersonating. */
  currentRole: UserRole
  /** Real role from the session JWT. Use this for any UI that must reflect ground truth (audit headers, etc.). */
  realRole: UserRole
  /** True when the current user is viewing the UI as a different role for demo purposes. */
  isImpersonating: boolean
  /**
   * Switch the displayed role. No-op unless the user is an admin AND the
   * NEXT_PUBLIC_ENABLE_ROLE_SWITCHER build flag is set. Server routes are
   * never affected — this only re-renders the client shell.
   */
  switchRole: (role: UserRole) => void
  /** Reset the displayed role back to the real role. */
  resetRole: () => void
  /**
   * Roles available in the switcher dropdown.
   * Empty array (= dropdown hidden) for non-admins or when the flag is off.
   */
  allRoles: UserRole[]
  /** Localized label for the effective role. */
  roleLabel: string

  // ─── W6.11 program switcher ────────────────────────────────────────────────
  /** Programs the user is a member of. Empty array if the switcher should hide. */
  programs: IdentityProgramMembership[]
  /** Currently selected program id, or null if the user has no memberships. */
  activeProgramId: string | null
  /** Convenience: full active membership object, or null. */
  activeProgram: IdentityProgramMembership | null
  /**
   * Switch the active program. POSTs to /api/me/active-program (which validates
   * membership server-side) and on success calls router.refresh() so the
   * (platform) layout re-reads activeProgramId from the DB.
   */
  switchProgram: (programId: string) => Promise<void>
  /** True while a switch is in flight. */
  switchingProgram: boolean
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined)

interface RoleProviderProps {
  children: ReactNode
  initialIdentity: Identity
}

export function RoleProvider({ children, initialIdentity }: RoleProviderProps) {
  const realRole = initialIdentity.role
  const canSwitch = ROLE_SWITCHER_FLAG && realRole === 'admin'
  const router = useRouter()

  const [overrideRole, setOverrideRole] = useState<UserRole | null>(null)
  const [switchingProgram, setSwitchingProgram] = useState(false)

  // W6.11: real switch — POST to validate, then refresh so the (platform)
  // layout re-renders with the new activeProgramId. Membership list comes
  // from the JWT and rarely changes, so we don't refetch it here.
  //
  // CSRF: middleware sets a `vaidix-csrf` non-httpOnly cookie; we echo it
  // into the `x-csrf-token` header (HARDENING-PLAN #15 / api-helpers
  // requireCsrf). Same pattern as objectives-checklist / study-pack-curator.
  const switchProgram = useCallback(
    async (programId: string) => {
      if (programId === initialIdentity.activeProgramId) return
      setSwitchingProgram(true)
      try {
        // Bootstrap CSRF if the cookie isn't there yet (first action of the
        // session before any other mutation has fired). GET /api/csrf is the
        // canonical bootstrap endpoint — public, sets `vaidix-csrf` cookie.
        let csrfMatch = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
        if (!csrfMatch) {
          await fetch('/api/csrf', { credentials: 'include', cache: 'no-store' })
          csrfMatch = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
        }
        const csrf = csrfMatch ? decodeURIComponent(csrfMatch[1]) : ''
        const res = await fetch('/api/me/active-program', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrf,
          },
          credentials: 'include',
          body: JSON.stringify({ programId }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: { message: 'Switch failed' } }))
          throw new Error(error?.message ?? 'Switch failed')
        }
        // The server is the source of truth — the layout reads users.activeProgramId
        // straight from the DB on each render, so router.refresh() is enough.
        router.refresh()
      } finally {
        setSwitchingProgram(false)
      }
    },
    [initialIdentity.activeProgramId, router],
  )

  const value = useMemo<RoleContextValue>(() => {
    const effectiveRole = canSwitch && overrideRole ? overrideRole : realRole
    const activeProgram =
      initialIdentity.programs.find((p) => p.programId === initialIdentity.activeProgramId) ?? null
    return {
      currentUser: initialIdentity,
      currentRole: effectiveRole,
      realRole,
      isImpersonating: canSwitch && overrideRole != null && overrideRole !== realRole,
      switchRole: (next: UserRole) => {
        if (!canSwitch) return
        setOverrideRole(next === realRole ? null : next)
      },
      resetRole: () => setOverrideRole(null),
      allRoles: canSwitch ? ALL_ROLES : [],
      roleLabel: ROLE_LABELS[effectiveRole],
      programs: initialIdentity.programs,
      activeProgramId: initialIdentity.activeProgramId,
      activeProgram,
      switchProgram,
      switchingProgram,
    }
  }, [initialIdentity, realRole, overrideRole, canSwitch, switchProgram, switchingProgram])

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole() {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used within RoleProvider')
  return ctx
}
