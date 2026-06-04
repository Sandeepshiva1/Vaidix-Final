// ════════════════════════════════════════════════════════════════════════════
// /teacher/documents/[id] — Document detail + Forge launchpad
// ════════════════════════════════════════════════════════════════════════════
// One screen per uploaded document. Faculty lands here from the library and
// can:
//   - Review classification, PHI status, metadata
//   - Forge a presentation (existing /api/decks/forge)
//   - Forge a case (Phase 4 — POST /api/cases/forge)
//   - Share to a session (existing /api/documents/[id]/tag-session)
//   - Open existing forged decks/cases for editing
//
// The page is the source of truth: every artifact (deck, case, session link)
// produced from this document is listed here. No other page aggregates per-
// document artifacts.

import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import {
  getDocumentForActor,
  DocumentAccessError,
} from '@/server/services/documents/document-service';
import { DocumentDetailClient } from './document-detail-client';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function FacultyDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/teacher/documents');
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const { id } = await params;

  let doc;
  try {
    doc = await getDocumentForActor(
      { userId: session.user.id, role: session.user.role },
      id,
      { withDownloadUrl: true },
    );
  } catch (err) {
    if (err instanceof DocumentAccessError && err.code === 'NOT_FOUND') notFound();
    if (err instanceof DocumentAccessError && err.code === 'FORBIDDEN') redirect('/teacher/documents');
    throw err;
  }

  // Forged decks under this document. Each row carries enough info for the
  // launchpad cards (status, slide count, last analysis snapshot).
  const decks = await db.deckForgeJob.findMany({
    where: { documentId: id },
    select: {
      id: true,
      status: true,
      slideCount: true,
      inputTitle: true,
      analysisResult: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // Sessions this doc is linked to. Names looked up via batched query so
  // soft-deleted sessions don't crash the page.
  const sessionIds = doc.sessions.map((s) => s.sessionId);
  const sessionRows = sessionIds.length
    ? await db.teachingSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, title: true, scheduledStart: true, status: true },
      })
    : [];
  const sessionById = new Map(sessionRows.map((s) => [s.id, s]));

  // Available sessions to pick from in the share-to-session form. Scoped
  // to active program; faculty sees what they can actually link to.
  const programId = (await db.user.findUnique({
    where: { id: session.user.id },
    select: { activeProgramId: true },
  }))?.activeProgramId ?? null;

  const availableSessions = programId
    ? await db.teachingSession.findMany({
        where: {
          programId,
          deletedAt: null,
        },
        select: { id: true, title: true, scheduledStart: true },
        orderBy: { scheduledStart: 'desc' },
        take: 50,
      })
    : [];

  return (
    <DocumentDetailClient
      doc={{
        id: doc.id,
        title: doc.title,
        description: doc.description,
        kind: doc.kind,
        route: doc.route,
        aiSuggestedRoute: doc.aiSuggestedRoute,
        aiConfidence: doc.aiConfidence,
        status: doc.status,
        sizeBytes: doc.sizeBytes,
        mimeType: doc.mimeType,
        uploaderName: doc.uploaderName,
        uploaderId: doc.uploaderId,
        phiScanStatus: doc.phiScanStatus,
        downloadUrl: doc.downloadUrl,
        tags: doc.tags,
        createdAt: doc.createdAt,
      }}
      decks={decks.map((d) => {
        const a = d.analysisResult as
          | { readabilityScore?: number; slideDensityScore?: number; visualBalanceScore?: number; suggestions?: unknown[] }
          | null;
        return {
          id: d.id,
          status: d.status,
          slideCount: d.slideCount,
          inputTitle: d.inputTitle,
          createdAt: d.createdAt.toISOString(),
          readabilityScore: typeof a?.readabilityScore === 'number' ? a.readabilityScore : null,
          slideDensityScore: typeof a?.slideDensityScore === 'number' ? a.slideDensityScore : null,
          visualBalanceScore: typeof a?.visualBalanceScore === 'number' ? a.visualBalanceScore : null,
          suggestionCount: Array.isArray(a?.suggestions) ? a!.suggestions!.length : 0,
        };
      })}
      linkedSessions={doc.sessions
        .map((link) => {
          const s = sessionById.get(link.sessionId);
          return s
            ? {
                sessionId: s.id,
                title: s.title,
                scheduledStart: s.scheduledStart?.toISOString() ?? null,
                status: s.status,
                visibleAfterSession: link.visibleAfterSession,
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)}
      availableSessions={availableSessions.map((s) => ({
        id: s.id,
        title: s.title,
        scheduledStart: s.scheduledStart?.toISOString() ?? null,
      }))}
      actor={{ id: session.user.id, role: session.user.role }}
    />
  );
}
