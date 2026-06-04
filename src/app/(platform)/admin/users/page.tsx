import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role } from '@prisma/client'
import { listUsers } from '@/server/services/user-admin-service'
import { UsersClient } from './users-client'

export default async function UserManagementPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== Role.ADMIN) redirect('/dashboard')

  const { users } = await listUsers({ limit: 100 })

  // Convert Date columns to ISO strings so the data can cross the
  // server/client boundary without serialization warnings.
  const initialUsers = users.map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }))

  return <UsersClient initialUsers={initialUsers} currentUserId={session.user.id} />
}
