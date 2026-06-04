import { redirect } from 'next/navigation'
import { Building2, Mail, MapPin, Phone, Users, UsersRound, Video, Database, Lock } from 'lucide-react'
import { Role, UserStatus } from '@prisma/client'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ROLE_LABELS } from '@/lib/constants'
import { mapPrismaRoleToUserRole } from '@/lib/identity'
import { PageTransition, StaggerItem } from '@/lib/motion'

// Single-tenant deploy at LVPEI — institution metadata is fixed at deploy
// time, not editable from the UI. If multi-tenancy is ever in scope, an
// `Institution` model + tenant-scoped queries land first; this page becomes
// editable then.
const INSTITUTION = {
  name: 'L V Prasad Eye Institute',
  city: 'Hyderabad',
  state: 'Telangana',
  country: 'India',
  email: 'admin@lvpei.org',
  phone: '+91 40 3061 2345',
  address: 'Kallam Anji Reddy Campus, L V Prasad Marg, Banjara Hills, Hyderabad, Telangana 500034',
  departments: [
    'Cornea & Anterior Segment',
    'Vitreoretinal Surgery',
    'Glaucoma',
    'Pediatric Ophthalmology & Strabismus',
    'Uveitis & Ocular Immunology',
    'Oculoplasty & Orbit',
    'Neuro-Ophthalmology',
    'Ocular Oncology',
  ],
} as const

export default async function InstitutionPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== Role.ADMIN) redirect('/dashboard')

  const [usersByRole, totalUsers, activeUsers, cohortCount, sessionCount] = await Promise.all([
    db.user.groupBy({
      by: ['role'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { deletedAt: null, status: UserStatus.ACTIVE } }),
    db.cohort.count({ where: { deletedAt: null } }),
    db.teachingSession.count({ where: { deletedAt: null } }),
  ])

  const roleCounts = new Map<Role, number>(usersByRole.map((r) => [r.role, r._count._all]))

  const stats = [
    { label: 'Total users', value: totalUsers, icon: Users, color: 'text-teal-600 bg-teal-500/10' },
    { label: 'Active users', value: activeUsers, icon: Users, color: 'text-emerald-600 bg-emerald-500/10' },
    { label: 'Cohorts', value: cohortCount, icon: UsersRound, color: 'text-violet-600 bg-violet-500/10' },
    { label: 'Sessions', value: sessionCount, icon: Video, color: 'text-rose-600 bg-rose-500/10' },
  ]

  return (
    <PageTransition className="space-y-6">
      <StaggerItem>
        <div className="flex items-center gap-2">
          <Building2 className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Institution</h1>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" />
          Single-tenant deploy. Institution metadata is configured at deploy time.
        </p>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{INSTITUTION.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <div>
                  <div className="font-medium text-foreground">
                    {INSTITUTION.city}, {INSTITUTION.state}
                  </div>
                  <div className="text-xs">{INSTITUTION.country}</div>
                </div>
              </div>
              <div className="flex items-start gap-2 text-muted-foreground">
                <Mail className="mt-0.5 size-4 shrink-0" />
                <div>
                  <div className="font-medium text-foreground">{INSTITUTION.email}</div>
                  <div className="text-xs flex items-center gap-1.5"><Phone className="size-3" /> {INSTITUTION.phone}</div>
                </div>
              </div>
            </div>
            <Separator />
            <div className="text-muted-foreground">
              <div className="text-xs font-medium uppercase tracking-wide text-foreground">Address</div>
              <p className="mt-1">{INSTITUTION.address}</p>
            </div>
            <Separator />
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-foreground">Departments</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {INSTITUTION.departments.map((d) => (
                  <span key={d} className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon
            return (
              <Card key={s.label}>
                <CardContent className="flex items-center gap-3 pt-6">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${s.color}`}>
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold tabular-nums">{s.value}</div>
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="size-4 text-muted-foreground" />
              Users by role
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {([Role.RESIDENT, Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN, Role.EXTERNAL_LEARNER] as const).map((role) => (
                <div key={role} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
                  <span className="text-sm">{ROLE_LABELS[mapPrismaRoleToUserRole(role)]}</span>
                  <span className="text-sm font-semibold tabular-nums">{roleCounts.get(role) ?? 0}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </StaggerItem>
    </PageTransition>
  )
}
