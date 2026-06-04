// ════════════════════════════════════════════════════════════════════════════
// /teacher/decks/[jobId]/present — Fullscreen presenter
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { DeckPresenterClient } from './deck-presenter-client';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function PresentPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=/teacher/decks/${jobId}/present`);
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      inputTitle: true,
      requestedById: true,
      template: true,
      slides: { orderBy: { order: 'asc' } },
    },
  });
  if (!job) notFound();
  if (
    job.requestedById !== session.user.id &&
    session.user.role !== Role.ADMIN &&
    session.user.role !== Role.PROGRAM_DIRECTOR
  ) {
    redirect('/teacher/documents');
  }

  return (
    <DeckPresenterClient
      jobId={job.id}
      deckTitle={job.inputTitle ?? 'Untitled Deck'}
      themeId={job.template ?? undefined}
      slides={job.slides.map((s) => ({
        id: s.id,
        order: s.order,
        layout: s.layout,
        title: s.title,
        bullets: s.bullets,
        speakerNotes: s.speakerNotes,
        accentHex: s.accentHex,
      }))}
    />
  );
}
