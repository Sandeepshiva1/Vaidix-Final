// POST   /api/decks/[jobId]/slides/[slideId]/image — generate (Gemini) or, with
//        { remove: true }, clear the slide image.
// PUT    /api/decks/[jobId]/slides/[slideId]/image — upload an image file
//        (multipart/form-data, field "file") to use as the slide image.
// DELETE /api/decks/[jobId]/slides/[slideId]/image — clear the slide image.
//
// Reuses the routed image pipeline (aiGenerateImageForSlide) + the same MinIO
// PutObjectCommand upload the wizard-forge service uses, behind the exact auth
// + ownership + CSRF gate as the slide PATCH route. When Gemini is offline
// (firewall-blocked / rate-limited) the router throws AiUnavailableError and we
// return a graceful 503 — we never fabricate an image.

import { z } from 'zod';
import { Role } from '@prisma/client';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { db } from '@/lib/db';
import { s3, BUCKET, presignDownload } from '@/lib/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  aiGenerateImageForSlide,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

// Signed download links are short-lived; mirror the page loader's TTL.
const IMAGE_URL_TTL_SECONDS = 1800;

const PostBody = z
  .object({
    // Truthy `remove` turns the POST into a clear-image op (parity with DELETE),
    // letting the client use a single fetch helper for both actions.
    remove: z.boolean().optional(),
  })
  .optional();

/** Shared auth + ownership gate — mirrors the slide PATCH route exactly. */
async function loadOwnedSlide(jobId: string, slideId: string, userId: string, role: Role) {
  const slide = await db.slide.findUnique({
    where: { id: slideId },
    select: {
      id: true,
      deckForgeJobId: true,
      title: true,
      bullets: true,
      speakerNotes: true,
      imageS3Key: true,
      job: { select: { requestedById: true } },
    },
  });
  if (!slide || slide.deckForgeJobId !== jobId) {
    return { ok: false as const, response: jsonError('NOT_FOUND', 'Slide not found', 404) };
  }
  if (
    slide.job.requestedById !== userId &&
    role !== Role.ADMIN &&
    role !== Role.PROGRAM_DIRECTOR
  ) {
    return { ok: false as const, response: jsonError('FORBIDDEN', 'Not your deck', 403) };
  }
  return { ok: true as const, slide };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ jobId: string; slideId: string }> },
) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { jobId, slideId } = await ctx.params;
  const parsed = await parseBody(req, PostBody);
  if (!parsed.ok) return parsed.response;

  try {
    const owned = await loadOwnedSlide(jobId, slideId, auth.user.id, auth.user.role);
    if (!owned.ok) return owned.response;
    const { slide } = owned;

    // ── Remove path: clear the image and return ──────────────────────────
    if (parsed.data?.remove) {
      return clearSlideImage(req, jobId, slideId, auth.user.id, auth.user.role);
    }

    // ── Generate path ────────────────────────────────────────────────────
    const result = await aiGenerateImageForSlide({
      title: slide.title,
      bullets: slide.bullets,
      speakerNotes: slide.speakerNotes ?? undefined,
    });

    const imageBytes = Buffer.from(result.image.data, 'base64');
    // Slide-scoped key; .png extension regardless of mime (the pptx renderer +
    // canvas both read via presigned URL / data URL, so the extension is
    // cosmetic). Overwrites any prior image for this slide.
    const s3Key = `decks/${jobId}/slides/${slideId}.png`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: imageBytes,
        ContentType: result.image.mimeType || 'image/png',
        Metadata: { jobId, slideId },
      }),
    );

    await db.slide.update({
      where: { id: slideId },
      data: { imageS3Key: s3Key, imagePrompt: result.prompt },
    });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_SLIDE_UPDATED,
      entityType: 'Slide',
      entityId: slideId,
      summary: 'Slide image generated (AI)',
      details: { jobId, imageS3Key: s3Key },
      ...extractRequestMetadata(req),
    });

    return jsonOk({
      imageS3Key: s3Key,
      imageUrl: await presignDownload(s3Key, IMAGE_URL_TTL_SECONDS),
    });
  } catch (err) {
    // Gemini offline / rate-limited / unparseable → graceful 503. The client
    // shows an "AI image builder offline" note; we never fabricate an image.
    if (err instanceof AiUnavailableError || err instanceof AiUnparseableError) {
      return jsonError(
        'AI_IMAGE_OFFLINE',
        'The AI image builder is temporarily unavailable. Please try again shortly.',
        503,
      );
    }
    return handleUnexpected(err);
  }
}

// Image uploads accepted from the Insert > Image ribbon control. Kept small —
// these are slide illustrations, not full-res scans.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ jobId: string; slideId: string }> },
) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { jobId, slideId } = await ctx.params;

  try {
    const owned = await loadOwnedSlide(jobId, slideId, auth.user.id, auth.user.role);
    if (!owned.ok) return owned.response;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError('INVALID_BODY', 'Expected multipart/form-data', 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return jsonError('NO_FILE', 'No image file provided', 400);
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return jsonError('BAD_TYPE', 'File must be a PNG, JPEG, WebP or GIF image', 415);
    }
    if (file.size === 0) return jsonError('EMPTY_FILE', 'Image file is empty', 400);
    if (file.size > MAX_IMAGE_BYTES) {
      return jsonError('TOO_LARGE', 'Image must be 8 MB or smaller', 413);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    // Reuse the slide-scoped key so an upload overwrites any prior AI image,
    // and a later AI generate overwrites the upload — one image per slide.
    const s3Key = `decks/${jobId}/slides/${slideId}.png`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: bytes,
        ContentType: file.type || 'image/png',
        Metadata: { jobId, slideId },
      }),
    );

    // Uploaded images have no AI prompt — clear any stale one.
    await db.slide.update({
      where: { id: slideId },
      data: { imageS3Key: s3Key, imagePrompt: null },
    });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_SLIDE_UPDATED,
      entityType: 'Slide',
      entityId: slideId,
      summary: 'Slide image uploaded',
      details: { jobId, imageS3Key: s3Key, bytes: file.size },
      ...extractRequestMetadata(req),
    });

    return jsonOk({
      imageS3Key: s3Key,
      imageUrl: await presignDownload(s3Key, IMAGE_URL_TTL_SECONDS),
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ jobId: string; slideId: string }> },
) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) {
    return jsonError('FORBIDDEN', 'Insufficient role', 403);
  }
  const { jobId, slideId } = await ctx.params;
  try {
    const owned = await loadOwnedSlide(jobId, slideId, auth.user.id, auth.user.role);
    if (!owned.ok) return owned.response;
    return clearSlideImage(req, jobId, slideId, auth.user.id, auth.user.role);
  } catch (err) {
    return handleUnexpected(err);
  }
}

/**
 * Clear a slide's image reference. We only null the DB pointer; the stored
 * object is harmless to leave (and the generate path overwrites the same key),
 * so we avoid a delete round-trip on the object store.
 */
async function clearSlideImage(
  req: Request,
  jobId: string,
  slideId: string,
  actorId: string,
  actorRole: Role,
) {
  await db.slide.update({
    where: { id: slideId },
    data: { imageS3Key: null, imagePrompt: null },
  });
  await audit({
    actorId,
    actorRole,
    eventType: AUDIT_EVENTS.DECK_SLIDE_UPDATED,
    entityType: 'Slide',
    entityId: slideId,
    summary: 'Slide image removed',
    details: { jobId },
    ...extractRequestMetadata(req),
  });
  return jsonOk({ imageS3Key: null, imageUrl: null });
}
