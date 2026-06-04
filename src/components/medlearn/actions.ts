'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Prisma, Role, SessionApprovalStatus, SessionStatus, SessionType } from '@prisma/client';
import { forgeDeck, DeckForgeError } from '@/server/services/decks/deck-forge-service';

export interface CreateSessionFormInput {
  title: string;
  scheduledStart: string; // ISO
  durationMinutes: number;
  sessionType: SessionType;
  expectedLearners?: number;
  learnerLevel?: string;
}

export type CreateSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

/**
 * Lightweight session creator for the MedLearn workflow surface.
 *
 * Bypasses the full proposal/approval workflow used by `createSession` in
 * src/server/services/session-service.ts — that path validates against
 * cohorts, conflicts, audit trail, etc. For the simple "doctor schedules
 * their own teaching session" flow we only need the minimum viable record.
 *
 * Auto-approves because the proposer is also the host (faculty path).
 */
export async function createTeachingSessionAction(input: CreateSessionFormInput): Promise<CreateSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'You must be signed in.' };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, activeProgramId: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') return { ok: false, error: 'Your account is not active.' };
  if (!user.activeProgramId) return { ok: false, error: 'No active program selected.' };

  if (
    user.role !== Role.FACULTY &&
    user.role !== Role.PROGRAM_DIRECTOR &&
    user.role !== Role.ADMIN &&
    user.role !== Role.RESIDENT
  ) {
    return { ok: false, error: 'Your role cannot create sessions.' };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: 'Title is required.' };

  const start = new Date(input.scheduledStart);
  if (Number.isNaN(start.getTime())) return { ok: false, error: 'Invalid start time.' };
  const duration = Math.max(15, Math.min(360, input.durationMinutes));
  const end = new Date(start.getTime() + duration * 60_000);

  const created = await db.teachingSession.create({
    data: {
      title,
      sessionType: input.sessionType,
      hostId: user.id,
      proposedBy: user.id,
      programId: user.activeProgramId,
      status: SessionStatus.SCHEDULED,
      approvalStatus: SessionApprovalStatus.APPROVED,
      approvedBy: user.id,
      approvedAt: new Date(),
      scheduledStart: start,
      scheduledEnd: end,
      maxParticipants: input.expectedLearners ? Math.max(1, input.expectedLearners) : 100,
      recordingEnabled: true,
      consentRequired: true,
      tags: input.learnerLevel ? [input.learnerLevel] : [],
      metadata: Prisma.JsonNull,
    },
    select: { id: true },
  });

  revalidatePath('/dashboard');
  return { ok: true, sessionId: created.id };
}

/**
 * Mark a session as LIVE — sets actualStart and flips status. Used by the
 * "I'm Ready — Start Session →" CTA on the Pre-Conference screen.
 */
export async function startSessionAction(sessionId: string): Promise<CreateSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };

  const existing = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, status: true },
  });
  if (!existing) return { ok: false, error: 'Session not found.' };
  if (existing.hostId !== session.user.id) return { ok: false, error: 'Only the host can start this session.' };
  if (existing.status === SessionStatus.ENDED) return { ok: false, error: 'Session has already ended.' };

  await db.teachingSession.update({
    where: { id: sessionId },
    data: {
      status: SessionStatus.LIVE,
      actualStart: existing.status === SessionStatus.LIVE ? undefined : new Date(),
    },
  });

  revalidatePath(`/session/${sessionId}/pre`);
  revalidatePath(`/session/${sessionId}/live`);
  return { ok: true, sessionId };
}

export type AttachDeckResult =
  | { ok: true; jobId: string; slideCount: number; deckTitle: string }
  | { ok: false; error: string; code?: string };

/**
 * Wire a freshly uploaded Document to the session and synchronously kick off
 * Deck Forge so Slide rows exist for the Studio + LiveScreen to render.
 *
 * Runs sync (not background) because:
 *   • Gemini text returns in 5–30s, comparable to a normal page load
 *   • the user is staring at the upload UI waiting for confirmation, so
 *     they get a clean "Deck ready · 18 slides" outcome instead of a
 *     "we'll notify you" handwave that needs separate polling infra
 *   • Phase B in the existing code already pencils in moving this to BullMQ
 *
 * If forgeDeck throws (no Gemini key, bad source, AI parse error), we still
 * keep the DocumentSessionLink so the file is at least downloadable; the
 * Pre screen surfaces the error and offers a re-run path.
 */
export async function attachDocumentAndForgeAction(
  sessionId: string,
  documentId: string,
): Promise<AttachDeckResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };

  const [sessionRow, doc] = await Promise.all([
    db.teachingSession.findUnique({
      where: { id: sessionId },
      select: { id: true, hostId: true, title: true },
    }),
    db.document.findUnique({
      where: { id: documentId },
      select: { id: true, uploadedById: true, title: true },
    }),
  ]);
  if (!sessionRow) return { ok: false, error: 'Session not found.' };
  if (!doc) return { ok: false, error: 'Document not found.' };
  if (sessionRow.hostId !== session.user.id && doc.uploadedById !== session.user.id) {
    return { ok: false, error: 'You do not have permission to attach this document.' };
  }

  // Link is idempotent on (documentId, sessionId) per the @@unique on the model.
  await db.documentSessionLink.upsert({
    where: { documentId_sessionId: { documentId, sessionId } },
    update: {},
    create: {
      sessionId,
      documentId,
      linkedById: session.user.id,
      isPreSession: true,
    },
  });

  try {
    const outcome = await forgeDeck({
      documentId,
      requestedById: session.user.id,
      inputTitle: doc.title || sessionRow.title,
    });
    revalidatePath(`/session/${sessionId}/pre`);
    revalidatePath(`/session/${sessionId}/live`);
    return { ok: true, ...outcome };
  } catch (err) {
    const code = err instanceof DeckForgeError ? err.code : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code, error: msg };
  }
}

/**
 * End a session — flips status to ENDED, records actualEnd. Used by the
 * "End Session" button on the Live screen.
 */
export async function endSessionAction(sessionId: string): Promise<CreateSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };

  const existing = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: { hostId: true, status: true },
  });
  if (!existing) return { ok: false, error: 'Session not found.' };
  if (existing.hostId !== session.user.id) return { ok: false, error: 'Only the host can end this session.' };

  await db.teachingSession.update({
    where: { id: sessionId },
    data: {
      status: SessionStatus.ENDED,
      actualEnd: new Date(),
    },
  });

  revalidatePath(`/session/${sessionId}/live`);
  revalidatePath(`/session/${sessionId}/post`);
  revalidatePath('/dashboard');
  return { ok: true, sessionId };
}
