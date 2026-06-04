'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Search, UserPlus, Pencil, UserX, UserCheck, Loader2 } from 'lucide-react'
import { Role, UserStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageTransition, StaggerItem, motion, staggerContainer, staggerItem } from '@/lib/motion'
import { ROLE_LABELS } from '@/lib/constants'
import { mapPrismaRoleToUserRole } from '@/lib/identity'
import { InviteModal } from '../invitations/_components/invite-modal'
import { EditUserModal } from './edit-user-modal'

export interface AdminUserRow {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  avatarUrl: string | null
  lastLoginAt: string | null
  lockedUntil: string | null
  createdAt: string
}

const ROLE_BADGE: Record<Role, string> = {
  RESIDENT: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  FACULTY: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  PROGRAM_DIRECTOR: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ADMIN: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  EXTERNAL_LEARNER: 'bg-slate-500/10 text-slate-700 dark:text-slate-400',
}

const STATUS_BADGE: Record<UserStatus, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  PENDING_INVITE: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  SUSPENDED: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  DEACTIVATED: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
}

interface Props {
  initialUsers: AdminUserRow[]
  currentUserId: string
}

export function UsersClient({ initialUsers, currentUserId }: Props) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUserRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return initialUsers
    const q = searchQuery.toLowerCase()
    return initialUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    )
  }, [initialUsers, searchQuery])

  async function changeStatus(user: AdminUserRow, newStatus: 'ACTIVE' | 'DEACTIVATED') {
    if (user.id === currentUserId) {
      alert('You cannot disable your own admin account.')
      return
    }
    const verb = newStatus === 'DEACTIVATED' ? 'deactivate' : 'reactivate'
    if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} ${user.name}?`)) return

    setBusyId(user.id)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        alert(body?.error?.message ?? `Failed to ${verb} user`)
        return
      }
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <PageTransition className="space-y-6">
      <StaggerItem>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          </div>
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4 mr-1.5" />
            Add User
          </Button>
        </div>
      </StaggerItem>

      <StaggerItem>
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      </StaggerItem>

      <StaggerItem>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last login</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <motion.tbody initial="hidden" animate="visible" variants={staggerContainer}>
              {filteredUsers.map((user, index) => {
                const isSelf = user.id === currentUserId
                const isDisabled = user.status === 'DEACTIVATED' || user.status === 'SUSPENDED'
                return (
                  <motion.tr
                    key={user.id}
                    variants={staggerItem}
                    className={`border-b last:border-0 ${index % 2 === 1 ? 'bg-muted/20' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium">
                      {user.name}
                      {isSelf && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE[user.role]}`}>
                        {ROLE_LABELS[mapPrismaRoleToUserRole(user.role)]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[user.status]}`}>
                        {user.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0"
                          aria-label="Edit user"
                          onClick={() => setEditing(user)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        {isDisabled ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 text-emerald-600 hover:text-emerald-700"
                            aria-label="Reactivate user"
                            disabled={isSelf || busyId === user.id}
                            onClick={() => changeStatus(user, 'ACTIVE')}
                          >
                            {busyId === user.id ? <Loader2 className="size-3.5 animate-spin" /> : <UserCheck className="size-3.5" />}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0 text-destructive hover:text-destructive"
                            aria-label="Deactivate user"
                            disabled={isSelf || busyId === user.id}
                            onClick={() => changeStatus(user, 'DEACTIVATED')}
                          >
                            {busyId === user.id ? <Loader2 className="size-3.5 animate-spin" /> : <UserX className="size-3.5" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                )
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {initialUsers.length === 0 ? 'No users yet. Click "Add User" to invite the first one.' : 'No users match your search.'}
                  </td>
                </tr>
              )}
            </motion.tbody>
          </table>
        </div>
      </StaggerItem>

      <StaggerItem>
        <p className="text-xs text-muted-foreground">
          Showing {filteredUsers.length} of {initialUsers.length} users
        </p>
      </StaggerItem>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => {
          setInviteOpen(false)
          setToast({ kind: 'success', msg: 'Invitation sent' })
          router.refresh()
        }}
      />

      {editing && (
        <EditUserModal
          user={editing}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setToast({ kind: 'success', msg: 'User updated' })
            router.refresh()
          }}
        />
      )}

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`fixed bottom-6 right-6 z-60 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.msg}
        </motion.div>
      )}
    </PageTransition>
  )
}
