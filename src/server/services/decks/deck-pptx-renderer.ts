// ════════════════════════════════════════════════════════════════════════════
// Deck PPTX Renderer
// ════════════════════════════════════════════════════════════════════════════
// Server-side .pptx renderer used by both the on-demand export route and the
// auto-save-to-Document pipeline. Theme + layouts are ported from the
// standalone vaidix-pptx-generator.html so the on-screen and exported decks
// read the same.

import PptxGenJS from 'pptxgenjs';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  DocumentKind,
  DocumentRoute,
  DocumentStatus,
  type SlideLayout,
} from '@prisma/client';
import { db } from '@/lib/db';
import { s3, BUCKET } from '@/lib/storage';
import { getDeckTheme, type PptxColors } from '@/lib/deck-themes';
import {
  type ImageBox,
  type SlideRich,
  htmlToRuns,
  resolveImageBox,
} from '@/lib/deck-slide-extras';

const LAYOUT_W = 13.33; // wide layout
const LAYOUT_H = 7.5;

export const DECK_PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface SlideRow {
  layout: SlideLayout;
  title: string;
  bullets: string[];
  speakerNotes: string | null;
  accentHex: string | null;
  // ── Ribbon text formatting (mirrors the web SlideCanvas) ──────────────────
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontScale: number;
  /** Optional inserted table (row 0 = header); null when none. */
  table: {
    rows: string[][];
    headerHex?: string | null;
    colWidths?: number[] | null;
    widthPct?: number | null;
  } | null;
  /** Free image placement/size (fractions 0..1); null = layout default box. */
  imageBox: ImageBox | null;
  /** Inline rich-text runs for title/bullets; null = plain text. */
  rich: SlideRich | null;
  /**
   * Pre-resolved image data URL (e.g. `data:image/png;base64,...`). Populated
   * by renderDeckPptxBuffer before per-slide render; null when generation was
   * skipped (non-IMAGE_FOCUS) or the S3 fetch failed. renderImageFocus uses
   * it directly with pptxgenjs's addImage; falls back to the dashed
   * placeholder when null.
   */
  imageDataUrl: string | null;
}

function accentOf(s: SlideRow, c: PptxColors): string {
  return s.accentHex && /^[0-9a-fA-F]{6}$/.test(s.accentHex) ? s.accentHex : c.primary;
}

/**
 * Text options for the slide's title/body that honour the ribbon formatting:
 * `fontScale` multiplies the base point size, and bold/italic/underline merge
 * in (a layout can force bold/italic — e.g. a title — via `force`). Spread the
 * result into an addText() options object after the static props.
 */
function fmtText(
  s: SlideRow,
  basePt: number,
  force?: { bold?: boolean; italic?: boolean },
): Partial<PptxGenJS.TextPropsOptions> {
  const scale = s.fontScale && s.fontScale > 0 ? s.fontScale : 1;
  const o: Partial<PptxGenJS.TextPropsOptions> = {
    fontSize: Math.round(basePt * scale * 10) / 10,
  };
  if (force?.bold || s.bold) o.bold = true;
  if (force?.italic || s.italic) o.italic = true;
  if (s.underline) o.underline = { style: 'sng' };
  return o;
}

type TP = PptxGenJS.TextProps;

/**
 * Build pptx runs for a single-line field (title/body/quote) from its inline
 * HTML. Returns the plain string when there's no rich formatting so callers can
 * pass it straight to addText alongside the static fmtText() options.
 */
function richRuns(
  html: string | null | undefined,
  plain: string,
  s: SlideRow,
  force?: { bold?: boolean; italic?: boolean },
): string | TP[] {
  const runs = htmlToRuns(html);
  if (!runs.length) return plain;
  return runs.map((r) => ({
    text: r.text,
    options: {
      ...(r.bold || s.bold || force?.bold ? { bold: true } : {}),
      ...(r.italic || s.italic || force?.italic ? { italic: true } : {}),
      ...(r.underline || s.underline ? { underline: { style: 'sng' as const } } : {}),
    },
  }));
}

/**
 * Build a bulleted paragraph list with per-bullet rich runs. Each bullet may
 * expand to several runs; only the first carries the bullet glyph and only the
 * last breaks the line, so a single bullet keeps mixed formatting on one row.
 * `startIdx` offsets into rich.bullets for the right/second column.
 */
function bulletParas(s: SlideRow, bullets: string[], startIdx = 0): TP[] {
  const out: TP[] = [];
  bullets.forEach((b, i) => {
    const runs = htmlToRuns(s.rich?.bullets?.[startIdx + i]);
    const parts = runs.length ? runs : [{ text: b }];
    parts.forEach((r, j) => {
      out.push({
        text: r.text,
        options: {
          ...(j === 0 ? { bullet: { code: '25B8' } } : {}),
          ...(j === parts.length - 1 ? { breakLine: true } : {}),
          ...(r.bold || s.bold ? { bold: true } : {}),
          ...(r.italic || s.italic ? { italic: true } : {}),
          ...(r.underline || s.underline ? { underline: { style: 'sng' as const } } : {}),
        },
      });
    });
  });
  return out;
}

/**
 * Paint the slide image at its placement box (any layout). Mirrors the web
 * canvas's floating image. `contain` keeps anatomy proportions. No-op without an
 * image. Drawn after the body/table so it floats above, like the canvas.
 */
function renderImage(s: PptxGenJS.Slide, slide: SlideRow) {
  if (!slide.imageDataUrl) return;
  const box = resolveImageBox(slide.layout, slide.imageBox);
  const w = box.w * LAYOUT_W;
  const h = box.h * LAYOUT_H;
  s.addImage({
    data: slide.imageDataUrl,
    x: box.x * LAYOUT_W,
    y: box.y * LAYOUT_H,
    w,
    h,
    sizing: { type: 'contain', w, h },
  });
}

function addHeader(slide: PptxGenJS.Slide, n: number, total: number, c: PptxColors) {
  slide.addShape('rect', {
    x: 0, y: 0, w: LAYOUT_W, h: 0.52,
    fill: { color: c.titleBg }, line: { color: c.panelBg, width: 0.5 },
  });
  slide.addShape('rect', {
    x: 0, y: 0.52, w: LAYOUT_W / 2, h: 0.028,
    fill: { color: c.primary }, line: { type: 'none' },
  });
  slide.addShape('rect', {
    x: LAYOUT_W / 2, y: 0.52, w: LAYOUT_W / 2, h: 0.028,
    fill: { color: c.secondary }, line: { type: 'none' },
  });
  slide.addText('VAIDIX', {
    x: 0.3, y: 0.07, w: 2.5, h: 0.28,
    fontSize: 15, bold: true, color: c.primary, fontFace: 'Georgia', charSpacing: 1.2,
  });
  slide.addText('LV Prasad Eye Institute', {
    x: 0.3, y: 0.36, w: 3, h: 0.14,
    fontSize: 6.5, color: c.text40, charSpacing: 1.5,
  });
  slide.addText(
    `${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    {
      x: LAYOUT_W - 1.3, y: 0.17, w: 1.1, h: 0.18,
      fontSize: 9, color: c.text40, fontFace: 'Courier New', align: 'right',
    },
  );
}

function addFooter(slide: PptxGenJS.Slide, deckTitle: string, c: PptxColors) {
  slide.addShape('rect', {
    x: 0, y: LAYOUT_H - 0.42, w: LAYOUT_W, h: 0.42,
    fill: { color: c.bg }, line: { color: c.panelBg, width: 0.5 },
  });
  slide.addText(deckTitle, {
    x: 0.3, y: LAYOUT_H - 0.34, w: 7, h: 0.22,
    fontSize: 7.5, color: c.text40,
  });
  slide.addText('LV Prasad Eye Institute · Confidential', {
    x: 6, y: LAYOUT_H - 0.34, w: 7, h: 0.22,
    fontSize: 7.5, color: c.text40, align: 'right',
  });
}

function renderTitleOnly(
  s: PptxGenJS.Slide,
  slide: SlideRow,
  deckTitle: string,
  accent: string,
  c: PptxColors,
) {
  s.background = { color: c.titleBg };
  s.addText(deckTitle.toUpperCase(), {
    x: 0.7, y: 1.4, w: 11.9, h: 0.3,
    fontSize: 11, bold: true, color: accent, charSpacing: 4,
  });
  s.addText(richRuns(slide.rich?.title, slide.title, slide, { bold: true }), {
    x: 0.7, y: 1.85, w: 11.9, h: 3,
    ...fmtText(slide, 56, { bold: true }), color: c.text, fontFace: 'Georgia', lineSpacingMultiple: 1.05,
  });
  s.addShape('rect', {
    x: 0.7, y: 5.0, w: 1.6, h: 0.045,
    fill: { color: accent }, line: { type: 'none' },
  });
}

function renderClosing(s: PptxGenJS.Slide, slide: SlideRow, accent: string, c: PptxColors) {
  s.background = { color: c.titleBg };
  s.addText(richRuns(slide.rich?.title, slide.title, slide, { bold: true }), {
    x: 0.7, y: 2.4, w: 11.9, h: 2,
    ...fmtText(slide, 64, { bold: true }), color: c.text, align: 'center', fontFace: 'Georgia',
  });
  if (slide.bullets.length > 0) {
    s.addText(slide.bullets.join('  ·  '), {
      x: 1.5, y: 4.6, w: 10.3, h: 0.6,
      ...fmtText(slide, 16), color: c.text65, align: 'center',
    });
  }
  s.addShape('rect', {
    x: LAYOUT_W / 2 - 0.6, y: 5.4, w: 1.2, h: 0.04,
    fill: { color: accent }, line: { type: 'none' },
  });
}

function renderTitleBullets(s: PptxGenJS.Slide, slide: SlideRow, accent: string, c: PptxColors) {
  s.background = { color: c.contentBg };
  s.addText(richRuns(slide.rich?.title, slide.title, slide, { bold: true }), {
    x: 0.7, y: 0.95, w: 11.9, h: 1.0,
    ...fmtText(slide, 30, { bold: true }), color: c.text, fontFace: 'Georgia', lineSpacingMultiple: 1.15,
  });
  s.addShape('rect', {
    x: 0.7, y: 2.0, w: 1.0, h: 0.04,
    fill: { color: accent }, line: { type: 'none' },
  });
  if (slide.bullets.length > 0) {
    s.addText(
      bulletParas(slide, slide.bullets),
      {
        x: 0.9, y: 2.4, w: 11.5, h: 4.2,
        ...fmtText(slide, 18), color: c.text85, lineSpacingMultiple: 1.45, valign: 'top', paraSpaceAfter: 8,
      },
    );
  }
}

function renderTwoColumn(s: PptxGenJS.Slide, slide: SlideRow, accent: string, c: PptxColors) {
  s.background = { color: c.contentBg };
  s.addText(richRuns(slide.rich?.title, slide.title, slide, { bold: true }), {
    x: 0.7, y: 0.95, w: 11.9, h: 1.0,
    ...fmtText(slide, 28, { bold: true }), color: c.text, fontFace: 'Georgia',
  });
  s.addShape('rect', {
    x: 0.7, y: 2.0, w: 1.0, h: 0.04,
    fill: { color: accent }, line: { type: 'none' },
  });
  const half = Math.ceil(slide.bullets.length / 2);
  const left = slide.bullets.slice(0, half);
  const right = slide.bullets.slice(half);
  if (left.length > 0) {
    s.addText(
      bulletParas(slide, left, 0),
      { x: 0.9, y: 2.4, w: 5.7, h: 4.2, ...fmtText(slide, 16), color: c.text85, lineSpacingMultiple: 1.4 },
    );
  }
  if (right.length > 0) {
    s.addText(
      bulletParas(slide, right, half),
      { x: 6.9, y: 2.4, w: 5.7, h: 4.2, ...fmtText(slide, 16), color: c.text85, lineSpacingMultiple: 1.4 },
    );
  }
}

function renderQuote(s: PptxGenJS.Slide, slide: SlideRow, accent: string, c: PptxColors) {
  s.background = { color: c.titleBg };
  s.addText('"', {
    x: 0.9, y: 1.6, w: 1, h: 1.6,
    fontSize: 110, color: accent, fontFace: 'Georgia',
  });
  s.addText(richRuns(slide.rich?.title, slide.title, slide, { italic: true }), {
    x: 1.5, y: 2.6, w: 10.5, h: 2.5,
    ...fmtText(slide, 26, { italic: true }), color: c.text, fontFace: 'Georgia', lineSpacingMultiple: 1.4,
  });
  if (slide.bullets[0]) {
    s.addText(`— ${slide.bullets[0]}`, {
      x: 1.5, y: 5.2, w: 10.5, h: 0.5,
      ...fmtText(slide, 14, { italic: true }), color: c.text65,
    });
  }
}

function renderInteraction(s: PptxGenJS.Slide, slide: SlideRow, accent: string, c: PptxColors) {
  s.background = { color: c.contentBg };
  s.addShape('rect', {
    x: 0.7, y: 0.95, w: 1.4, h: 0.36,
    fill: { color: accent }, line: { type: 'none' },
  });
  s.addText('INTERACT', {
    x: 0.7, y: 0.95, w: 1.4, h: 0.36,
    fontSize: 10, bold: true, color: c.bg, align: 'center', valign: 'middle', charSpacing: 3,
  });
  s.addText(richRuns(slide.rich?.title, slide.title, slide, { bold: true }), {
    x: 0.7, y: 1.55, w: 11.9, h: 1.4,
    ...fmtText(slide, 28, { bold: true }), color: c.text, fontFace: 'Georgia',
  });
  for (let i = 0; i < slide.bullets.length; i++) {
    const y = 3.2 + i * 0.7;
    s.addShape('rect', {
      x: 0.9, y, w: 11.5, h: 0.6,
      fill: { color: c.panelBg }, line: { color: c.panelDark, width: 0.5 },
    });
    s.addText(`${String.fromCharCode(65 + i)}.`, {
      x: 1.05, y, w: 0.5, h: 0.6,
      fontSize: 16, bold: true, color: accent, valign: 'middle',
    });
    s.addText(richRuns(slide.rich?.bullets?.[i], slide.bullets[i], slide), {
      x: 1.55, y, w: 10.7, h: 0.6,
      ...fmtText(slide, 14), color: c.text85, valign: 'middle',
    });
  }
}

function renderImageFocus(s: PptxGenJS.Slide, slide: SlideRow, accent: string, c: PptxColors) {
  s.background = { color: c.contentBg };
  s.addText(richRuns(slide.rich?.title, slide.title, slide, { bold: true }), {
    x: 0.7, y: 0.95, w: 11.9, h: 0.9,
    ...fmtText(slide, 26, { bold: true }), color: c.text, fontFace: 'Georgia',
  });
  // The actual image is painted by the generic renderImage() (honours imageBox
  // and works on every layout). Here we only draw the dashed placeholder when
  // the slide has no image yet.
  if (!slide.imageDataUrl) {
    s.addShape('rect', {
      x: 0.9, y: 2.1, w: 11.5, h: 4.0,
      fill: { color: c.panelDark }, line: { color: accent, width: 1.2, dashType: 'dash' },
    });
    s.addText('[ Image / OCT / fundus photo placeholder ]', {
      x: 0.9, y: 3.8, w: 11.5, h: 0.5,
      fontSize: 12, color: c.text40, align: 'center',
    });
  }
  if (slide.bullets[0]) {
    s.addText(richRuns(slide.rich?.bullets?.[0], slide.bullets[0], slide), {
      x: 0.9, y: 6.3, w: 11.5, h: 0.5,
      ...fmtText(slide, 14), color: c.text85,
    });
  }
}

// Inserted table — drawn in the lower band of the content area (above the
// footer), mirroring the web canvas where the table renders below the body.
function renderTable(s: PptxGenJS.Slide, slide: SlideRow, c: PptxColors) {
  const t = slide.table;
  if (!t || t.rows.length === 0) return;
  const scale = slide.fontScale && slide.fontScale > 0 ? slide.fontScale : 1;
  const headerFill =
    t.headerHex && /^[0-9a-fA-F]{6}$/.test(t.headerHex) ? t.headerHex : c.panelBg;
  const rows: PptxGenJS.TableRow[] = t.rows.map((row, ri) =>
    row.map((cell) => ({
      text: cell,
      options: {
        bold: ri === 0 || slide.bold,
        italic: slide.italic,
        ...(slide.underline ? { underline: { style: 'sng' as const } } : {}),
        color: ri === 0 ? c.text : c.text85,
        fill: { color: ri === 0 ? headerFill : c.contentBg },
        align: 'left' as const,
        valign: 'middle' as const,
      },
    })),
  );
  const fullW = 11.93;
  const tableW = fullW * (t.widthPct && t.widthPct > 0 ? Math.min(1, t.widthPct) : 1);
  const nCols = t.rows[0]?.length ?? 0;
  // Per-column widths (inches), honouring dragged colWidths; else equal columns.
  let colW: number[] | undefined;
  if (t.colWidths && t.colWidths.length === nCols && nCols > 0) {
    const sum = t.colWidths.reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
    colW = t.colWidths.map((x) => (x > 0 ? x : 0.0001) / sum * tableW);
  }
  s.addTable(rows, {
    x: 0.7,
    y: 4.55,
    w: tableW,
    ...(colW ? { colW } : {}),
    border: { type: 'solid', pt: 0.5, color: c.panelBg },
    fontSize: Math.round(12 * scale * 10) / 10,
    color: c.text85,
    valign: 'middle',
    autoPage: false,
  });
}

function renderSlide(
  pptx: PptxGenJS,
  slide: SlideRow,
  index: number,
  total: number,
  deckTitle: string,
  c: PptxColors,
) {
  const s = pptx.addSlide();
  const accent = accentOf(slide, c);
  switch (slide.layout) {
    case 'TITLE_ONLY':    renderTitleOnly(s, slide, deckTitle, accent, c); break;
    case 'CLOSING':       renderClosing(s, slide, accent, c); break;
    case 'TWO_COLUMN':    renderTwoColumn(s, slide, accent, c); break;
    case 'QUOTE':         renderQuote(s, slide, accent, c); break;
    case 'INTERACTION':   renderInteraction(s, slide, accent, c); break;
    case 'IMAGE_FOCUS':   renderImageFocus(s, slide, accent, c); break;
    case 'TITLE_BULLETS':
    default:              renderTitleBullets(s, slide, accent, c);
  }
  renderTable(s, slide, c);
  renderImage(s, slide);
  addHeader(s, index + 1, total, c);
  addFooter(s, deckTitle, c);
  if (slide.speakerNotes) s.addNotes(slide.speakerNotes);
  return s;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RenderedDeck {
  buffer: Buffer;
  slideCount: number;
  deckTitle: string;
  requestedById: string;
}

/**
 * Load a forge job's slides and render to a .pptx buffer. Returns null if the
 * job has no slides yet (e.g. forge failed mid-flight).
 */
async function fetchSlideImageDataUrl(s3Key: string): Promise<string | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
    const stream = out.Body as AsyncIterable<Uint8Array> | undefined;
    if (!stream) return null;
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const buf = Buffer.concat(chunks);
    const mime = out.ContentType ?? 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    // Treat missing/unreachable images the same as a non-existent key —
    // renderer falls back to the placeholder. Logged for triage.
    console.warn('[deck-pptx-renderer] image fetch failed', {
      s3Key,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export async function renderDeckPptxBuffer(opts: {
  jobId: string;
  authorName: string;
}): Promise<RenderedDeck | null> {
  const job = await db.deckForgeJob.findUnique({
    where: { id: opts.jobId },
    select: {
      id: true,
      inputTitle: true,
      requestedById: true,
      template: true,
      backgroundHex: true,
      slides: { orderBy: { order: 'asc' } },
    },
  });
  if (!job || job.slides.length === 0) return null;

  const theme = getDeckTheme(job.template);
  // A per-deck background override replaces every slide-body fill (title +
  // content + base), matching the web canvas. Header/footer panels and accents
  // stay theme-driven so the deck keeps its structure. PptxGenJS wants hex
  // without '#'; the column already stores it that way.
  const c: PptxColors = job.backgroundHex
    ? { ...theme.pptx, bg: job.backgroundHex, titleBg: job.backgroundHex, contentBg: job.backgroundHex }
    : theme.pptx;

  // Pre-resolve image data URLs in parallel before rendering. pptxgenjs is
  // synchronous from this point on, and re-fetching per slide would serialise
  // S3 calls inside the forEach loop.
  const imageDataUrls = await Promise.all(
    job.slides.map((s) =>
      s.imageS3Key ? fetchSlideImageDataUrl(s.imageS3Key) : Promise.resolve(null),
    ),
  );

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = job.inputTitle ?? 'Vaidix Deck';
  pptx.company = 'LV Prasad Eye Institute';
  pptx.author = opts.authorName;

  const deckTitle = job.inputTitle ?? 'Vaidix Deck';
  const total = job.slides.length;
  job.slides.forEach((s, i) => {
    renderSlide(
      pptx,
      {
        layout: s.layout,
        title: s.title,
        bullets: s.bullets,
        speakerNotes: s.speakerNotes,
        accentHex: s.accentHex,
        bold: s.bold,
        italic: s.italic,
        underline: s.underline,
        fontScale: s.fontScale,
        table: s.tableJson as unknown as { rows: string[][]; headerHex?: string | null } | null,
        imageBox: (s.imageBox as unknown as ImageBox | null) ?? null,
        rich: (s.richJson as unknown as SlideRich | null) ?? null,
        imageDataUrl: imageDataUrls[i],
      },
      i, total, deckTitle, c,
    );
  });

  const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return { buffer, slideCount: total, deckTitle, requestedById: job.requestedById };
}

/**
 * Render the latest slides for a DeckForgeJob, upload to S3, and upsert a
 * Document row (matched by deckForgeJobId) so the forged deck shows up in the
 * faculty's documents library. Idempotent — on re-render it overwrites both
 * the S3 object and the Document metadata. Soft-deleted Documents are NOT
 * revived; a fresh row is created instead so the user's deletion sticks.
 *
 * Best-effort by design: if rendering or upload fails, returns null so the
 * caller (forge / finalize / export) can continue without surfacing the
 * failure to the user. Errors are logged.
 */
export async function persistDeckAsDocument(opts: {
  jobId: string;
}): Promise<{ documentId: string } | null> {
  try {
    const job = await db.deckForgeJob.findUnique({
      where: { id: opts.jobId },
      select: { id: true, requestedById: true },
    });
    if (!job) return null;

    const uploader = await db.user.findUnique({
      where: { id: job.requestedById },
      select: { name: true },
    });
    const authorName = uploader?.name ?? 'Vaidix';

    const rendered = await renderDeckPptxBuffer({ jobId: opts.jobId, authorName });
    if (!rendered) return null;

    const s3Key = `documents/deck-forge/${job.requestedById}/${opts.jobId}.pptx`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
        Body: rendered.buffer,
        ContentType: DECK_PPTX_MIME,
      }),
    );

    const existing = await db.document.findFirst({
      where: { deckForgeJobId: opts.jobId, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      await db.document.update({
        where: { id: existing.id },
        data: {
          title: rendered.deckTitle,
          s3Key,
          sizeBytes: BigInt(rendered.buffer.byteLength),
          pageCount: rendered.slideCount,
          mimeType: DECK_PPTX_MIME,
          kind: DocumentKind.PPT,
          route: DocumentRoute.DECK_FORGE,
        },
      });
      return { documentId: existing.id };
    }

    const created = await db.document.create({
      data: {
        uploadedById: job.requestedById,
        title: rendered.deckTitle,
        kind: DocumentKind.PPT,
        route: DocumentRoute.DECK_FORGE,
        s3Key,
        sizeBytes: BigInt(rendered.buffer.byteLength),
        pageCount: rendered.slideCount,
        mimeType: DECK_PPTX_MIME,
        status: DocumentStatus.UPLOADED,
        visibility: DocumentStatus.PRIVATE_FACULTY,
        deckForgeJobId: opts.jobId,
      },
      select: { id: true },
    });
    return { documentId: created.id };
  } catch (err) {
    console.error('[deck-pptx-renderer] persistDeckAsDocument failed', {
      jobId: opts.jobId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
