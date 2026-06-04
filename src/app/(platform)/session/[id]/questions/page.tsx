import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Role } from '@prisma/client'
import { loadSessionView } from '@/lib/medlearn/session-view'
import {
  listQuestions,
  getDashboard,
  type PreQuestionView,
  type DashboardResult,
} from '@/server/services/pre-questions/pre-questions-service'
import { QuestionsClient } from './questions-client'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

const EMPTY_DASHBOARD: DashboardResult = {
  totalQuestions: 0,
  themesGeneratedAt: null,
  topThemes: [],
  unthemedCount: 0,
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function QuestionsPage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/questions`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  // Reviewing incoming questions is host / faculty-only.
  const isHost = view.hostId === session.user.id
  if (!isHost && !FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard')

  // Real pre-questions data. Both calls are visibility-/host-guarded inside the
  // service; we already gated above, but guard with try/catch so a service
  // throw degrades to honest-empty rather than crashing the page.
  const actor = { userId: session.user.id, role: session.user.role }
  let questions: PreQuestionView[] = []
  let dashboard: DashboardResult = EMPTY_DASHBOARD
  try {
    ;[questions, dashboard] = await Promise.all([
      listQuestions(actor, id),
      getDashboard(actor, id),
    ])
  } catch {
    questions = []
    dashboard = EMPTY_DASHBOARD
  }

  return <QuestionsClient session={view} questions={questions} dashboard={dashboard} />
}
