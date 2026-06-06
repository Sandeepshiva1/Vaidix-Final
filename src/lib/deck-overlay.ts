// ════════════════════════════════════════════════════════════════════════════
// Faithful-import overlay types — the editable text boxes laid over a slide's
// rasterised original so faculty can edit an uploaded deck in place without
// losing its look. Shared by the importer (which builds it from PPTX geometry),
// the slide PATCH API (which validates edits), and the editor (which renders +
// edits the boxes). All coordinates are fractions of the slide (0..1) so they
// scale to any rendered size.
// ════════════════════════════════════════════════════════════════════════════

export interface OverlayBox {
  /** Stable PPTX shape id (sN.spM) — lets a future export round-trip edits. */
  slotId: string;
  /** Current text (newline-separated paragraphs). Edited in place. */
  text: string;
  /** Bounding box as fractions of the slide width/height (0..1). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Shape fill (hex, no '#') used to mask the baked-in text while editing. */
  fillHex?: string | null;
  /** Font colour (hex, no '#'). */
  colorHex?: string | null;
  /** Font size as a fraction of slide height (0..1) — resolution-independent. */
  fontPct?: number | null;
  bold?: boolean;
  italic?: boolean;
  align?: 'l' | 'ctr' | 'r' | 'just' | null;
  valign?: 't' | 'ctr' | 'b' | null;
}

export interface SlideOverlay {
  boxes: OverlayBox[];
}

/** Narrow unknown JSON (Prisma `Json`) to a SlideOverlay, or null if unusable. */
export function asSlideOverlay(value: unknown): SlideOverlay | null {
  if (!value || typeof value !== 'object') return null;
  const boxes = (value as { boxes?: unknown }).boxes;
  if (!Array.isArray(boxes)) return null;
  const clean = boxes.filter(
    (b): b is OverlayBox =>
      !!b &&
      typeof b === 'object' &&
      typeof (b as OverlayBox).slotId === 'string' &&
      typeof (b as OverlayBox).text === 'string' &&
      ['x', 'y', 'w', 'h'].every((k) => typeof (b as Record<string, unknown>)[k] === 'number'),
  );
  return clean.length ? { boxes: clean } : null;
}
