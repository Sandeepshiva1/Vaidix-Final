// ════════════════════════════════════════════════════════════════════════════
// Verbatim Import — bring an uploaded slide deck in "as is", NO LLM authoring.
// ════════════════════════════════════════════════════════════════════════════
// Used when the source classifier returns VERBATIM (a PPTX/PPT/Keynote, or a
// PDF whose pages look like slides). Produces:
//   • an EDITABLE copy — Slide rows mirroring the original 1:1 (title / bullets
//     / speaker notes / order). PPTX parses structurally via PptxDocument; a
//     slide-PDF has no structure so each page becomes an image-backed row.
//   • a pixel-faithful ORIGINAL — each slide rasterised to a PNG and stored on
//     Slide.sourceImageS3Key for the editor's "Original" view.
//
// The job is marked importMode = VERBATIM so the studio/editor know to offer the
// Original/Editable toggle. AI suggestions stay available on demand (the same
// opt-in Analyze flow) — we just never re-author the content here.
// ════════════════════════════════════════════════════════════════════════════

import { db } from '@/lib/db';
import { DeckForgeStatus, SlideLayout, type Prisma } from '@prisma/client';
import { PptxDocument } from '../pptx/pptx-document';
import { rasterizeSource, uploadSourceImages } from './slide-raster-service';
import { persistDeckAsDocument } from './deck-pptx-renderer';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface ImportedRow {
  layout: SlideLayout;
  title: string;
  bullets: string[];
  speakerNotes: string | null;
}

/**
 * Parse a .pptx into editable rows that mirror the deck 1:1. Title shape →
 * title; remaining text shapes → bullets (split on the shape's own line breaks);
 * notes slide → speakerNotes. First slide becomes a TITLE_ONLY hero, the rest
 * TITLE_BULLETS — a faithful-enough structure the faculty can refine. Throws
 * (caller catches) only on a corrupt archive.
 */
function pptxToRows(buf: Buffer): ImportedRow[] {
  const doc = PptxDocument.fromBuffer(buf);
  return doc.slides().map((slide, i): ImportedRow => {
    const titleShape = slide.shapes.find((s) => s.isTitle && s.text.trim());
    const bodyShapes = slide.shapes.filter(
      (s) => (!titleShape || s.slotId !== titleShape.slotId) && s.text.trim(),
    );
    // Title: the placeholder title, else the first text shape, else a stub.
    const title = (titleShape?.text ?? bodyShapes.shift()?.text ?? `Slide ${slide.index}`)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    // Bullets: each body shape's paragraphs (PptxShape.text joins them with \n).
    const bullets = bodyShapes
      .flatMap((s) => s.text.split('\n'))
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((b) => b.slice(0, 300));
    const notes = doc.notes(slide.index).trim() || null;
    return {
      layout: i === 0 && bullets.length === 0 ? SlideLayout.TITLE_ONLY : SlideLayout.TITLE_BULLETS,
      title,
      bullets,
      speakerNotes: notes,
    };
  });
}

export interface VerbatimImportResult {
  slideCount: number;
  /** How many original slides got a rasterised image (0 = LibreOffice absent / failed). */
  imagedCount: number;
}

/**
 * Import an already-a-deck source verbatim under an existing DeckForgeJob.
 * Best-effort on imagery: a missing rasteriser yields an editable-only deck.
 */
export async function importVerbatimDeck(opts: {
  jobId: string;
  requestedById: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<VerbatimImportResult> {
  const { jobId, requestedById, buffer, mimeType } = opts;

  await db.deckForgeJob.update({
    where: { id: jobId },
    data: { status: DeckForgeStatus.EXTRACTING },
  });

  // 1. Editable rows — structural for PPTX; deferred to image rows for PDF.
  let rows: ImportedRow[] = [];
  if (mimeType === PPTX_MIME) {
    try {
      rows = pptxToRows(buffer);
    } catch (e) {
      console.warn('[verbatim-import] PPTX parse failed; falling back to images', {
        jobId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2. Rasterise the originals (best-effort). PPTX needs LibreOffice; PDF direct.
  const pngs = await rasterizeSource(buffer, mimeType);

  // PDF (or PPTX parse failure): one image-backed row per rendered page.
  if (rows.length === 0) {
    rows = pngs.map(
      (_, i): ImportedRow => ({
        layout: SlideLayout.TITLE_ONLY,
        title: `Slide ${i + 1}`,
        bullets: [],
        speakerNotes: null,
      }),
    );
  }

  if (rows.length === 0) {
    throw new Error('No slides could be imported from the uploaded file');
  }

  // 3. Upload originals; align to rows by index (rows ≥ images is fine).
  const imageKeys = pngs.length
    ? await uploadSourceImages({ jobId, requestedById, pngs })
    : [];

  // 4. Persist rows + flag the job VERBATIM and ready for review.
  const slideRows: Prisma.SlideCreateManyInput[] = rows.map((r, i) => ({
    deckForgeJobId: jobId,
    order: i,
    layout: r.layout,
    title: r.title,
    bullets: r.bullets,
    speakerNotes: r.speakerNotes,
    sourceImageS3Key: imageKeys[i] ?? null,
  }));

  await db.$transaction(async (tx) => {
    await tx.slide.createMany({ data: slideRows });
    await tx.deckForgeJob.update({
      where: { id: jobId },
      data: {
        status: DeckForgeStatus.REVIEW_PENDING,
        slideCount: rows.length,
        importMode: 'VERBATIM',
      },
    });
  });

  // Surface in the documents library (best-effort, mirrors the AI path).
  await persistDeckAsDocument({ jobId }).catch(() => {});

  return { slideCount: rows.length, imagedCount: imageKeys.length };
}
