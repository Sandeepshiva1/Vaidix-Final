import { redirect } from 'next/navigation'
import { BarChart3, Users, Video, Calendar, FlaskConical } from 'lucide-react'
import { CohortStatus, Role, SessionStatus } from '@prisma/client'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageTransition, StaggerItem } from '@/lib/motion'

export default async function CohortAnalyticsPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== Role.FACULTY && session.user.role !== Role.PROGRAM_DIRECTOR) {
    redirect('/dashboard')
  }

  const now = new Date()
  // eslint-disable-next-line react-hooks/purity -- async Server Component runs once per request on the server, not during a client render — wall-clock reads are deterministic for that render
  const past90 = new Date(Date.now() - 90 * 24 * 3600 * 1000)

  const [cohorts, totalResidents, totalActiveResidents, sessionsLast90, attendanceCount] = await Promise.all([
    db.cohort.findMany({
      where: { deletedAt: null, status: CohortStatus.ACTIVE },
      select: {
        id: true,
        name: true,
        academicYear: true,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.user.count({ where: { role: Role.RESIDENT, deletedAt: null } }),
    db.user.count({ where: { role: Role.RESIDENT, deletedAt: null, status: 'ACTIVE' } }),
    db.teachingSession.count({
      where: {
        deletedAt: null,
        scheduledStart: { gte: past90, lte: now },
        status: { in: [SessionStatus.LIVE, SessionStatus.ENDED] },
      },
    }),
    db.sessionParticipant.count({
      where: {
        joinedAt: { gte: past90, lte: now },
        user: { role: Role.RESIDENT },
      },
    }),
  ])

  const avgAttendancePerSession =
    sessionsLast90 > 0 ? (attendanceCount / sessionsLast90).toFixed(1) : '—'

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <StaggerItem>
        <div className="flex items-center gap-2">
          <BarChart3 className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Cohort Analytics</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Engagement across all active cohorts. DOPS / EPA / 3H scoring lands in Week 8.
        </p>
      </StaggerItem>

      <StaggerItem>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Users} label="Student learners" value={totalResidents} sub={`${totalActiveResidents} active`} accent="bg-teal-500/10 text-teal-600" />
          <Stat icon={Users} label="Active cohorts" value={cohorts.length} accent="bg-violet-500/10 text-violet-600" />
          <Stat icon={Video} label="Sessions (90d)" value={sessionsLast90} accent="bg-rose-500/10 text-rose-600" />
          <Stat icon={Calendar} label="Avg attendance / session" value={avgAttendancePerSession} accent="bg-amber-500/10 text-amber-600" />
        </div>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cohorts</CardTitle>
          </CardHeader>
          <CardContent>
            {cohorts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active cohorts. Create one in <span className="font-medium">Admin → Cohorts</span>.</p>
            ) : (
              <ul className="space-y-2">
                {cohorts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      {c.academicYear && (
                        <div className="text-xs text-muted-foreground">Academic year {c.academicYear}</div>
                      )}
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {c._count.members} {c._count.members === 1 ? 'learner' : 'learners'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 pt-6">
            <FlaskConical className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-medium">3H (Head/Heart/Hands) and Oslerian principle averages — coming Week 8.</p>
              <p className="mt-1 text-muted-foreground">
                Scoring infrastructure (DOPS, Mini-CEX, EPA records, ScoringEvent log) ships in Week 8 per <span className="font-medium">VAIDIX-BUILD-PLAN-NOW.md</span>. This widget will populate automatically when the first scoring events land.
              </p>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>
    </PageTransition>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  accent: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
          {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  )
}
