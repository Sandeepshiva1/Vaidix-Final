// ════════════════════════════════════════════════════════════════════════════
// /api/documents
// ════════════════════════════════════════════════════════════════════════════
// POST: create a draft Document + return a presigned upload URL.
// GET:  list documents visible to the actor.

import { z } from 'zod';
import { Role, DocumentRoute } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  parseQuery,
  requireAuth,
} from '@/server/services/api-helpers';
import {
  createDocumentDraft,
  listDocuments,
  DocumentAccessError,
} from '@/server/services/documents/document-service';
import { env } from '@/lib/env';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { checkRateLimit, LIMITS } from '@/server/services/rate-limit';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
});

const listSchema = z.object({
  route: z.nativeEnum(DocumentRoute).optional(),
  mine: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

// Residents may save documents to their own personal "My Documents" folder.
const UPLOAD_ROLES: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN, Role.RESIDENT];

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!UPLOAD_ROLES.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'You are not allowed to upload documents', 403);
  }

  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const { title, description, filename, mimeType, sizeBytes } = body.data;

  const maxBytes = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return jsonError('TOO_LARGE', `File exceeds ${env.MAX_UPLOAD_SIZE_MB} MB limit`, 413);
  }

  const rl = await checkRateLimit({ bucket: `doc-upload:${auth.user.id}`, ...LIMITS.DOCUMENT_UPLOAD });
  if (!rl.allowed) {
    return jsonError('RATE_LIMITED', 'Too many document uploads — try again later', 429, {
      resetAt: rl.resetAt.toISOString(),
    });
  }

  try {
    const result = await createDocumentDraft({
      uploaderId: auth.user.id,
      title,
      description,
      filename,
      mimeType,
      sizeBytes,
    });
    const reqMeta = extractRequestMetadata(req);
    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DOCUMENT_UPLOAD_INITIATED,
      entityType: 'Document',
      entityId: result.document.id,
      summary: `Document upload initiated: ${title}`,
      details: { filename, mimeType, sizeBytes, kind: result.document.kind },
      ...reqMeta,
    });
    return jsonOk(result, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function GET(req: Request) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const q = await parseQuery(req, listSchema);
  if (!q.ok) return q.response;
  try {
    const docs = await listDocuments(
      { userId: auth.user.id, role: auth.user.role },
      { route: q.data.route, mine: q.data.mine }
    );
    return jsonOk({ documents: docs });
  } catch (err) {
    if (err instanceof DocumentAccessError) {
      const status = err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
      return jsonError(err.code, err.message, status);
    }
    return handleUnexpected(err);
  }
}
