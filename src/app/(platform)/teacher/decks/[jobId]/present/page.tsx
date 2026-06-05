// ════════════════════════════════════════════════════════════════════════════
// /teacher/decks/[jobId]/present — Fullscreen presenter
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { DeckPresenterClient } from './deck-presenter-client';
import { presignDownload } from '@/lib/storage';

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
      backgroundHex: true,
      importMode: true,
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
      backgroundHex={job.backgroundHex}
      importMode={job.importMode}
      slides={await Promise.all(
        job.slides.map(async (s) => ({
          id: s.id,
          order: s.order,
          layout: s.layout,
          title: s.title,
          bullets: s.bullets,
          speakerNotes: s.speakerNotes,
          accentHex: s.accentHex,
          bold: s.bold,
          italic: s.italic,
          underline: s.underline,
          fontScale: s.fontScale,
          tableJson: s.tableJson as unknown as { rows: string[][] } | null,
          imageS3Key: s.imageS3Key,
          imageUrl: s.imageS3Key ? await presignDownload(s.imageS3Key, 1800) : null,
          sourceImageUrl: s.sourceImageS3Key ? await presignDownload(s.sourceImageS3Key, 1800) : null,
        })),
      )}
    />
  );
}
