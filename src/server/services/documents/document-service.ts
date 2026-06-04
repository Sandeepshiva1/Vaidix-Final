// ════════════════════════════════════════════════════════════════════════════
// Document Service — W4 Stream C
// ════════════════════════════════════════════════════════════════════════════
// CRUD + presigned uploads + AI classification + session tagging.
//
// PHI scanning: every uploaded document gets enqueued onto QUEUES.PHI_SCAN
// after createDocumentDraft returns. The phi-scan-worker downloads, extracts
// text, runs the regex scanner, and updates Document.phiScanStatus +
// phiScanResult. High-severity findings flip status to PENDING_REVIEW and
// block tag-to-session until a faculty reviewer overrides.

import { db } from '@/lib/db';
import { presignUpload, presignDownload } from '@/lib/storage';
import { Role, DocumentKind, DocumentRoute, DocumentStatus, DeckForgeStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { getQueue, QUEUES } from '@/lib/queue';

const KIND_FROM_MIME: Array<[RegExp, DocumentKind]> = [
  [/^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/, DocumentKind.PPT],
  [/^application\/vnd\.ms-powerpoint$/, DocumentKind.PPT],
  // Apple Keynote (.key) — both modern and legacy mime forms. Text + speaker
  // notes are NOT extractable yet (iWork iwa proto-binary archive needs a
  // dedicated parser); the document is stored, classified as PPT, and the
  // AI pipelines fall through to a metadata-only signal with a clear hint
  // to faculty: "Export from Keynote → PowerPoint (.pptx)" for full ingestion.
  [/^application\/vnd\.apple\.keynote$/, DocumentKind.PPT],
  [/^application\/x-iwork-keynote-sffkey$/, DocumentKind.PPT],
  [/^application\/pdf$/, DocumentKind.PDF],
  [/^application\/msword$/, DocumentKind.DOC],
  [/^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/, DocumentKind.DOC],
  [/^text\/markdown$/, DocumentKind.MARKDOWN],
  [/^image\//, DocumentKind.IMAGE],
  [/^video\//, DocumentKind.VIDEO],
  [/^audio\//, DocumentKind.AUDIO],
];

export function inferKind(mimeType: string): DocumentKind {
  for (const [re, kind] of KIND_FROM_MIME) {
    if (re.test(mimeType)) return kind;
  }
  return DocumentKind.OTHER;
}

export interface DocumentAccessActor {
  userId: string;
  role: Role;
}

export class DocumentAccessError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID', message: string) {
    super(message);
  }
}

/** Build a unique S3 key for a fresh upload */
export function buildDocumentKey(uploaderId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const stamp = Date.now();
  return `documents/raw/${uploaderId}/${stamp}-${safe}`;
}

export interface CreateDocumentInput {
  uploaderId: string;
  title: string;
  description?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CreateDocumentResult {
  document: {
    id: string;
    s3Key: string;
    status: DocumentStatus;
    kind: DocumentKind;
    route: DocumentRoute;
  };
  presignedUploadUrl: string;
}

export async function createDocumentDraft(
  input: CreateDocumentInput
): Promise<CreateDocumentResult> {
  const kind = inferKind(input.mimeType);
  const s3Key = buildDocumentKey(input.uploaderId, input.filename);
  const presigned = await presignUpload(s3Key, input.mimeType, 15 * 60);

  const doc = await db.document.create({
    data: {
      uploadedById: input.uploaderId,
      title: input.title,
      description: input.description ?? null,
      kind,
      route: DocumentRoute.UNCLASSIFIED,
      s3Key,
      sizeBytes: BigInt(input.sizeBytes),
      mimeType: input.mimeType,
      status: DocumentStatus.UPLOADED,
      visibility: DocumentStatus.PRIVATE_FACULTY,
    },
    select: { id: true, s3Key: true, status: true, kind: true, route: true },
  });

  return { document: doc, presignedUploadUrl: presigned };
}

/**
 * Enqueue a PHI scan for a freshly-uploaded document. Idempotent: BullMQ
 * dedupes via the deterministic jobId, so calling it from multiple flows
 * (classify + manual rescan) is safe.
 */
export async function enqueuePhiScan(documentId: string): Promise<{ jobId: string }> {
  const jobId = `phi-scan-${documentId}`;
  await getQueue(QUEUES.PHI_SCAN).add('scan', { documentId }, { jobId });
  return { jobId };
}

/**
 * Returns the latest persisted phiScanResult JSON (if any), expanded into a
 * convenience object. Used by the tag-to-session guard.
 */
async function getPhiScanState(documentId: string): Promise<{
  status: string | null;
  blocked: boolean;
  hasScan: boolean;
}> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: { phiScanStatus: true, phiScanResult: true },
  });
  if (!doc) return { status: null, blocked: false, hasScan: false };
  const status = doc.phiScanStatus;
  const result = doc.phiScanResult as { blocked?: boolean } | null;
  return {
    status,
    blocked: status === 'BLOCKED' || result?.blocked === true,
    hasScan: status !== null,
  };
}

const FACULTY_ROLES: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

function canManage(actor: DocumentAccessActor, doc: { uploadedById: string }): boolean {
  if (actor.role === Role.ADMIN) return true;
  if (FACULTY_ROLES.includes(actor.role) && doc.uploadedById === actor.userId) return true;
  return actor.role === Role.PROGRAM_DIRECTOR;
}

export async function listDocuments(
  actor: DocumentAccessActor,
  opts: { route?: DocumentRoute; mine?: boolean } = {}
): Promise<Array<{
  id: string;
  title: string;
  kind: DocumentKind;
  route: DocumentRoute;
  status: DocumentStatus;
  visibility: DocumentStatus;
  uploaderName: string;
  sizeBytes: number;
  createdAt: string;
  latestForgeJobId: string | null;
  latestForgeStatus: DeckForgeStatus | null;
  latestForgeSlideCount: number | null;
}>> {
  // My Documents is open to residents too, but a resident may ONLY ever see
  // their own uploads — enforced here regardless of how the route is called.
  // Faculty/PD/admin keep the existing behaviour (honour the `mine` flag).
  if (!FACULTY_ROLES.includes(actor.role) && actor.role !== Role.RESIDENT) {
    throw new DocumentAccessError('FORBIDDEN', 'You do not have access to the document library');
  }
  const where: Prisma.DocumentWhereInput = { deletedAt: null, expungedAt: null };
  if (opts.route) where.route = opts.route;
  if (opts.mine || actor.role === Role.RESIDENT) where.uploadedById = actor.userId;

  const docs = await db.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Fetch uploader names via a separate batched query so orphaned FKs
  // (uploader user soft-deleted) don't crash the route. Same pattern as the
  // v1.8 calendar/classroom orphan-FK hardening.
  const uploaderIds = Array.from(new Set(docs.map((d) => d.uploadedById)));
  const uploaders = uploaderIds.length
    ? await db.user.findMany({
        where: { id: { in: uploaderIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(uploaders.map((u) => [u.id, u.name]));

  // For each document, surface its most recent forge job so the UI can render
  // "View slides" instead of "Forge slides" when a deck already exists. We
  // ignore FAILED/REJECTED jobs — the UI treats them as "needs retry", not a
  // viewable deck. One batched query, grouped client-side.
  const docIds = docs.map((d) => d.id);
  const latestForgeByDoc = new Map<
    string,
    { id: string; status: DeckForgeStatus; slideCount: number | null }
  >();
  if (docIds.length) {
    const jobs = await db.deckForgeJob.findMany({
      where: {
        documentId: { in: docIds },
        status: { notIn: [DeckForgeStatus.FAILED, DeckForgeStatus.REJECTED] },
      },
      select: { id: true, documentId: true, status: true, slideCount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    for (const j of jobs) {
      if (!j.documentId) continue;
      if (latestForgeByDoc.has(j.documentId)) continue; // already have a newer one
      latestForgeByDoc.set(j.documentId, {
        id: j.id,
        status: j.status,
        slideCount: j.slideCount,
      });
    }
  }

  return docs.map((d) => {
    const forge = latestForgeByDoc.get(d.id) ?? null;
    return {
      id: d.id,
      title: d.title,
      kind: d.kind,
      route: d.route,
      status: d.status,
      visibility: d.visibility,
      uploaderName: nameById.get(d.uploadedById) ?? 'Unknown user',
      sizeBytes: Number(d.sizeBytes),
      createdAt: d.createdAt.toISOString(),
      latestForgeJobId: forge?.id ?? null,
      latestForgeStatus: forge?.status ?? null,
      latestForgeSlideCount: forge?.slideCount ?? null,
    };
  });
}

export async function getDocumentForActor(
  actor: DocumentAccessActor,
  documentId: string,
  opts: { withDownloadUrl?: boolean } = {}
): Promise<{
  id: string;
  title: string;
  description: string | null;
  kind: DocumentKind;
  route: DocumentRoute;
  aiSuggestedRoute: DocumentRoute | null;
  aiConfidence: number | null;
  status: DocumentStatus;
  visibility: DocumentStatus;
  sizeBytes: number;
  mimeType: string;
  uploaderId: string;
  uploaderName: string;
  phiScanStatus: string | null;
  phiScanResult: unknown;
  rejectionReason: string | null;
  downloadUrl: string | null;
  tags: string[];
  sessions: Array<{ sessionId: string; visibleAfterSession: boolean }>;
  createdAt: string;
  updatedAt: string;
}> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    include: {
      uploader: { select: { id: true, name: true } },
      tags: { select: { tag: true } },
      sessionLinks: { select: { sessionId: true, visibleAfterSession: true } },
    },
  });
  if (!doc || doc.deletedAt || doc.expungedAt) {
    throw new DocumentAccessError('NOT_FOUND', 'Document not found');
  }
  // Resident can read only documents linked to a session they're allowed to see.
  if (actor.role === Role.RESIDENT) {
    if (doc.sessionLinks.length === 0) {
      throw new DocumentAccessError('FORBIDDEN', 'Document is not linked to a viewable session');
    }
    // We rely on the session check elsewhere; for now allow if any link exists.
  } else if (!FACULTY_ROLES.includes(actor.role)) {
    throw new DocumentAccessError('FORBIDDEN', 'Insufficient role');
  }

  const downloadUrl = opts.withDownloadUrl ? await presignDownload(doc.s3Key, 6 * 3600) : null;

  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    kind: doc.kind,
    route: doc.route,
    aiSuggestedRoute: doc.aiSuggestedRoute,
    aiConfidence: doc.aiConfidence ? Number(doc.aiConfidence) : null,
    status: doc.status,
    visibility: doc.visibility,
    sizeBytes: Number(doc.sizeBytes),
    mimeType: doc.mimeType,
    uploaderId: doc.uploader.id,
    uploaderName: doc.uploader.name,
    phiScanStatus: doc.phiScanStatus,
    phiScanResult: doc.phiScanResult,
    rejectionReason: doc.rejectionReason,
    downloadUrl,
    tags: doc.tags.map((t) => t.tag),
    sessions: doc.sessionLinks,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function updateClassification(
  actor: DocumentAccessActor,
  documentId: string,
  route: DocumentRoute
): Promise<void> {
  const doc = await db.document.findUnique({ where: { id: documentId }, select: { uploadedById: true } });
  if (!doc) throw new DocumentAccessError('NOT_FOUND', 'Document not found');
  if (!canManage(actor, doc)) throw new DocumentAccessError('FORBIDDEN', 'Cannot manage this document');
  await db.document.update({
    where: { id: documentId },
    data: { route, status: DocumentStatus.PRIVATE_FACULTY },
  });
}

export async function tagDocumentToSession(
  actor: DocumentAccessActor,
  documentId: string,
  sessionId: string,
  opts: { phiOverride?: boolean } = {}
): Promise<void> {
  const doc = await db.document.findUnique({ where: { id: documentId }, select: { uploadedById: true } });
  if (!doc) throw new DocumentAccessError('NOT_FOUND', 'Document not found');

  // Session hosts may tag any document to their own session (they're curating
  // content for their class, not managing someone else's library record).
  // Ownership check still applies for all other mutation paths.
  if (!canManage(actor, doc)) {
    const session = await db.teachingSession.findUnique({
      where: { id: sessionId, deletedAt: null },
      select: { hostId: true },
    });
    if (session?.hostId !== actor.userId) {
      throw new DocumentAccessError('FORBIDDEN', 'Cannot tag this document');
    }
  }

  // PHI gate: documents flagged BLOCKED by the scanner cannot be tagged to a
  // session unless the actor is an admin/PD AND explicitly passes phiOverride.
  // This stops sensitive case-notes PDFs from leaking into resident-visible
  // resources sections.
  const phi = await getPhiScanState(documentId);
  if (phi.blocked) {
    const isAdminOverride =
      (actor.role === Role.ADMIN || actor.role === Role.PROGRAM_DIRECTOR) && opts.phiOverride === true;
    if (!isAdminOverride) {
      throw new DocumentAccessError(
        'FORBIDDEN',
        'PHI detected — cannot tag to session until reviewed and approved with phiOverride=true (admin/PD only).'
      );
    }
  }

  await db.documentSessionLink.upsert({
    where: { documentId_sessionId: { documentId, sessionId } },
    create: { documentId, sessionId, linkedById: actor.userId },
    update: {},
  });
}

export async function softDeleteDocument(
  actor: DocumentAccessActor,
  documentId: string
): Promise<void> {
  const doc = await db.document.findUnique({ where: { id: documentId }, select: { uploadedById: true, s3Key: true } });
  if (!doc) throw new DocumentAccessError('NOT_FOUND', 'Document not found');
  if (!canManage(actor, doc)) throw new DocumentAccessError('FORBIDDEN', 'Cannot delete this document');

  await db.document.update({
    where: { id: documentId },
    data: { deletedAt: new Date() },
  });
  // Storage key removal is intentionally NOT done here — DPDPA expunge worker
  // (W14) is what actually purges objects. Soft-delete only.
}

/**
 * Phase A AI classifier: fast heuristic with placeholder confidence.
 * Stream C will swap this with a Gemini-backed call before W4 ends.
 */
export function heuristicClassify(input: { title: string; mimeType: string; kind: DocumentKind }): {
  suggestedRoute: DocumentRoute;
  confidence: number;
} {
  const title = input.title.toLowerCase();
  if (input.kind === DocumentKind.PPT) return { suggestedRoute: DocumentRoute.DECK_FORGE, confidence: 0.85 };
  if (/(case\s*note|patient|history)/.test(title)) return { suggestedRoute: DocumentRoute.CASE_NOTE, confidence: 0.7 };
  if (/(promo|flyer|banner|reel)/.test(title)) return { suggestedRoute: DocumentRoute.PROMO_ASSET, confidence: 0.6 };
  if (input.kind === DocumentKind.PDF) return { suggestedRoute: DocumentRoute.REFERENCE, confidence: 0.55 };
  return { suggestedRoute: DocumentRoute.UNCLASSIFIED, confidence: 0.3 };
}

export async function applyAiClassification(
  documentId: string,
  classification: { suggestedRoute: DocumentRoute; confidence: number }
): Promise<void> {
  await db.document.update({
    where: { id: documentId },
    data: {
      aiSuggestedRoute: classification.suggestedRoute,
      aiConfidence: classification.confidence,
      status: DocumentStatus.PENDING_REVIEW,
    },
  });
}

export { DocumentRoute, DocumentStatus, DocumentKind };
