import { redirect } from 'next/navigation'

export default function PendingUsersPage() {
  redirect('/admin/invitations?status=PENDING')
}
