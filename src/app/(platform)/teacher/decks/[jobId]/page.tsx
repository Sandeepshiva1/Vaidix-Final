// ════════════════════════════════════════════════════════════════════════════
// /teacher/decks/[jobId] — Slide editor for a forged deck
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { DeckEditorClient } from './deck-editor-client';
import { isRouterV2 } from '@/server/services/decks/deck-analyze-service';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function FacultyDeckEditorPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=/teacher/decks/${jobId}`);
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    include: {
      slides: { orderBy: { order: 'asc' } },
      document: { select: { id: true, title: true } },
      recording: { select: { id: true, session: { select: { id: true, title: true } } } },
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
    <DeckEditorClient
      jobId={job.id}
      deckTitle={job.inputTitle ?? 'Untitled Deck'}
      status={job.status}
      sourceLabel={
        job.document
          ? `Document · ${job.document.title}`
          : job.recording
            ? `Transcript · ${job.recording.session.title}`
            : 'No source'
      }
      initialSlides={job.slides.map((s) => ({
        id: s.id,
        order: s.order,
        layout: s.layout,
        title: s.title,
        bullets: s.bullets,
        speakerNotes: s.speakerNotes,
        accentHex: s.accentHex,
      }))}
      initialAnalysis={isRouterV2(job.analysisResult) ? job.analysisResult : null}
      initialTheme={job.template}
    />
  );
}
