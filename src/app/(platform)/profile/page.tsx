import { redirect } from 'next/navigation'
import { Mail, Phone, AtSign, ShieldCheck, Calendar, GraduationCap, Building2, Languages, Globe, Lock, Bookmark, ArrowRight, Brain } from 'lucide-react'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { ROLE_LABELS } from '@/lib/constants'
import { mapPrismaRoleToUserRole } from '@/lib/identity'
import { PageTransition, StaggerItem } from '@/lib/motion'
import Link from 'next/link'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((p) => !p.startsWith('Dr.'))
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      profile: true,
      preferences: true,
      stats: true,
      _count: { select: { bookmarks: true } },
    },
  })
  if (!user) redirect('/login')

  const role = mapPrismaRoleToUserRole(user.role)
  const yearOfTraining =
    user.profile?.yearOfResidency != null ? `PGY-${user.profile.yearOfResidency}` : null

  const primaryFacts = [
    { icon: Mail, label: 'Email', value: user.email },
    user.username ? { icon: AtSign, label: 'Username', value: user.username } : null,
    user.mobile ? { icon: Phone, label: 'Mobile', value: user.mobile } : null,
  ].filter((x): x is { icon: typeof Mail; label: string; value: string } => x != null)

  const profileFacts = [
    user.profile?.subspecialty
      ? { icon: GraduationCap, label: 'Subspecialty', value: user.profile.subspecialty }
      : null,
    user.profile?.affiliation
      ? { icon: Building2, label: 'Affiliation', value: user.profile.affiliation }
      : null,
    yearOfTraining
      ? { icon: GraduationCap, label: 'Year of training', value: yearOfTraining }
      : null,
    user.profile?.mciRegNumber
      ? { icon: ShieldCheck, label: 'MCI registration', value: user.profile.mciRegNumber }
      : null,
    user.profile?.languages?.length
      ? { icon: Languages, label: 'Languages', value: user.profile.languages.join(', ') }
      : null,
    user.profile?.timezone
      ? { icon: Globe, label: 'Timezone', value: user.profile.timezone }
      : null,
  ].filter((x): x is { icon: typeof GraduationCap; label: string; value: string } => x != null)

  return (
    <PageTransition className="space-y-6">
      <StaggerItem>
        <Card>
          <CardContent className="flex flex-col items-start gap-4 pt-6 sm:flex-row sm:items-center">
            <Avatar size="lg" className="ring-2 ring-primary/20">
              <AvatarFallback className="bg-linear-to-br from-teal-500 to-blue-600 text-base font-semibold text-white">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h1 className="text-xl font-bold tracking-tight">{user.name}</h1>
              <p className="text-sm text-muted-foreground">{ROLE_LABELS[role]}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5">
                  <span className={`size-1.5 rounded-full ${user.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  {user.status.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="size-3" />
                  Joined {new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                {user.lastLoginAt && (
                  <span>
                    · Last login {new Date(user.lastLoginAt).toLocaleString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {primaryFacts.map((f) => {
                const Icon = f.icon
                return (
                  <div key={f.label} className="flex items-start gap-3 text-sm">
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</div>
                      <div className="truncate font-medium">{f.value}</div>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {profileFacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No profile details set yet.</p>
              ) : (
                profileFacts.map((f) => {
                  const Icon = f.icon
                  return (
                    <div key={f.label} className="flex items-start gap-3 text-sm">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{f.label}</div>
                        <div className="truncate font-medium">{f.value}</div>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </StaggerItem>

      {user.profile?.bio && (
        <StaggerItem>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bio</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{user.profile.bio}</p>
            </CardContent>
          </Card>
        </StaggerItem>
      )}

      <StaggerItem>
        <Link
          href="/profile/bookmarks"
          className="group flex items-center justify-between rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-border/80 hover:shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
              <Bookmark className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold">Saved items</div>
              <div className="text-xs text-muted-foreground">
                {user._count.bookmarks} {user._count.bookmarks === 1 ? 'bookmark' : 'bookmarks'}
              </div>
            </div>
          </div>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      </StaggerItem>

      {(user.role === 'FACULTY' || user.role === 'PROGRAM_DIRECTOR' || user.role === 'ADMIN') && (
        <StaggerItem>
          <Link
            href="/profile/style"
            data-testid="link-style-profile"
            className="group flex items-center justify-between rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-border/80 hover:shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Brain className="size-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">AI style memory</div>
                <div className="text-xs text-muted-foreground">
                  Rules the AI uses to match your teaching style on new decks
                </div>
              </div>
            </div>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </StaggerItem>
      )}

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4 text-muted-foreground" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Password</span>
              <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                Reset password
              </Link>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email verified</span>
              <span className="text-xs">{user.emailVerifiedAt ? 'Yes' : 'No'}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Failed login attempts</span>
              <span className="text-xs tabular-nums">{user.failedLoginCount}</span>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>
    </PageTransition>
  )
}
