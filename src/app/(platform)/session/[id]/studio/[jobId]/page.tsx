// ════════════════════════════════════════════════════════════════════════════
// /session/[id]/studio/[jobId] — In-flow slide editor for a forged deck
// ════════════════════════════════════════════════════════════════════════════
// Mirrors /teacher/decks/[jobId]/page.tsx (deck loading + guards + slide-image
// presigning), but renders the editor INSIDE the session flow: the editor's
// Back link returns to the pre-conference hub and a "Finalize" button locks the
// deck and returns there too (via the backToSessionId prop).

import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { DeckEditorClient } from '@/app/(platform)/teacher/decks/[jobId]/deck-editor-client';
import { isRouterV2 } from '@/server/services/decks/deck-analyze-service';
import { presignDownload } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function SessionStudioDeckEditorPage({
  params,
}: {
  params: Promise<{ id: string; jobId: string }>;
}) {
  const { id, jobId } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=/session/${id}/studio/${jobId}`);
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const job = await db.deckForgeJob.findUnique({
    where: { id: jobId },
    include: {
      slides: { orderBy: { order: 'asc' } },
      document: {
        select: { id: true, title: true, sessionLinks: { select: { sessionId: true } } },
      },
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

  // Best-effort: confirm this deck belongs to THIS session (either via its
  // source document being linked to the session, or a transcript-sourced deck
  // whose recording is on the session). If not, fall back to the studio hub.
  const belongsToSession =
    job.document?.sessionLinks?.some((l) => l.sessionId === id) ||
    job.recording?.session?.id === id;
  if (!belongsToSession) redirect(`/session/${id}/studio`);

  return (
    <DeckEditorClient
      jobId={job.id}
      deckTitle={job.inputTitle ?? 'Untitled Deck'}
      status={job.status}
      backToSessionId={id}
      sourceLabel={
        job.document
          ? `Document · ${job.document.title}`
          : job.recording
            ? `Transcript · ${job.recording.session.title}`
            : 'No source'
      }
      initialSlides={await Promise.all(
        job.slides.map(async (s) => ({
          id: s.id,
          order: s.order,
          layout: s.layout,
          title: s.title,
          bullets: s.bullets,
          speakerNotes: s.speakerNotes,
          accentHex: s.accentHex,
          imageS3Key: s.imageS3Key,
          imageUrl: s.imageS3Key ? await presignDownload(s.imageS3Key, 1800) : null,
        })),
      )}
      initialAnalysis={isRouterV2(job.analysisResult) ? job.analysisResult : null}
      initialTheme={job.template}
    />
  );
}
