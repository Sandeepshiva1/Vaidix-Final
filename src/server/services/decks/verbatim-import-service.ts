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
import { PptxDocument, CHROME_PH_TYPES, type PptxShape, type PptxSlide } from '../pptx/pptx-document';
import { rasterizeSource, uploadSourceImages } from './slide-raster-service';
import { persistDeckAsDocument } from './deck-pptx-renderer';
import type { SlideOverlay } from '@/lib/deck-overlay';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EMU_PER_PT = 12700; // 1 point = 12700 EMU

interface ImportedRow {
  layout: SlideLayout;
  title: string;
  bullets: string[];
  speakerNotes: string | null;
  /** Faithful editable overlay boxes (PPTX geometry), or null when unavailable. */
  overlay: SlideOverlay | null;
}

/**
 * Build the faithful editable overlay for one slide: every text shape that
 * carries an explicit frame becomes a box normalised to 0..1 of the slide, with
 * the style needed to render an editable box that sits over the rasterised
 * original. Returns null when no shape had usable geometry (the editor then
 * falls back to the themed canvas).
 */
function buildOverlay(slide: PptxSlide, size: { cx: number; cy: number }): SlideOverlay | null {
  const boxes = slide.shapes
    .filter((s) => s.frameEmu && s.text.trim())
    .map((s) => {
      const f = s.frameEmu!;
      return {
        slotId: s.slotId,
        text: s.text,
        x: f.x / size.cx,
        y: f.y / size.cy,
        w: f.cx / size.cx,
        h: f.cy / size.cy,
        fillHex: s.fillHex,
        colorHex: s.colorHex,
        fontPct: s.fontSizePt ? (s.fontSizePt * EMU_PER_PT) / size.cy : null,
        bold: s.bold,
        italic: s.italic,
        align: s.align,
        valign: s.valign,
      };
    });
  return boxes.length ? { boxes } : null;
}

/** A shape's text is just a page number / chrome token (e.g. "2", "12 / 22"). */
function isPageNumberish(text: string): boolean {
  return /^[\s\d/.,–—-]+$/.test(text); // digits + separators only
}

/** True when this shape is deck chrome (slide number, footer, date) — never content. */
function isChromeShape(s: PptxShape): boolean {
  return s.phType != null && CHROME_PH_TYPES.has(s.phType);
}

/**
 * Choose the title shape for a slide. Prefer the real title placeholder; if the
 * template has none (common in custom institutional decks), fall back to the
 * first *content* shape that isn't deck chrome (slide number / footer / date)
 * and isn't a bare page number — so the title never collapses to "2".
 */
function pickTitleShape(content: PptxShape[]): PptxShape | undefined {
  const titlePh = content.find((s) => s.isTitle && s.text.trim());
  if (titlePh) return titlePh;
  return content.find((s) => !isPageNumberish(s.text.trim()));
}

/**
 * Parse a .pptx into editable rows that mirror the deck 1:1. Title shape →
 * title; remaining text shapes → bullets (split on the shape's own line breaks);
 * notes slide → speakerNotes. Deck chrome (slide number / footer / date
 * placeholders) is dropped so it can't masquerade as the title or pollute the
 * bullets. First slide becomes a TITLE_ONLY hero, the rest TITLE_BULLETS — a
 * faithful-enough structure the faculty can refine. Throws (caller catches)
 * only on a corrupt archive.
 */
function pptxToRows(buf: Buffer): ImportedRow[] {
  const doc = PptxDocument.fromBuffer(buf);
  const size = doc.slideSize();
  return doc.slides().map((slide, i): ImportedRow => {
    // Authored content only — exclude chrome placeholders and empty shapes.
    const content = slide.shapes.filter((s) => s.text.trim() && !isChromeShape(s));
    const titleShape = pickTitleShape(content);
    const bodyShapes = content.filter((s) => s.slotId !== titleShape?.slotId);
    // Title: the chosen content title, else a stub (never a page number).
    const title = (titleShape?.text ?? `Slide ${slide.index}`)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 200);
    // Bullets: each body shape's paragraphs (PptxShape.text joins them with \n),
    // minus any stray page-number tokens.
    const bullets = bodyShapes
      .flatMap((s) => s.text.split('\n'))
      .map((b) => b.trim())
      .filter((b) => b && !isPageNumberish(b))
      .slice(0, 12)
      .map((b) => b.slice(0, 300));
    const notes = doc.notes(slide.index).trim() || null;
    return {
      layout: i === 0 && bullets.length === 0 ? SlideLayout.TITLE_ONLY : SlideLayout.TITLE_BULLETS,
      title,
      bullets,
      speakerNotes: notes,
      overlay: buildOverlay(slide, size),
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
        overlay: null,
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
    overlayJson: r.overlay ? (r.overlay as unknown as Prisma.InputJsonValue) : undefined,
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
