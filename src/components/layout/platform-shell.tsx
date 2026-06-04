'use client'

import type { ReactNode } from 'react'
import { RoleProvider } from '@/contexts/role-context'
import { WorkflowShell } from '@/components/layout/workflow-shell'
import type { Identity } from '@/lib/identity'

interface PlatformShellProps {
  children: ReactNode
  initialIdentity: Identity
}

/**
 * Client boundary for the (platform) layout. Holds the RoleProvider so deep
 * descendant client components keep access to the server-resolved identity,
 * then renders the WorkflowShell — the demo-faithful "Clinical Teaching OS"
 * chrome (WORKFLOW Pre/Live/Post + My Sessions / My Calendar / Active Learners
 * / Settings), wired to the real logged-in user and real routes.
 */
export function PlatformShell({ children, initialIdentity }: PlatformShellProps) {
  return (
    <RoleProvider initialIdentity={initialIdentity}>
      <WorkflowShell
        identity={{
          name: initialIdentity.name ?? initialIdentity.email,
          email: initialIdentity.email,
          role: initialIdentity.role,
          avatarUrl: initialIdentity.avatarUrl,
          specialization: initialIdentity.specialization,
        }}
      >
        {children}
      </WorkflowShell>
    </RoleProvider>
  )
}
