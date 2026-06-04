// ════════════════════════════════════════════════════════════════════════════
// /teacher/decks/[jobId]/studio — Presentation Studio (Phase 1C)
// ════════════════════════════════════════════════════════════════════════════
// 3-pane studio modelled on /4_1_1_presentation_studio.html: left slide
// thumbs with issue badges, center slide canvas with floating annotation
// pins, right tabbed AI panel (Analysis / Suggestions / Interactions) with
// a refine chat input footer.
//
// The legacy editor at /teacher/decks/[jobId] is kept for backward compat
// with legacy forge jobs; the wizard-forge flow redirects to /studio.

import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role, DeckForgeStatus } from '@prisma/client';
import { isRouterV2 } from '@/server/services/decks/deck-analyze-service';
import { StudioClient } from './studio-client';
import { presignDownload } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function PresentationStudioPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=/teacher/decks/${jobId}/studio`);
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

  // Owner OR PD/admin can view.
  if (
    job.requestedById !== session.user.id &&
    session.user.role !== Role.ADMIN &&
    session.user.role !== Role.PROGRAM_DIRECTOR
  ) {
    redirect('/teacher/documents');
  }

  if (job.status === DeckForgeStatus.REJECTED) {
    redirect('/teacher/documents');
  }

  return (
    <StudioClient
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
