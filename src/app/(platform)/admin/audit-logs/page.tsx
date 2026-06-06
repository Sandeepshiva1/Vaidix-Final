import { redirect } from 'next/navigation'
import { Prisma, Role } from '@prisma/client'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { AuditLogsClient, type AuditRow, type EventOption } from './audit-logs-client'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 200

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; user?: string; action?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?next=/admin/audit-logs')
  // Audit trail is admin-only.
  if (session.user.role !== Role.ADMIN) redirect('/dashboard')

  const sp = await searchParams
  const from = sp.from?.trim() || ''
  const to = sp.to?.trim() || ''
  const userQ = sp.user?.trim() || ''
  const action = sp.action?.trim() || ''

  // Build the DB filter from the URL. All filtering happens server-side so the
  // page reflects the full audit table, not just a client-held slice.
  const where: Prisma.AuditEventWhereInput = {}
  if (action) where.eventType = action
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00.000`)
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999`)
  }
  if (userQ) {
    where.actor = {
      is: {
        OR: [
          { name: { contains: userQ, mode: 'insensitive' } },
          { email: { contains: userQ, mode: 'insensitive' } },
        ],
      },
    }
  }

  const [rows, grouped, total] = await Promise.all([
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        eventType: true,
        summary: true,
        ipAddress: true,
        success: true,
        actorRole: true,
        actor: { select: { name: true, email: true } },
      },
    }),
    // Distinct event types present in the table → the "respective event" filter
    // options, with counts so the operator sees what's actually been recorded.
    db.auditEvent.groupBy({
      by: ['eventType'],
      _count: { _all: true },
      orderBy: { eventType: 'asc' },
    }),
    db.auditEvent.count({ where }),
  ])

  const events: AuditRow[] = rows.map((r) => ({
    id: r.id,
    timestamp: r.createdAt.toISOString(),
    user: r.actor?.name ?? r.actor?.email ?? 'System',
    actorRole: r.actorRole ?? null,
    eventType: r.eventType,
    details: r.summary ?? '',
    ip: r.ipAddress ?? '—',
    success: r.success,
  }))

  const eventOptions: EventOption[] = grouped.map((g) => ({
    value: g.eventType,
    count: g._count._all,
  }))

  return (
    <AuditLogsClient
      events={events}
      eventOptions={eventOptions}
      total={total}
      pageSize={PAGE_SIZE}
      initialFilters={{ from, to, user: userQ, action }}
    />
  )
}
