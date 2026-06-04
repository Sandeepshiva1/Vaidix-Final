import { redirect } from 'next/navigation'
import { Users, Eye } from 'lucide-react'
import { ConversationStatus, Role } from '@prisma/client'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { PageTransition, StaggerItem } from '@/lib/motion'
import { LearnerSearch } from './learner-search'

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((p) => !p.startsWith('Dr.'))
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

interface PageProps {
  searchParams: Promise<{ q?: string }>
}

export default async function LearnersPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== Role.FACULTY && session.user.role !== Role.PROGRAM_DIRECTOR) {
    redirect('/dashboard')
  }

  const params = await searchParams
  const search = params.q?.trim() ?? ''

  const residents = await db.user.findMany({
    where: {
      role: Role.RESIDENT,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      lastLoginAt: true,
      profile: { select: { subspecialty: true, yearOfResidency: true } },
      cohortMemberships: {
        where: { cohort: { deletedAt: null } },
        select: { cohort: { select: { id: true, name: true } } },
      },
      _count: {
        select: {
          sessionParticipations: true,
          conversations: { where: { status: ConversationStatus.COMPLETED } },
        },
      },
    },
    orderBy: { name: 'asc' },
    take: 100,
  })

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <StaggerItem>
        <div>
          <div className="flex items-center gap-2">
            <Users className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Learners</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time view of student engagement. DOPS / 3H scoring is coming soon.
          </p>
        </div>
      </StaggerItem>

      <StaggerItem>
        <LearnerSearch initialQuery={search} />
      </StaggerItem>

      <StaggerItem>
        {residents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-16 text-muted-foreground">
            <Users className="mb-3 size-10 opacity-40" />
            <p className="text-sm">
              {search ? 'No learners match your search.' : 'No students have been invited yet.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {residents.map((r) => {
              const yearLabel = r.profile?.yearOfResidency != null ? `PGY-${r.profile.yearOfResidency}` : null
              const cohort = r.cohortMemberships[0]?.cohort
              return (
                <Card key={r.id} className="transition-shadow duration-200 hover:shadow-lg hover:shadow-primary/5">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <Avatar size="lg" className="size-12">
                        <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                          {getInitials(r.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">{r.name}</h3>
                          {yearLabel && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">
                              {yearLabel}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.profile?.subspecialty ?? 'Subspecialty not set'}
                        </p>
                        {cohort && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Cohort: <span className="font-medium text-foreground">{cohort.name}</span>
                          </p>
                        )}

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-md border bg-muted/30 px-2.5 py-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sessions joined</div>
                            <div className="text-sm font-semibold tabular-nums">{r._count.sessionParticipations}</div>
                          </div>
                          <div className="rounded-md border bg-muted/30 px-2.5 py-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cases completed</div>
                            <div className="text-sm font-semibold tabular-nums">{r._count.conversations}</div>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            Last login:{' '}
                            {r.lastLoginAt
                              ? new Date(r.lastLoginAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                              : '—'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-muted-foreground/70">
                            <Eye className="size-3" />
                            View Profile
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </StaggerItem>
    </PageTransition>
  )
}
