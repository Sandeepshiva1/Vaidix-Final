import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Role, CohortStatus } from '@prisma/client'
import {
  CalendarDays, Users, Sparkles, ArrowRight, BookOpen, Globe,
} from 'lucide-react'
import { NewSessionForm } from './new-session-form'

interface PageProps {
  searchParams: Promise<{ start?: string; end?: string }>
}

export default async function NewSessionPage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (
    session.user.role !== Role.PROGRAM_DIRECTOR &&
    session.user.role !== Role.ADMIN &&
    session.user.role !== Role.FACULTY &&
    session.user.role !== Role.RESIDENT
  ) {
    redirect('/calendar')
  }

  const params = await searchParams

  const [facultyList, currentUser, cohorts, topics] = await Promise.all([
    db.user.findMany({
      where: { role: { in: [Role.FACULTY, Role.PROGRAM_DIRECTOR] }, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    }),
    // Residents need themselves in the host list so the picker shows a "host
    // myself" option alongside faculty. Faculty/PD already appear in the list
    // above; this lookup just covers RESIDENT.
    session.user.role === Role.RESIDENT
      ? db.user.findUnique({
          where: { id: session.user.id },
          select: { id: true, name: true, email: true, role: true },
        })
      : Promise.resolve(null),
    db.cohort.findMany({
      where: { status: CohortStatus.ACTIVE, deletedAt: null },
      select: { id: true, name: true, _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.topic.findMany({
      select: { id: true, name: true, subspecialty: true },
      orderBy: [{ subspecialty: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    }),
  ])

  // Resident proposers can host themselves (peer-led, auto-approves) or pick a
  // faculty member (PENDING_FACULTY). Putting the resident at the top of the
  // list makes self-host the natural default.
  const faculty = currentUser ? [currentUser, ...facultyList] : facultyList
  const isResident = session.user.role === Role.RESIDENT

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-teal-500/15 via-blue-500/10 to-transparent border border-teal-500/20 px-6 py-5">
        <div className="absolute -right-8 -top-8 size-40 rounded-full bg-teal-400/10 blur-2xl pointer-events-none" />
        <div className="absolute right-20 bottom-0 size-24 rounded-full bg-blue-400/10 blur-xl pointer-events-none" />
        <div className="relative flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-teal-500 to-blue-600 shadow-lg shadow-teal-500/30">
            <CalendarDays className="size-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Schedule Session</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isResident
                ? 'Host it yourself for a peer-led session, or pick a teacher to host — they’ll get an approval request first.'
                : 'Pick a teacher to host — they get an approval request, then it appears on attendee calendars.'}
            </p>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        {/* Form */}
        <div>
          <NewSessionForm
            faculty={faculty}
            cohorts={cohorts.map((c) => ({ id: c.id, name: c.name, memberCount: c._count.members }))}
            topics={topics}
            defaultStart={params.start}
            defaultEnd={params.end}
            currentUserId={session.user.id}
            currentUserRole={session.user.role}
          />
        </div>

        {/* Sticky info panel */}
        <aside className="hidden xl:block">
          <div className="sticky top-4 space-y-4">
            {/* What happens next */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <Sparkles className="size-4 text-teal-500" />
                What happens next
              </h3>
              <ol className="space-y-3">
                {[
                  { label: 'Teacher gets notified', desc: 'An email + in-app approval request is sent immediately.' },
                  { label: 'Host approves', desc: 'One click — session moves to Published.' },
                  { label: 'Calendars update', desc: 'Attendees see it on their Calendar.' },
                  { label: 'Reminders go out', desc: '24 h and 1 h before the session starts.' },
                ].map(({ label, desc }, i) => (
                  <li key={label} className="flex gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-xs font-bold text-teal-600">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Tips */}
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <BookOpen className="size-4 text-blue-500" />
                Session tips
              </h3>
              <ul className="space-y-2">
                {[
                  'Add a description with learning objectives so students can prep.',
                  'Use recurrence for weekly Grand Rounds — one setup, 8+ sessions.',
                  'Invite-only is perfect for small group case discussions.',
                  'Generate a share link to include external guests.',
                ].map((tip) => (
                  <li key={tip} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ArrowRight className="mt-0.5 size-3 shrink-0 text-teal-500" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            {/* Visibility quick guide */}
            <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                <Globe className="size-3.5" />
                Visibility guide
              </h3>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p><span className="font-semibold text-foreground">Anyone with link</span> — share the URL and people can join. Doesn’t hit everyone’s calendar.</p>
                <p><span className="font-semibold text-foreground">Cohort</span> — batch-year or specialty-specific sessions; appears on members’ calendars.</p>
                <p><span className="font-semibold text-foreground">Invite only</span> — targeted small groups, mentoring sessions.</p>
                <p><span className="font-semibold text-foreground">Private</span> — host-only planning or draft sessions.</p>
              </div>
            </div>

            {/* Stats badge */}
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
              <Users className="size-8 text-teal-500/60" />
              <div>
                <p className="text-sm font-bold text-foreground">{faculty.length} teacher{faculty.length === 1 ? '' : 's'} available</p>
                <p className="text-xs text-muted-foreground">{cohorts.length} active cohort{cohorts.length !== 1 ? 's' : ''} to target</p>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
