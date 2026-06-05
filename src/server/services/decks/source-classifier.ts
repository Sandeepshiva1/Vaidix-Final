// ════════════════════════════════════════════════════════════════════════════
// Source Classifier — decides how an uploaded source should become a deck.
// ════════════════════════════════════════════════════════════════════════════
// Two outcomes, mapped to DeckForgeJob.importMode:
//
//   VERBATIM      — the upload already IS a slide deck. Import it 1:1 (editable
//                   copy) and rasterise each original slide for the faithful
//                   preview. PPTX/PPT/Keynote are unambiguous; a PDF qualifies
//                   only when its pages look like slides (landscape + slide
//                   proportions across the deck).
//   AI_GENERATED  — the upload is prose (text PDF, DOCX, markdown, notes) or a
//                   typed topic; the model authors slides from its text.
//
// The PDF heuristic is deliberately cheap and dependency-light (pdf-lib only —
// already a project dependency; no rasterise/text-extract needed just to
// classify). Faculty can always override the verdict in the editor, so we bias
// toward NOT mislabelling a text document as slides (portrait ⇒ text).
// ════════════════════════════════════════════════════════════════════════════

import { PDFDocument } from 'pdf-lib';
import type { DeckImportMode } from '@prisma/client';

const PPTX_LIKE_MIMES = new Set<string>([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.apple.keynote', // .key
  'application/x-iwork-keynote-sffkey',
]);

const PDF_MIME = 'application/pdf';

export interface ClassifyResult {
  mode: DeckImportMode;
  /** Short, faculty-readable explanation — surfaced next to the override. */
  reason: string;
  /** 0..1 — how sure the heuristic is. Lower values are good override prompts. */
  confidence: number;
  pageCount?: number;
}

/**
 * Classify a source by mime + (for PDFs) page geometry. `buffer` is only read
 * for PDFs; pass it whenever available so PDFs can be auto-detected. Never
 * throws — an unreadable PDF degrades to AI_GENERATED with low confidence.
 */
export async function classifySource(args: {
  mimeType: string;
  buffer?: Buffer | null;
}): Promise<ClassifyResult> {
  if (PPTX_LIKE_MIMES.has(args.mimeType)) {
    return { mode: 'VERBATIM', reason: 'PowerPoint/Keynote — already a slide deck', confidence: 1 };
  }
  if (args.mimeType === PDF_MIME && args.buffer && args.buffer.byteLength > 0) {
    return classifyPdf(args.buffer);
  }
  // DOCX / DOC / Markdown / plain text / images / typed topic → author from text.
  return {
    mode: 'AI_GENERATED',
    reason: 'Prose / source material — slides authored from its text',
    confidence: 0.9,
  };
}

// Slide decks export landscape; text documents (A4/Letter) are portrait. Page
// orientation is the dominant signal; aspect ratio narrows landscape pages to
// genuine slide proportions (4:3 ≈ 1.33 … 16:9 ≈ 1.78) so a landscape *report*
// doesn't masquerade as a deck.
const SLIDE_AR_MIN = 1.25;
const SLIDE_AR_MAX = 1.95;
const LANDSCAPE_AR = 1.05;

async function classifyPdf(buf: Buffer): Promise<ClassifyResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(buf, { updateMetadata: false });
  } catch {
    return { mode: 'AI_GENERATED', reason: 'Unreadable PDF — defaulting to AI authoring', confidence: 0.4 };
  }
  const pages = doc.getPages();
  const n = pages.length;
  if (n === 0) {
    return { mode: 'AI_GENERATED', reason: 'Empty PDF', confidence: 0.4 };
  }

  let landscape = 0;
  let slideShaped = 0;
  for (const p of pages) {
    const { width, height } = p.getSize();
    if (width <= 0 || height <= 0) continue;
    const ar = width / height;
    if (ar > LANDSCAPE_AR) landscape++;
    if (ar >= SLIDE_AR_MIN && ar <= SLIDE_AR_MAX) slideShaped++;
  }
  const landscapeFrac = landscape / n;
  const slideFrac = slideShaped / n;

  if (landscapeFrac >= 0.7 && slideFrac >= 0.6) {
    return {
      mode: 'VERBATIM',
      reason: `${n}-page landscape PDF with slide proportions — treated as a slide deck`,
      confidence: Math.min(1, 0.6 + slideFrac * 0.4),
      pageCount: n,
    };
  }
  return {
    mode: 'AI_GENERATED',
    reason: 'PDF looks like a text document (portrait / non-slide page proportions)',
    confidence: 0.7,
    pageCount: n,
  };
}
