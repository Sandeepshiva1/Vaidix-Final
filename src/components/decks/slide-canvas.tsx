'use client';

// ════════════════════════════════════════════════════════════════════════════
// SlideCanvas — visual renderer used by both the editor preview and the
// fullscreen presenter. Pure (no data fetching), drives off a normalized
// Slide prop. Intentionally mirrors the layout vocabulary of the .pptx
// export so on-screen and exported decks read the same.
// ════════════════════════════════════════════════════════════════════════════

import { type CSSProperties, useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { SlideLayout } from '@prisma/client';
import { getDeckTheme, type DeckTheme } from '@/lib/deck-themes';
import { cn } from '@/lib/utils';

// ── Inline editable text ──────────────────────────────────────────────────────
// Wraps a native element as contentEditable. The DOM manages its own content
// while the user is typing (no React reconciliation conflicts). On blur the
// final text is committed via `onCommit`. Pressing Enter commits immediately;
// Escape discards and restores the original value.
function EditText({
  value,
  onCommit,
  placeholder,
  tag: Tag = 'span',
  style,
  className,
  singleLine = false,
  autoFocus = false,
  onEnter,
  onDeleteEmpty,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  tag?: 'h1' | 'h2' | 'p' | 'span';
  style?: CSSProperties;
  className?: string;
  singleLine?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
  onDeleteEmpty?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);

  // Sync DOM ← React only when element is not focused (prevents caret reset while typing).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  // Auto-focus for newly created rows (PPT behaviour: Enter creates + focuses next bullet).
  useEffect(() => {
    if (!autoFocus || !ref.current) return;
    const el = ref.current;
    el.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  return (
    <Tag
      ref={ref as never}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      onFocus={(e: React.FocusEvent<HTMLElement>) => {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(e.currentTarget);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }}
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        const text = (e.currentTarget.textContent ?? '').trim();
        if (!text) {
          e.currentTarget.textContent = value;
          return;
        }
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        const el = e.currentTarget;
        if (e.key === 'Enter') {
          e.preventDefault();
          if (onEnter) {
            // Commit current content first, then fire onEnter to create next row.
            const text = (el.textContent ?? '').trim();
            if (text && text !== value) onCommit(text);
            onEnter();
          } else if (singleLine) {
            el.blur();
          }
        }
        if (e.key === 'Escape') {
          el.textContent = value;
          el.blur();
        }
        if (e.key === 'Backspace' && !el.textContent?.trim() && onDeleteEmpty) {
          e.preventDefault();
          onDeleteEmpty();
        }
      }}
      onPaste={(e: React.ClipboardEvent<HTMLElement>) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      }}
      style={{ ...style, cursor: 'text', outline: 'none' }}
      className={cn(
        className,
        'rounded-sm transition-all min-w-0.5',
        'hover:ring-1 hover:ring-white/25',
        'focus:ring-1 focus:ring-white/60 focus:bg-black/8',
      )}
    />
  );
}

/** An inserted table: a rectangular grid of cell strings (row 0 = header). */
export interface SlideTable {
  rows: string[][];
}

export interface SlideViewModel {
  id: string;
  order: number;
  layout: SlideLayout;
  title: string;
  bullets: string[];
  speakerNotes: string | null;
  accentHex: string | null;
  imageS3Key: string | null;
  imageUrl: string | null;
  /**
   * Faithful-import original: presigned URL of the rasterised ORIGINAL slide
   * (PPTX/PDF page) for VERBATIM decks. Null on AI-generated slides. The editor
   * shows this in the "Original" view; SlideCanvas itself ignores it.
   */
  sourceImageUrl?: string | null;
  // ── Ribbon text formatting (optional; default to unformatted) ─────────────
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Multiplies the computed title/body font size. 1 = theme default. */
  fontScale?: number;
  /** Optional table inserted via Insert > Table; null/undefined = none. */
  tableJson?: SlideTable | null;
  /**
   * Faithful-import editable overlay: text boxes positioned over sourceImageUrl
   * (from the original PPTX geometry). When present, the editor edits the deck
   * in place on the original instead of the themed canvas. Null on AI decks.
   */
  overlay?: import('@/lib/deck-overlay').SlideOverlay | null;
}

interface SlideCanvasProps {
  slide: SlideViewModel;
  index: number;
  total: number;
  deckTitle: string;
  /** preview = inside an editor card; present = fullscreen */
  mode?: 'preview' | 'present';
  themeId?: string;
  /**
   * Per-deck background override (6-char hex, no '#'). When set it replaces the
   * theme's default slide background (root + footer fill). Null/undefined falls
   * back to the theme. Header panel + accents stay theme-driven so the slide
   * keeps its structure.
   */
  backgroundHex?: string | null;
  /** CSS font-family string to apply to all slide text (deck-wide selection). */
  fontFamily?: string;
  /** When true, title and bullets are directly editable on the canvas (PPT-style). */
  editable?: boolean;
  onTitleChange?: (title: string) => void;
  onBulletChange?: (index: number, value: string) => void;
  /** Called when the user types into the empty "new bullet" row and blurs. */
  onCommitNewBullet?: (value: string) => void;
  /** Called when Enter is pressed on a bullet or the explicit "add" row is clicked. */
  onAddBullet?: () => void;
  /** Called when Backspace is pressed on an empty bullet to remove it. */
  onDeleteBullet?: (index: number) => void;
  /** Index of the bullet that should auto-focus (used after adding a new bullet). */
  focusBulletIndex?: number;
  /** Called with the full new rows grid when a table cell is edited on-canvas. */
  onTableChange?: (rows: string[][]) => void;
}

const LAYOUT_LABEL: Record<SlideLayout, string> = {
  TITLE_ONLY: 'TITLE',
  TITLE_BULLETS: 'CONTENT',
  TITLE_BODY: 'BODY TEXT',
  TWO_COLUMN: 'TWO COLUMN',
  IMAGE_FOCUS: 'IMAGE',
  QUOTE: 'QUOTE',
  INTERACTION: 'INTERACT',
  CLOSING: 'CLOSING',
};

export function SlideCanvas({
  slide,
  index,
  total,
  deckTitle,
  mode = 'preview',
  themeId,
  backgroundHex,
  fontFamily,
  editable = false,
  onTitleChange,
  onBulletChange,
  onCommitNewBullet,
  onAddBullet,
  onDeleteBullet,
  focusBulletIndex,
  onTableChange,
}: SlideCanvasProps) {
  const theme = getDeckTheme(themeId);
  const isPresent = mode === 'present';
  const accentColor = slide.accentHex ? `#${slide.accentHex}` : theme.primary;
  // Deck-wide background override (e.g. pure black) wins over the theme bg.
  const slideBg = backgroundHex ? `#${backgroundHex}` : theme.bg;

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: '16 / 9',
        containerType: 'inline-size',
        background: slideBg,
        color: theme.text,
        fontFamily: fontFamily ?? undefined,
        borderRadius: isPresent ? 0 : 12,
        border: isPresent ? 'none' : `1px solid ${theme.border}`,
      }}
    >
      {/* Header bar */}
      <div
        className="absolute inset-x-0 top-0 flex items-center justify-between"
        style={{
          height: '6%',
          background: theme.panel,
          borderBottom: `1px solid ${theme.border}`,
          padding: '0 2.5%',
        }}
      >
        <div className="flex items-baseline gap-3">
          <span
            className="font-serif font-bold tracking-[0.12em]"
            style={{ color: theme.primary, fontSize: 'clamp(10px, 1.6cqw, 22px)' }}
          >
            VAIDIX
          </span>
          <span
            className="hidden tracking-[0.18em] sm:inline"
            style={{ color: theme.faint, fontSize: 'clamp(7px, 0.8cqw, 12px)' }}
          >
            {LAYOUT_LABEL[slide.layout]}
          </span>
        </div>
        <span
          className="font-mono"
          style={{ color: theme.faint, fontSize: 'clamp(7px, 0.85cqw, 12px)' }}
        >
          {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>

      {/* Accent strip just below header */}
      <div
        className="absolute"
        style={{ left: 0, right: '50%', top: '6%', height: '0.4%', background: accentColor }}
      />
      <div
        className="absolute"
        style={{ left: '50%', right: 0, top: '6%', height: '0.4%', background: theme.secondary }}
      />

      {/* Body */}
      <SlideBody
        slide={slide}
        deckTitle={deckTitle}
        accentColor={accentColor}
        isPresent={isPresent}
        theme={theme}
        editable={editable}
        onTitleChange={onTitleChange}
        onBulletChange={onBulletChange}
        onCommitNewBullet={onCommitNewBullet}
        onAddBullet={onAddBullet}
        onDeleteBullet={onDeleteBullet}
        focusBulletIndex={focusBulletIndex}
        onTableChange={onTableChange}
      />

      {/* Footer */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-center justify-between"
        style={{
          height: '5%',
          background: slideBg,
          borderTop: `1px solid ${theme.border}`,
          padding: '0 2.5%',
          color: theme.faint,
          fontSize: 'clamp(7px, 0.8cqw, 11px)',
        }}
      >
        <span className="truncate">{deckTitle}</span>
        <span>LV Prasad Eye Institute · Confidential</span>
      </div>
    </div>
  );
}

/**
 * Build the inline style for slide-level text emphasis. Only sets a property
 * when its toggle is on, so spreading `...fmt` AFTER a base style overrides it
 * when toggled yet leaves an element's own defaults (e.g. the quote's italic
 * attribution) untouched when off.
 */
function textFormat(slide: SlideViewModel): CSSProperties {
  const fmt: CSSProperties = {};
  if (slide.bold) fmt.fontWeight = 800;
  if (slide.italic) fmt.fontStyle = 'italic';
  if (slide.underline) fmt.textDecoration = 'underline';
  return fmt;
}

function SlideBody({
  slide,
  deckTitle,
  accentColor,
  isPresent,
  theme,
  editable = false,
  onTitleChange,
  onBulletChange,
  onCommitNewBullet,
  onAddBullet,
  onDeleteBullet,
  focusBulletIndex,
  onTableChange,
}: {
  slide: SlideViewModel;
  deckTitle: string;
  accentColor: string;
  isPresent: boolean;
  theme: DeckTheme;
  editable?: boolean;
  onTitleChange?: (v: string) => void;
  onBulletChange?: (idx: number, v: string) => void;
  onCommitNewBullet?: (v: string) => void;
  onAddBullet?: () => void;
  onDeleteBullet?: (idx: number) => void;
  focusBulletIndex?: number;
  onTableChange?: (rows: string[][]) => void;
}) {
  const padX = '6%';
  const padTop = '11%';
  // Font-size stepper: multiply the theme's clamp() tokens via calc() — valid
  // CSS (calc accepts a clamp() operand) so the stepper scales title + body
  // uniformly without re-deriving every breakpoint.
  const scale = slide.fontScale && slide.fontScale > 0 ? slide.fontScale : 1;
  const baseTitle = isPresent ? 'clamp(28px, 4.2cqw, 64px)' : 'clamp(16px, 3.2cqw, 36px)';
  const baseBody = isPresent ? 'clamp(16px, 1.9cqw, 28px)' : 'clamp(11px, 1.5cqw, 18px)';
  const titleSize = `calc((${baseTitle}) * ${scale})`;
  const bodySize = `calc((${baseBody}) * ${scale})`;
  const fmt = textFormat(slide);

  // A table (if inserted) renders below the slide body in every layout.
  const handleCell =
    editable && onTableChange && slide.tableJson
      ? (r: number, c: number, v: string) => {
          const rows = slide.tableJson!.rows.map((row) => row.slice());
          rows[r][c] = v;
          onTableChange(rows);
        }
      : undefined;
  const tableNode =
    slide.tableJson && Array.isArray(slide.tableJson.rows) && slide.tableJson.rows.length > 0 ? (
      <SlideTableBlock
        rows={slide.tableJson.rows}
        theme={theme}
        accent={accentColor}
        fontSize={bodySize}
        onCellChange={handleCell}
      />
    ) : null;

  switch (slide.layout) {
    case 'TITLE_ONLY':
      return (
        <div
          className="absolute flex flex-col justify-center gap-4"
          style={{ left: padX, right: padX, top: '14%', bottom: '14%' }}
        >
          <span
            className="tracking-[0.4em] uppercase"
            style={{ color: accentColor, fontSize: 'clamp(8px, 0.9cqw, 13px)' }}
          >
            {deckTitle}
          </span>
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="font-bold leading-[1.05]"
            style={{ fontSize: titleSize, color: theme.text, ...fmt }}
          >
            {editable && onTitleChange
              ? <EditText value={slide.title} onCommit={onTitleChange} tag="span" style={{ display: 'block' }} singleLine />
              : slide.title}
          </motion.h1>
          <div style={{ width: '14%', height: '0.5%', background: accentColor }} />
          {tableNode}
          {/* Add-bullet affordance: only in edit mode on layouts with no body yet */}
          {editable && onAddBullet && (
            <button
              type="button"
              onClick={onAddBullet}
              className="flex items-center gap-2 opacity-30 hover:opacity-70 transition-opacity"
              style={{ color: theme.subtle, fontSize: bodySize, marginTop: '1%' }}
            >
              <span style={{ color: accentColor, fontSize: titleSize }}>+</span>
              <span>Click to add bullets</span>
            </button>
          )}
        </div>
      );

    case 'CLOSING':
      return (
        <div
          className="absolute flex flex-col items-center justify-center gap-4 text-center"
          style={{ left: padX, right: padX, top: '14%', bottom: '14%' }}
        >
          <motion.h1
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="font-bold leading-[1.05]"
            style={{ fontSize: titleSize, color: theme.text, ...fmt }}
          >
            {editable && onTitleChange
              ? <EditText value={slide.title} onCommit={onTitleChange} tag="span" style={{ display: 'block' }} singleLine />
              : slide.title}
          </motion.h1>
          {slide.bullets.length > 0 && (
            <p style={{ color: theme.subtle, fontSize: bodySize }}>
              {slide.bullets.join(' · ')}
            </p>
          )}
          {tableNode}
        </div>
      );

    case 'QUOTE':
      return (
        <div
          className="absolute flex flex-col justify-center gap-6"
          style={{ left: padX, right: padX, top: '14%', bottom: '14%' }}
        >
          <span style={{ color: accentColor, fontSize: 'clamp(28px, 5cqw, 80px)', lineHeight: 1 }}>
            &quot;
          </span>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="font-medium"
            style={{ fontSize: bodySize, color: theme.text, lineHeight: 1.4, ...fmt }}
          >
            {editable && onTitleChange
              ? <EditText value={slide.title} onCommit={onTitleChange} tag="span" style={{ display: 'block' }} />
              : slide.title}
          </motion.p>
          {slide.bullets[0] && (
            <span style={{ color: theme.subtle, fontSize: bodySize, fontStyle: 'italic' }}>
              — {slide.bullets[0]}
            </span>
          )}
          {tableNode}
        </div>
      );

    case 'INTERACTION':
      return (
        <div
          className="absolute flex flex-col gap-5"
          style={{ left: padX, right: padX, top: padTop, bottom: '10%' }}
        >
          <span
            className="self-start rounded-full px-3 py-1 font-bold tracking-[0.2em] uppercase"
            style={{
              background: accentColor,
              color: theme.bg,
              fontSize: 'clamp(8px, 0.9cqw, 12px)',
            }}
          >
            Interact
          </span>
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-bold leading-tight"
            style={{ fontSize: titleSize, color: theme.text, ...fmt }}
          >
            {editable && onTitleChange
              ? <EditText value={slide.title} onCommit={onTitleChange} tag="span" style={{ display: 'block' }} singleLine />
              : slide.title}
          </motion.h2>
          <ul className="grid gap-3" style={{ color: theme.subtle, fontSize: bodySize }}>
            {slide.bullets.map((b, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.05 }}
                className="flex items-start gap-3 rounded-lg px-4 py-3"
                style={{ background: theme.panel, border: `1px solid ${theme.border}` }}
              >
                <span style={{ color: accentColor }}>{String.fromCharCode(65 + i)}.</span>
                {editable && onBulletChange
                  ? <EditText value={b} onCommit={(v) => onBulletChange(i, v)} tag="span" style={{ flex: 1 }} />
                  : <span>{b}</span>}
              </motion.li>
            ))}
          </ul>
          {tableNode}
        </div>
      );

    case 'TWO_COLUMN': {
      const half = Math.ceil(slide.bullets.length / 2);
      const left = slide.bullets.slice(0, half);
      const right = slide.bullets.slice(half);
      return (
        <div
          className="absolute flex flex-col gap-5"
          style={{ left: padX, right: padX, top: padTop, bottom: '10%' }}
        >
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-bold leading-tight"
            style={{ fontSize: titleSize, color: theme.text, ...fmt }}
          >
            {editable && onTitleChange
              ? <EditText value={slide.title} onCommit={onTitleChange} tag="span" style={{ display: 'block' }} singleLine />
              : slide.title}
          </motion.h2>
          <div className="grid grid-cols-2 gap-6">
            {[left, right].map((col, ci) => (
              <ul
                key={ci}
                className="grid gap-2"
                style={{ color: theme.subtle, fontSize: bodySize }}
              >
                {col.map((b, i) => {
                  const globalIdx = ci * half + i;
                  return (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + (ci * col.length + i) * 0.04 }}
                      className="flex gap-2"
                    >
                      <span style={{ color: accentColor }}>▸</span>
                      {editable && onBulletChange
                        ? <EditText value={b} onCommit={(v) => onBulletChange(globalIdx, v)} tag="span" style={{ flex: 1 }} />
                        : <span>{b}</span>}
                    </motion.li>
                  );
                })}
              </ul>
            ))}
          </div>
          {tableNode}
        </div>
      );
    }

    case 'IMAGE_FOCUS':
      return (
        <div
          className="absolute flex flex-col gap-4"
          style={{ left: padX, right: padX, top: padTop, bottom: '10%' }}
        >
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-bold leading-tight"
            style={{ fontSize: titleSize, color: theme.text, ...fmt }}
          >
            {editable && onTitleChange
              ? <EditText value={slide.title} onCommit={onTitleChange} tag="span" style={{ display: 'block' }} singleLine />
              : slide.title}
          </motion.h2>
          {slide.imageUrl ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="flex-1 overflow-hidden rounded-lg"
              style={{ border: `1px solid ${theme.border}`, minHeight: '40%' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slide.imageUrl}
                alt={slide.title}
                className="h-full w-full object-cover"
              />
            </motion.div>
          ) : (
            <div
              className="flex flex-1 items-center justify-center rounded-lg"
              style={{
                border: `1px dashed ${accentColor}`,
                color: theme.faint,
                fontSize: 'clamp(9px, 1.1cqw, 14px)',
                minHeight: '40%',
              }}
            >
              Image / OCT / fundus photo placeholder
            </div>
          )}
          {slide.bullets[0] && (
            <p style={{ color: theme.subtle, fontSize: bodySize }}>{slide.bullets[0]}</p>
          )}
          {tableNode}
        </div>
      );

    case 'TITLE_BODY':
      return (
        <div
          className="absolute flex flex-col gap-4"
          style={{ left: padX, right: padX, top: padTop, bottom: '10%' }}
        >
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-bold leading-tight"
            style={{ fontSize: titleSize, color: theme.text, ...fmt }}
          >
            {editable && onTitleChange
              ? <EditText value={slide.title} onCommit={onTitleChange} tag="span" style={{ display: 'block' }} singleLine />
              : slide.title}
          </motion.h2>
          <div style={{ width: '8%', height: '0.4%', background: accentColor }} />
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            style={{ color: theme.subtle, fontSize: bodySize, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
          >
            {editable && onBulletChange
              ? <EditText
                  value={slide.bullets[0] ?? ''}
                  onCommit={(v) => onBulletChange(0, v)}
                  placeholder="Click to add body text…"
                  tag="span"
                  style={{ display: 'block' }}
                />
              : (slide.bullets[0] ?? '')}
          </motion.p>
          {tableNode}
        </div>
      );

    case 'TITLE_BULLETS':
    default:
      return (
        <div
          className="absolute flex flex-col gap-4"
          style={{ left: padX, right: padX, top: padTop, bottom: '10%' }}
        >
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-bold leading-tight"
            style={{ fontSize: titleSize, color: theme.text, ...fmt }}
          >
            {editable && onTitleChange
              ? <EditText value={slide.title} onCommit={onTitleChange} tag="span" style={{ display: 'block' }} singleLine />
              : slide.title}
          </motion.h2>
          <div style={{ width: '8%', height: '0.4%', background: accentColor }} />
          <div className={slide.imageUrl ? 'grid min-h-0 flex-1 grid-cols-2 gap-6' : ''}>
            <ul
              className="grid gap-2 self-start"
              style={{ color: theme.subtle, fontSize: bodySize }}
            >
              {/* Existing bullets — each is directly editable */}
              {slide.bullets.map((b, i) => (
                <motion.li
                  key={`${i}-${b.slice(0, 8)}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: editable ? 0 : 0.12 + i * 0.05 }}
                  className="flex gap-3"
                >
                  <span style={{ color: accentColor, flexShrink: 0 }}>▸</span>
                  {editable && onBulletChange ? (
                    <EditText
                      value={b}
                      onCommit={(v) => onBulletChange(i, v)}
                      placeholder="Type bullet text…"
                      tag="span"
                      style={{ flex: 1 }}
                      autoFocus={focusBulletIndex === i}
                      onEnter={slide.bullets.length < 8 ? onAddBullet : undefined}
                      onDeleteEmpty={onDeleteBullet ? () => onDeleteBullet(i) : undefined}
                    />
                  ) : (
                    <span>{b}</span>
                  )}
                </motion.li>
              ))}
              {/* PPT-style "type here" row — always visible in edit mode when < 8 bullets */}
              {editable && onCommitNewBullet && slide.bullets.length < 8 && (
                <li className="flex gap-3">
                  <span style={{ color: accentColor, flexShrink: 0, opacity: 0.4 }}>▸</span>
                  <EditText
                    key={`new-${slide.bullets.length}`}
                    value=""
                    onCommit={(v) => { if (v.trim()) onCommitNewBullet(v) }}
                    placeholder="Click to add a bullet point…"
                    tag="span"
                    style={{ flex: 1 }}
                  />
                </li>
              )}
            </ul>
            {slide.imageUrl && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
                className="overflow-hidden rounded-lg"
                style={{ border: `1px solid ${theme.border}` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.imageUrl}
                  alt={slide.title}
                  className="h-full w-full object-cover"
                />
              </motion.div>
            )}
          </div>
          {tableNode}
        </div>
      );
  }
}

/**
 * Renders an inserted table. Row 0 is the header. Mirrors the .pptx export's
 * table styling (header band in the theme panel colour, accent underline,
 * subtle body text) so the on-screen and exported decks read the same.
 */
function SlideTableBlock({
  rows,
  theme,
  accent,
  fontSize,
  onCellChange,
}: {
  rows: string[][];
  theme: DeckTheme;
  accent: string;
  fontSize: string;
  /** When set, cells are editable on-canvas; called with the absolute row index. */
  onCellChange?: (row: number, col: number, value: string) => void;
}) {
  if (rows.length === 0) return null;
  const [head, ...body] = rows;
  return (
    <div className="min-h-0 overflow-auto rounded-lg" style={{ border: `1px solid ${theme.border}` }}>
      <table
        className="w-full border-collapse text-left"
        style={{ fontSize, color: theme.subtle }}
      >
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th
                key={i}
                className="px-2 py-1 font-semibold"
                style={{
                  background: theme.panel,
                  color: theme.text,
                  borderBottom: `2px solid ${accent}`,
                  borderRight: `1px solid ${theme.border}`,
                }}
              >
                {onCellChange ? (
                  <EditableCell value={cell} onCommit={(v) => onCellChange(0, i, v)} />
                ) : (
                  cell
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-2 py-1 align-top"
                  style={{
                    borderTop: `1px solid ${theme.border}`,
                    borderRight: `1px solid ${theme.border}`,
                  }}
                >
                  {onCellChange ? (
                    <EditableCell value={cell} onCommit={(v) => onCellChange(ri + 1, ci, v)} />
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Inline editable table cell ───────────────────────────────────────────────
// Like EditText, but commits on blur ALLOWING empty values (table cells may be
// intentionally blank) and never restores. DOM owns content while focused.
function EditableCell({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);
  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onBlur={(e) => {
        const text = e.currentTarget.textContent ?? '';
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          e.currentTarget.textContent = value;
          e.currentTarget.blur();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      }}
      style={{ cursor: 'text', outline: 'none', display: 'block', minWidth: '0.5em', minHeight: '1em' }}
      className="rounded-sm transition-all hover:ring-1 hover:ring-white/25 focus:ring-1 focus:ring-white/60 focus:bg-black/8"
    />
  );
}
