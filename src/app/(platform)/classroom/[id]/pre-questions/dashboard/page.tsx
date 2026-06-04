// W6 — /classroom/[id]/pre-questions/dashboard: presenter view (host/PD/admin)
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { PreQuestionsDashboard } from '@/components/classroom/pre-questions-dashboard';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = 'force-dynamic';

export default async function PreQuestionsDashboardPage({ params }: PageProps) {
  const [{ id: sessionId }, session] = await Promise.all([params, auth()]);
  if (!session?.user) redirect(`/login?next=/classroom/${sessionId}/pre-questions/dashboard`);

  const teaching = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, hostId: true },
  });
  if (!teaching) notFound();

  const canView =
    session.user.role === Role.ADMIN ||
    session.user.role === Role.PROGRAM_DIRECTOR ||
    teaching.hostId === session.user.id;

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Presenter dashboard · Pre-Conference Questions
        </p>
        <h1 className="text-2xl font-semibold">{teaching.title}</h1>
        <p className="text-sm">
          <Link
            href={`/classroom/${sessionId}/pre-questions`}
            className="text-primary hover:underline"
          >
            ← Back to question board
          </Link>
        </p>
      </header>

      <PreQuestionsDashboard sessionId={sessionId} canViewDashboard={canView} />
    </div>
  );
}
