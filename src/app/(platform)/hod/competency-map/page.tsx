import { redirect } from 'next/navigation'
import { Map, FlaskConical, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { Role } from '@prisma/client'
import { auth } from '@/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EPA_LIST, ENTRUSTMENT_LEVELS } from '@/lib/constants'
import { PageTransition, StaggerItem } from '@/lib/motion'

export default async function CompetencyMapPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')
  if (session.user.role !== Role.PROGRAM_DIRECTOR && session.user.role !== Role.ADMIN) {
    redirect('/dashboard')
  }

  return (
    <PageTransition className="mx-auto max-w-6xl space-y-6">
      <StaggerItem>
        <div className="flex items-center gap-2">
          <Map className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Competency Map</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Student × EPA entrustment heatmap. Populates from real DOPS / Mini-CEX / EPA records.
        </p>
      </StaggerItem>

      <StaggerItem>
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 pt-6">
            <FlaskConical className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-medium">Not yet available.</p>
              <p className="mt-1 text-muted-foreground">
                The competency heatmap reads from the <span className="font-medium">EpaRecord</span> + <span className="font-medium">DopsAssessment</span> + <span className="font-medium">MiniCexAssessment</span> tables. Those tables exist in the schema but no records have been written yet — DOPS / Mini-CEX assessment forms are not yet wired. This page will populate automatically once the first assessments land.
              </p>
              <Link
                href="/calendar/new"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Schedule an assessment session in the meantime
                <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">EPAs ({EPA_LIST.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {EPA_LIST.map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary/40" />
                    <span><span className="font-medium">EPA {e.id}.</span> {e.title}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entrustment scale</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {ENTRUSTMENT_LEVELS.map((l) => (
                  <li key={l.level} className="flex items-center gap-3">
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: l.color }}
                    >
                      {l.level}
                    </span>
                    <span>{l.label}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </StaggerItem>
    </PageTransition>
  )
}
