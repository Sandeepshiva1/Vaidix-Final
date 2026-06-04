// W6 — /classroom/[id]/pre-questions: resident-facing submit + vote board
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { PreQuestionsBoard } from '@/components/classroom/pre-questions-board';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = 'force-dynamic';

export default async function PreQuestionsPage({ params }: PageProps) {
  const [{ id: sessionId }, session] = await Promise.all([params, auth()]);
  if (!session?.user) redirect(`/login?next=/classroom/${sessionId}/pre-questions`);

  const teaching = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      scheduledStart: true,
      hostId: true,
      host: { select: { name: true } },
    },
  });
  if (!teaching) notFound();

  const canViewDashboard =
    session.user.role === Role.ADMIN ||
    session.user.role === Role.PROGRAM_DIRECTOR ||
    teaching.hostId === session.user.id;

  const dateStr = new Date(teaching.scheduledStart).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
  const timeStr = new Date(teaching.scheduledStart).toLocaleTimeString('en-IN', {
    hour: 'numeric', minute: '2-digit',
  })

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 space-y-5">
      {/* Compact header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/classroom/${sessionId}/study`}
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
            ← Study Hub
          </Link>
          <span className="text-muted-foreground/40">·</span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Pre-Conference Q&amp;A</p>
            <p className="text-base font-black leading-tight">{teaching.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {teaching.host.name} · {dateStr} · {timeStr}
          </span>
          {canViewDashboard && (
            <Link href={`/classroom/${sessionId}/pre-questions/dashboard`}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-[11px] font-semibold transition hover:border-primary/40 hover:text-primary">
              Presenter view →
            </Link>
          )}
        </div>
      </div>

      <PreQuestionsBoard sessionId={sessionId} currentUserId={session.user.id} />
    </div>
  );
}
