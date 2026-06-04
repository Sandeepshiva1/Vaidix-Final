// ════════════════════════════════════════════════════════════════════════════
// Study Pack Service
// ════════════════════════════════════════════════════════════════════════════
// A "Study Pack" is the curated set of pre-session materials a learner sees
// for an upcoming TeachingSession:
// - Pre-readings → DocumentSessionLink rows where isPreSession=true and
// the linked Document has kind PDF / DOC / MARKDOWN
// - Pre-watch videos → same but kind=VIDEO
// - Pre-cases → SessionPreCase rows (handled by pre-case-service)
//
// Faculty marks an existing session-tagged document as pre-session via
// `assignDocumentToStudyPack(...)`. The doc must already be linked to the
// session (via the W4 tag-session flow); this service only flips the
// `isPreSession` boolean on the existing link row. That decoupling keeps
// "is this doc visible on the session page at all" separate from "is this
// the ranked pre-session prep" — same lifecycle, two different concerns.
//
// Resident view & engagement:
// - listStudyPack returns each item with `viewedByMe` so the UI shows ✓ marks
// - recordStudyPackView writes a StudyPackView row + a matching
// EngagementSignal so the existing aggregate pipeline + thereadiness
// predictor both pick it up without a parallel codepath.

import { db } from '@/lib/db';
import {
  Role,
  EngagementSignalKind,
  DocumentKind,
  type Prisma,
} from '@prisma/client';
import { presignDownload } from '@/lib/storage';
import { recordEngagementSignal } from '@/server/services/engagement/engagement-service';
import {
  userCanSeeSession,
  userIsHostOrPrivileged,
} from '@/server/services/sessions/visibility';

export class StudyPackAccessError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID',
    message: string
  ) {
    super(message);
  }
}

export interface StudyPackActor {
  userId: string;
  role: Role;
}

// ─── Curation (faculty / host) ─────────────────────────────────────────────
export interface AssignDocumentInput {
  sessionId: string;
  documentId: string;
  rank?: number;
  actor: StudyPackActor;
}

export async function assignDocumentToStudyPack(
  input: AssignDocumentInput
): Promise<{ linkId: string }> {
  if (!(await userIsHostOrPrivileged(input.actor, input.sessionId))) {
    throw new StudyPackAccessError(
      'FORBIDDEN',
      'Only host / PD / admin can curate the study pack'
    );
  }
  const link = await db.documentSessionLink.findUnique({
    where: {
      documentId_sessionId: {
        documentId: input.documentId,
        sessionId: input.sessionId,
      },
    },
    select: { id: true, document: { select: { deletedAt: true } } },
  });
  if (!link) {
    throw new StudyPackAccessError(
      'NOT_FOUND',
      'Document is not tagged to this session — tag it first via /api/documents/[id]/tag-session'
    );
  }
  if (link.document.deletedAt) {
    throw new StudyPackAccessError('INVALID', 'Document is soft-deleted');
  }
  const updated = await db.documentSessionLink.update({
    where: { id: link.id },
    data: {
      isPreSession: true,
      preSessionRank: typeof input.rank === 'number' ? input.rank : null,
    },
    select: { id: true },
  });
  return { linkId: updated.id };
}

export interface UnassignDocumentInput {
  sessionId: string;
  linkId: string;
  actor: StudyPackActor;
}

export async function unassignDocumentFromStudyPack(
  input: UnassignDocumentInput
): Promise<void> {
  if (!(await userIsHostOrPrivileged(input.actor, input.sessionId))) {
    throw new StudyPackAccessError(
      'FORBIDDEN',
      'Only host / PD / admin can curate the study pack'
    );
  }
  const link = await db.documentSessionLink.findFirst({
    where: { id: input.linkId, sessionId: input.sessionId },
    select: { id: true },
  });
  if (!link) {
    throw new StudyPackAccessError('NOT_FOUND', 'Study-pack link not found for this session');
  }
  await db.documentSessionLink.update({
    where: { id: link.id },
    data: { isPreSession: false, preSessionRank: null },
  });
}

// ─── Listing (any session-visible user) ────────────────────────────────────
export interface StudyPackItemDocument {
  kind: 'reading' | 'video';
  linkId: string;
  documentId: string;
  title: string;
  description: string | null;
  mimeType: string;
  rank: number | null;
  signedUrl: string;
  viewedByMe: boolean;
  viewedAt: string | null;
  durationSec: number | null;
}

export interface StudyPackResponse {
  sessionId: string;
  readings: StudyPackItemDocument[];
  videos: StudyPackItemDocument[];
  /** Pre-cases are populated by pre-case-service.listPreCasesForLearner; the
 * /study-pack route stitches both responses together so the resident page
 * has a single fetch. Returned here as the empty list for symmetry; the
 * route fills it in. */
  preCases: never[];
}

const VIDEO_KINDS = new Set<DocumentKind>([DocumentKind.VIDEO]);
const READING_KINDS = new Set<DocumentKind>([
  DocumentKind.PDF,
  DocumentKind.DOC,
  DocumentKind.MARKDOWN,
  DocumentKind.PPT,
  DocumentKind.IMAGE,
  DocumentKind.OTHER,
]);

const PRESIGN_TTL_SEC = 60 * 60; // 1h is plenty for a learner viewing window

export async function listStudyPackDocuments(
  sessionId: string,
  actor: StudyPackActor
): Promise<{ readings: StudyPackItemDocument[]; videos: StudyPackItemDocument[] }> {
  if (!(await userCanSeeSession(actor, sessionId))) {
    throw new StudyPackAccessError(
      'FORBIDDEN',
      'No visibility into this session'
    );
  }
  const links = await db.documentSessionLink.findMany({
    where: { sessionId, isPreSession: true, document: { deletedAt: null } },
    orderBy: [{ preSessionRank: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      preSessionRank: true,
      documentId: true,
      document: {
        select: {
          id: true,
          title: true,
          description: true,
          mimeType: true,
          kind: true,
          s3Key: true,
        },
      },
    },
  });

 // Pre-load this user's view records in one query so the per-item
 // viewedByMe lookup is O(1).
  const viewRows = await db.studyPackView.findMany({
    where: {
      sessionId,
      userId: actor.userId,
      documentLinkId: { in: links.map((l) => l.id) },
    },
    orderBy: { viewedAt: 'desc' },
    select: { documentLinkId: true, viewedAt: true, durationSec: true },
  });
  const viewedByLink = new Map<string, { viewedAt: Date; durationSec: number | null }>();
  for (const v of viewRows) {
    if (!v.documentLinkId) continue;
    if (!viewedByLink.has(v.documentLinkId)) {
      viewedByLink.set(v.documentLinkId, { viewedAt: v.viewedAt, durationSec: v.durationSec });
    }
  }

  const readings: StudyPackItemDocument[] = [];
  const videos: StudyPackItemDocument[] = [];
  for (const link of links) {
    const v = viewedByLink.get(link.id);
    const item: StudyPackItemDocument = {
      kind: VIDEO_KINDS.has(link.document.kind) ? 'video' : 'reading',
      linkId: link.id,
      documentId: link.document.id,
      title: link.document.title,
      description: link.document.description,
      mimeType: link.document.mimeType,
      rank: link.preSessionRank,
      signedUrl: await presignDownload(link.document.s3Key, PRESIGN_TTL_SEC),
      viewedByMe: !!v,
      viewedAt: v ? v.viewedAt.toISOString() : null,
      durationSec: v?.durationSec ?? null,
    };
    if (item.kind === 'video') videos.push(item);
    else if (READING_KINDS.has(link.document.kind)) readings.push(item);
  }
  return { readings, videos };
}

// ─── View tracking ─────────────────────────────────────────────────────────
export interface RecordViewInput {
  sessionId: string;
  actor: StudyPackActor;
  documentLinkId?: string;
  preCaseId?: string;
  durationSec?: number;
  completed?: boolean;
}

export async function recordStudyPackView(input: RecordViewInput): Promise<{ viewId: string }> {
  if (!(await userCanSeeSession(input.actor, input.sessionId))) {
    throw new StudyPackAccessError('FORBIDDEN', 'No visibility into this session');
  }
  if (!input.documentLinkId && !input.preCaseId) {
    throw new StudyPackAccessError(
      'INVALID',
      'documentLinkId or preCaseId is required'
    );
  }
 // Validate the FK target exists + belongs to the session — defends against
 // a mismatched pair (link from session A submitted under session B).
  let signalKind: EngagementSignalKind | null = null;
  if (input.documentLinkId) {
    const link = await db.documentSessionLink.findFirst({
      where: { id: input.documentLinkId, sessionId: input.sessionId, isPreSession: true },
      select: { id: true, document: { select: { kind: true } } },
    });
    if (!link) {
      throw new StudyPackAccessError(
        'NOT_FOUND',
        'Pre-session document not found for this session'
      );
    }
    signalKind = VIDEO_KINDS.has(link.document.kind)
      ? EngagementSignalKind.PRE_VIDEO_WATCHED
      : EngagementSignalKind.PRE_READING_VIEWED;
  } else if (input.preCaseId) {
    const pc = await db.sessionPreCase.findFirst({
      where: { id: input.preCaseId, sessionId: input.sessionId },
      select: { id: true },
    });
    if (!pc) {
      throw new StudyPackAccessError('NOT_FOUND', 'Pre-case not found for this session');
    }
    signalKind = EngagementSignalKind.PRE_CASE_STARTED;
  }

  const view = await db.studyPackView.create({
    data: {
      sessionId: input.sessionId,
      userId: input.actor.userId,
      documentLinkId: input.documentLinkId ?? null,
      preCaseId: input.preCaseId ?? null,
      durationSec: input.durationSec ?? null,
      completedAt: input.completed ? new Date() : null,
    },
    select: { id: true },
  });

  if (signalKind) {
    await recordEngagementSignal({
      sessionId: input.sessionId,
      userId: input.actor.userId,
      kind: signalKind,
      value: input.durationSec ?? undefined,
      metadata: {
        documentLinkId: input.documentLinkId,
        preCaseId: input.preCaseId,
        completed: !!input.completed,
      },
    });
  }
  return { viewId: view.id };
}

/** Curator-facing list — every Document tagged to this session (regardless of
 * isPreSession), with the linkId + flag so the curator UI can toggle. */
export interface StudyPackCandidate {
  linkId: string;
  documentId: string;
  title: string;
  description: string | null;
  kind: DocumentKind;
  mimeType: string;
  isPreSession: boolean;
  preSessionRank: number | null;
  uploadedByName: string;
  uploadedAt: string;
}

export async function listStudyPackCandidates(
  sessionId: string,
  actor: StudyPackActor
): Promise<StudyPackCandidate[]> {
  if (!(await userIsHostOrPrivileged(actor, sessionId))) {
    throw new StudyPackAccessError(
      'FORBIDDEN',
      'Only host / PD / admin can view the curator candidate list'
    );
  }
  const links = await db.documentSessionLink.findMany({
    where: { sessionId, document: { deletedAt: null } },
    orderBy: [
 // Pre-session items first (truest first), then by rank, then upload order.
      { isPreSession: 'desc' },
      { preSessionRank: 'asc' },
      { createdAt: 'asc' },
    ],
    select: {
      id: true,
      isPreSession: true,
      preSessionRank: true,
      document: {
        select: {
          id: true,
          title: true,
          description: true,
          kind: true,
          mimeType: true,
          createdAt: true,
          uploader: { select: { name: true } },
        },
      },
    },
  });
  return links.map((l) => ({
    linkId: l.id,
    documentId: l.document.id,
    title: l.document.title,
    description: l.document.description,
    kind: l.document.kind,
    mimeType: l.document.mimeType,
    isPreSession: l.isPreSession,
    preSessionRank: l.preSessionRank,
    uploadedByName: l.document.uploader.name,
    uploadedAt: l.document.createdAt.toISOString(),
  }));
}

// ─── AI-generated study content (quiz + flashcards from the transcript) ──────
// The post-session AI pipeline writes SjtCase rows (situational-judgement MCQs)
// and PostSessionQa rows (Q&A pairs) keyed by sessionTranscriptId. The learner
// Study Hub surfaces these as a pre/post-session Quiz and Flashcard drill. Both
// are mapped here to the client-facing shapes so the route stays a thin shim.

/** Client quiz shape — mirrors the component's `QuizQuestion`. */
export interface StudyPackQuizQuestion {
  q: string;
  options: string[];
  correct: number;
  explanation: string;
}

/** Client flashcard shape. */
export interface StudyPackFlashcard {
  front: string;
  back: string;
}

/**
 * Load the AI-generated Quiz (from SjtCase) + Flashcards (from PostSessionQa)
 * for a session, by way of its transcripts. Returns empty arrays when the AI
 * pipeline has not produced anything yet (e.g. before the session is recorded).
 */
export async function listStudyPackAiContent(
  sessionId: string,
  actor: StudyPackActor
): Promise<{ quiz: StudyPackQuizQuestion[]; flashcards: StudyPackFlashcard[] }> {
  if (!(await userCanSeeSession(actor, sessionId))) {
    throw new StudyPackAccessError('FORBIDDEN', 'No visibility into this session');
  }

  const transcripts = await db.sessionTranscript.findMany({
    where: { sessionId },
    select: { id: true },
  });
  const transcriptIds = transcripts.map((t) => t.id);
  if (transcriptIds.length === 0) {
    return { quiz: [], flashcards: [] };
  }

  const [sjtCases, qaPairs] = await Promise.all([
    db.sjtCase.findMany({
      where: { sessionTranscriptId: { in: transcriptIds } },
      orderBy: { createdAt: 'asc' },
      select: { stem: true, options: true, correctIndex: true, rationale: true },
    }),
    db.postSessionQa.findMany({
      where: { sessionTranscriptId: { in: transcriptIds } },
      orderBy: { createdAt: 'asc' },
      select: { question: true, answer: true },
    }),
  ]);

  const quiz: StudyPackQuizQuestion[] = sjtCases.map((c) => ({
    q: c.stem,
 // `options` is stored as Json (string[]); normalise defensively.
    options: Array.isArray(c.options) ? (c.options as unknown[]).map(String) : [],
    correct: c.correctIndex ?? 0,
    explanation: c.rationale,
  }));

  const flashcards: StudyPackFlashcard[] = qaPairs.map((q) => ({
    front: q.question,
    back: q.answer,
  }));

  return { quiz, flashcards };
}

/** Used by readiness-service to compute per-learner pre-* counts in one query. */
export async function aggregateLearnerStudyPack(
  sessionId: string,
  learnerIds: string[]
): Promise<Map<string, { readings: number; videos: number; preCaseStarts: number }>> {
  if (learnerIds.length === 0) return new Map();

  const links = await db.documentSessionLink.findMany({
    where: { sessionId, isPreSession: true, document: { deletedAt: null } },
    select: { id: true, document: { select: { kind: true } } },
  });
  const videoLinkIds = new Set(
    links.filter((l) => VIDEO_KINDS.has(l.document.kind)).map((l) => l.id)
  );
  const readingLinkIds = new Set(
    links.filter((l) => !VIDEO_KINDS.has(l.document.kind)).map((l) => l.id)
  );

 // Pull all the views for these learners in one query.
  const views = await db.studyPackView.findMany({
    where: {
      sessionId,
      userId: { in: learnerIds },
    },
    select: { userId: true, documentLinkId: true, preCaseId: true },
  });

  const out = new Map<string, { readings: number; videos: number; preCaseStarts: number }>();
  for (const id of learnerIds) {
    out.set(id, { readings: 0, videos: 0, preCaseStarts: 0 });
  }
 // De-dupe per (user, link) to avoid counting refreshes as multiple views.
  const seen = new Set<string>();
  for (const v of views) {
    const key = `${v.userId}|${v.documentLinkId ?? ''}|${v.preCaseId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slot = out.get(v.userId);
    if (!slot) continue;
    if (v.documentLinkId && videoLinkIds.has(v.documentLinkId)) slot.videos++;
    else if (v.documentLinkId && readingLinkIds.has(v.documentLinkId)) slot.readings++;
    else if (v.preCaseId) slot.preCaseStarts++;
  }
  return out;
}

/** Shape published to the route layer — keeps Prisma types out of public API. */
export type { Prisma };
