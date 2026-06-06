// ════════════════════════════════════════════════════════════════════════════
// Deck slide "extras" — shared, DOM-free helpers for the PowerPoint-style
// editor features layered on top of the base Slide model:
//
//   • imageBox  — free placement/size of the slide image (drag + resize)
//   • richJson  — inline rich-text runs (per-selection bold/italic/underline)
//
// Used by the web editor (client), the slide PATCH API (validation/sanitise),
// and the .pptx export renderer (server). Everything here is pure and runs in
// both the browser and Node — the sanitiser deliberately avoids the DOM so it
// can guard the API and feed the export.
// ════════════════════════════════════════════════════════════════════════════

import type { SlideLayout } from '@prisma/client';

// ── Image placement ──────────────────────────────────────────────────────────

/** Image box as fractions of the slide (0..1). Mirrors PPTX EMU placement. */
export interface ImageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clamp a box so it always stays (mostly) on the slide and keeps a min size. */
export function clampImageBox(b: ImageBox): ImageBox {
  const w = Math.min(1, Math.max(0.05, b.w));
  const h = Math.min(1, Math.max(0.05, b.h));
  const x = Math.min(1 - w, Math.max(0, b.x));
  const y = Math.min(1 - h, Math.max(0, b.y));
  return { x, y, w, h };
}

/**
 * Default box for a slide that has an image but no explicit `imageBox` yet
 * (e.g. legacy AI-generated images, or a freshly inserted one). Picks a sensible
 * spot per layout so the image is visible on EVERY layout — historically images
 * only rendered on IMAGE_FOCUS / TITLE_BULLETS, so on other layouts the image
 * was stored but never drawn. This guarantees it shows.
 */
export function resolveImageBox(layout: SlideLayout, box?: ImageBox | null): ImageBox {
  if (box && Number.isFinite(box.x)) return clampImageBox(box);
  switch (layout) {
    case 'IMAGE_FOCUS':
      return { x: 0.07, y: 0.3, w: 0.86, h: 0.55 };
    case 'TITLE_BULLETS':
    case 'TWO_COLUMN':
      return { x: 0.55, y: 0.28, w: 0.38, h: 0.5 };
    default:
      return { x: 0.56, y: 0.26, w: 0.37, h: 0.46 };
  }
}

/** Narrow unknown JSON to an ImageBox, or null. */
export function asImageBox(value: unknown): ImageBox | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (['x', 'y', 'w', 'h'].every((k) => typeof v[k] === 'number')) {
    return { x: v.x as number, y: v.y as number, w: v.w as number, h: v.h as number };
  }
  return null;
}

// ── Inline rich text ─────────────────────────────────────────────────────────

/** Per-field rich-text HTML. Plain mirrors stay authoritative in title/bullets. */
export interface SlideRich {
  /** Sanitised HTML for the title (limited to <b>/<i>/<u>). */
  title?: string | null;
  /** Sanitised HTML per bullet, index-aligned with the slide's bullets[]. */
  bullets?: (string | null)[] | null;
}

const ALLOWED_INLINE = new Set(['b', 'i', 'u']);

/**
 * Sanitise contentEditable HTML down to a tiny, safe inline subset so it can be
 * stored and rendered with dangerouslySetInnerHTML without an XSS surface.
 * Keeps only <b>/<i>/<u> (mapping <strong>→<b>, <em>→<i>), drops ALL attributes
 * and every other tag, turns block boundaries into spaces, and collapses
 * whitespace. Returns '' for empty/decorative-only input.
 */
export function sanitizeRichHtml(input: string | null | undefined, maxLen = 4000): string {
  if (!input) return '';
  let s = input.slice(0, maxLen * 2);
  // Single pass over every tag: normalise/keep inline tags (bare, no attrs),
  // map block tags to a space, drop everything else.
  s = s.replace(/<(\/?)\s*([a-zA-Z0-9]+)\b[^>]*>/g, (_m, slash: string, nameRaw: string) => {
    const name = nameRaw.toLowerCase();
    if (name === 'strong') return slash ? '</b>' : '<b>';
    if (name === 'em') return slash ? '</i>' : '<i>';
    if (ALLOWED_INLINE.has(name)) return `<${slash}${name}>`;
    if (name === 'br' || name === 'div' || name === 'p' || name === 'li') return ' ';
    return '';
  });
  // Any stray angle brackets that weren't valid tags: neutralise.
  s = s.replace(/<(?![/]?[biu]>)/g, '&lt;');
  s = s.replace(/\s+/g, ' ').trim();
  // If nothing but empty tags remain, treat as empty.
  if (!stripHtml(s)) return '';
  return s.slice(0, maxLen);
}

/** Strip the inline subset back to plain text (for the title/bullets mirror). */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Escape plain text for safe injection into contentEditable as HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** A single formatting run, consumed by the .pptx renderer. */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * Parse the sanitised inline HTML into formatting runs for pptxgenjs. Maintains
 * nesting depth per tag so `<b>a<i>b</i></b>` yields the right per-run flags.
 * Returns a single plain run when there is no inline formatting.
 */
export function htmlToRuns(html: string | null | undefined): TextRun[] {
  const clean = sanitizeRichHtml(html ?? '');
  if (!clean) return [];
  const runs: TextRun[] = [];
  let b = 0,
    i = 0,
    u = 0;
  const re = /<(\/?)([biu])>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    if (m[3] !== undefined) {
      const text = decodeEntities(m[3]);
      if (text)
        runs.push({
          text,
          ...(b > 0 ? { bold: true } : {}),
          ...(i > 0 ? { italic: true } : {}),
          ...(u > 0 ? { underline: true } : {}),
        });
    } else {
      const close = m[1] === '/';
      const t = m[2].toLowerCase();
      const d = close ? -1 : 1;
      if (t === 'b') b = Math.max(0, b + d);
      else if (t === 'i') i = Math.max(0, i + d);
      else u = Math.max(0, u + d);
    }
  }
  return runs;
}

/** Narrow unknown JSON to a SlideRich, or null. */
export function asSlideRich(value: unknown): SlideRich | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const out: SlideRich = {};
  if (typeof v.title === 'string') out.title = v.title;
  if (Array.isArray(v.bullets))
    out.bullets = v.bullets.map((x) => (typeof x === 'string' ? x : null));
  return out.title !== undefined || out.bullets !== undefined ? out : null;
}
