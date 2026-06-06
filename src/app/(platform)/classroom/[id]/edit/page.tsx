import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Role, CohortStatus, SessionStatus, SessionType } from '@prisma/client'
import { NewSessionWizard, type ClassroomEditInit } from '@/app/(platform)/sessions/new/new-session-wizard'
import type { PickableUser } from '@/components/user-picker'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

// Map the stored SessionType enum back to the wizard's 4 classroom labels.
// (The classroom wizard only models these four; case-conference / journal-club /
//  assessment fall back to a teaching label.)
const SESSION_TYPE_LABEL: Record<SessionType, ClassroomEditInit['type']> = {
  LECTURE: 'Webinar',
  GRAND_ROUNDS: 'Grand Rounds',
  CASE_CONFERENCE: 'Clinical Teaching',
  JOURNAL_CLUB: 'Clinical Teaching',
  SKILLS_WORKSHOP: 'Simulation Session',
  ASSESSMENT: 'Clinical Teaching',
}

// Light RRULE parse → the wizard's recurrence shape (no rrule dep needed here).
function parseRecurrence(rule: string | null): ClassroomEditInit['recurrence'] {
  if (!rule) return null
  const get = (k: string) => new RegExp(`${k}=([^;]+)`).exec(rule)?.[1] ?? null
  const f = get('FREQ')
  const freq = f === 'DAILY' ? 'DAILY' : f === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY'
  const byDays = (get('BYDAY') ?? '').split(',').map((d) => d.trim()).filter(Boolean)
  const count = get('COUNT')
  const until = get('UNTIL')
  return {
    repeats: true,
    freq,
    every: Number(get('INTERVAL')) || 1,
    byDays: byDays.length > 0 ? byDays : ['MO'],
    endMode: count ? 'count' : until ? 'date' : 'never',
    count: count ? Number(count) : 8,
    until: until ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : '',
  }
}

export default async function EditSessionPage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user) redirect(`/login?next=/classroom/${id}/edit`)

  const s = await db.teachingSession.findUnique({
    where: { id },
    select: {
      id: true, title: true, description: true, sessionType: true, hostId: true, proposedBy: true,
      programId: true, status: true, deletedAt: true, scheduledStart: true, scheduledEnd: true,
      cohortId: true, metadata: true, recurrenceRule: true,
    },
  })
  if (!s || s.deletedAt) notFound()

  const canEdit =
    session.user.id === s.hostId ||
    session.user.id === s.proposedBy ||
    session.user.role === Role.ADMIN ||
    session.user.role === Role.PROGRAM_DIRECTOR
  if (!canEdit) redirect(`/classroom/${id}`)
  // Editable only until it starts — a LIVE/ended session is locked.
  if (s.status !== SessionStatus.SCHEDULED) redirect(`/classroom/${id}`)

  const [cohorts, specialtyRows] = await Promise.all([
    db.cohort.findMany({
      where: { programId: s.programId, status: CohortStatus.ACTIVE, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.specialty.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        subSpecialties: { orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } },
      },
    }),
  ])

  const meta = s.metadata && typeof s.metadata === 'object' && !Array.isArray(s.metadata)
    ? (s.metadata as Record<string, unknown>)
    : {}
  const specialty = typeof meta.specialty === 'string' ? meta.specialty : ''
  const subSpecialty = typeof meta.subSpecialty === 'string' ? meta.subSpecialty : ''
  const metaRoles = Array.isArray(meta.roles)
    ? (meta.roles as { role: string; userId: string; name?: string }[])
    : []

  // Hydrate role assignments into full PickableUser objects for the picker.
  const roleUserIds = metaRoles.map((r) => r.userId).filter(Boolean)
  const roleUsers = roleUserIds.length > 0
    ? await db.user.findMany({
        where: { id: { in: roleUserIds } },
        select: { id: true, name: true, email: true, role: true, avatarUrl: true },
      })
    : []
  const byId = new Map(roleUsers.map((u) => [u.id, u as PickableUser]))
  const roles = metaRoles.flatMap((r) => {
    const user = byId.get(r.userId)
    if (!user) return []
    const role = (['Presenter', 'Moderator', 'Panelist'].includes(r.role) ? r.role : 'Presenter') as
      | 'Presenter' | 'Moderator' | 'Panelist'
    return [{ role, user }]
  })

  const editing: ClassroomEditInit = {
    sessionId: s.id,
    title: s.title,
    specialty,
    subSpecialty,
    cohortId: s.cohortId ?? '',
    description: s.description ?? '',
    startAtISO: s.scheduledStart.toISOString(),
    durationMinutes: Math.max(15, Math.round((s.scheduledEnd.getTime() - s.scheduledStart.getTime()) / 60000)),
    type: SESSION_TYPE_LABEL[s.sessionType],
    roles,
    recurrence: parseRecurrence(s.recurrenceRule),
  }

  return <NewSessionWizard cohorts={cohorts} specialties={specialtyRows} editing={editing} />
}
