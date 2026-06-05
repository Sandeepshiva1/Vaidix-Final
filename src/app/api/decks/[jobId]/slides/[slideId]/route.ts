// PATCH /api/decks/[jobId]/slides/[slideId] — edit one slide.

import { z } from 'zod';
import { Prisma, Role, SlideLayout } from '@prisma/client';
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
import { recordEditSignal } from '@/server/services/decks/faculty-style-profile';
import { FacultyEditSignalKind } from '@prisma/client';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

// An inserted table: a rectangular grid of cell strings (first row = header).
// Bounded so a malformed/huge payload can't blow up the slide or the export.
const TableSchema = z.object({
  rows: z
    .array(z.array(z.string().max(500)).min(1).max(8))
    .min(1)
    .max(12),
});

const PatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    bullets: z.array(z.string().min(1).max(200)).max(8).optional(),
    speakerNotes: z.string().max(2000).optional().nullable(),
    layout: z.nativeEnum(SlideLayout).optional(),
    accentHex: z
      .string()
      .regex(/^[0-9a-fA-F]{6}$/, 'accentHex must be 6 hex chars without #')
      .optional()
      .nullable(),
    // ── Ribbon text formatting ──────────────────────────────────────────────
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    fontScale: z.number().min(0.6).max(1.6).optional(),
    // ── Inserted table (null clears it) ─────────────────────────────────────
    tableJson: TableSchema.nullable().optional(),
  })
  .refine(
    (v) =>
      Object.keys(v).length > 0,
    { message: 'At least one field must be provided' },
  );

/**
 * Best-effort topic derivation from the deck's input title. The wizard
 * captures `inputTitle` from the source document or first-word-of-objective,
 * which is usually the topic ("Glaucoma management", "Uveitis basics"). We
 * lowercase + take the first content word as the tag. Imperfect but cheap
 * and good enough for the scoped-retrieval guard at distillation time.
 */
function deriveTopicTag(inputTitle: string | null | undefined): string | null {
  if (!inputTitle) return null;
  const cleaned = inputTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim();
  const first = cleaned.split(/\s+/)[0];
  return first && first.length > 2 ? first : null;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ jobId: string; slideId: string }> },
) {
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  if (!FACULTY_LIKE.includes(auth.user.role)) return jsonError('FORBIDDEN', 'Insufficient role', 403);
  const { jobId, slideId } = await ctx.params;
  const parsed = await parseBody(req, PatchBody);
  if (!parsed.ok) return parsed.response;

  try {
    const slide = await db.slide.findUnique({
      where: { id: slideId },
      select: {
        id: true,
        deckForgeJobId: true,
        title: true,
        bullets: true,
        speakerNotes: true,
        layout: true,
        job: {
          select: {
            requestedById: true,
            inputTitle: true,
            briefing: true,
          },
        },
      },
    });
    if (!slide || slide.deckForgeJobId !== jobId) {
      return jsonError('NOT_FOUND', 'Slide not found', 404);
    }
    if (
      slide.job.requestedById !== auth.user.id &&
      auth.user.role !== Role.ADMIN &&
      auth.user.role !== Role.PROGRAM_DIRECTOR
    ) {
      return jsonError('FORBIDDEN', 'Not your deck', 403);
    }
    const updated = await db.slide.update({
      where: { id: slideId },
      data: {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.bullets !== undefined ? { bullets: parsed.data.bullets } : {}),
        ...(parsed.data.speakerNotes !== undefined ? { speakerNotes: parsed.data.speakerNotes } : {}),
        ...(parsed.data.layout !== undefined ? { layout: parsed.data.layout } : {}),
        ...(parsed.data.accentHex !== undefined ? { accentHex: parsed.data.accentHex } : {}),
        ...(parsed.data.bold !== undefined ? { bold: parsed.data.bold } : {}),
        ...(parsed.data.italic !== undefined ? { italic: parsed.data.italic } : {}),
        ...(parsed.data.underline !== undefined ? { underline: parsed.data.underline } : {}),
        ...(parsed.data.fontScale !== undefined ? { fontScale: parsed.data.fontScale } : {}),
        ...(parsed.data.tableJson !== undefined ? { tableJson: parsed.data.tableJson ?? Prisma.DbNull } : {}),
      },
    });

    // Capture as a style-memory signal ONLY when the editor is the deck owner.
    // Admin/PD edits on someone else's deck must not pollute the owner's
    // profile (cross-user isolation) — and the admin's own profile shouldn't
    // learn from edits to other people's decks either.
    if (slide.job.requestedById === auth.user.id) {
      const briefing = (slide.job.briefing ?? null) as
        | { audience?: string; sessionType?: string }
        | null;
      const topicTag = deriveTopicTag(slide.job.inputTitle);
      const fieldsChanged = Object.keys(parsed.data);
      void recordEditSignal({
        facultyId: auth.user.id,
        kind: FacultyEditSignalKind.SLIDE_EDIT,
        topicTag,
        audienceTag: briefing?.audience ?? null,
        sessionType: briefing?.sessionType ?? null,
        jobId,
        slideId,
        instructionText: `Manual edit: ${fieldsChanged.join(', ')}`,
        beforeJson: {
          title: slide.title,
          bullets: slide.bullets,
          speakerNotes: slide.speakerNotes,
          layout: slide.layout,
        },
        afterJson: {
          title: updated.title,
          bullets: updated.bullets,
          speakerNotes: updated.speakerNotes,
          layout: updated.layout,
        },
      }).catch((err) => {
        console.warn('[style-profile] capture failed (non-fatal):', err);
      });
    }

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.DECK_SLIDE_UPDATED,
      entityType: 'Slide',
      entityId: slideId,
      summary: 'Slide edited',
      details: { jobId, fields: Object.keys(parsed.data) },
      ...extractRequestMetadata(req),
    });
    return jsonOk({ slide: updated });
  } catch (err) {
    return handleUnexpected(err);
  }
}
