'use client';

// ════════════════════════════════════════════════════════════════════════════
// SlideCanvas — visual renderer used by both the editor preview and the
// fullscreen presenter. Pure (no data fetching), drives off a normalized
// Slide prop. Intentionally mirrors the layout vocabulary of the .pptx
// export so on-screen and exported decks read the same.
// ════════════════════════════════════════════════════════════════════════════

import { motion } from 'framer-motion';
import type { SlideLayout } from '@prisma/client';
import { getDeckTheme, type DeckTheme } from '@/lib/deck-themes';

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
}

interface SlideCanvasProps {
  slide: SlideViewModel;
  index: number;
  total: number;
  deckTitle: string;
  /** preview = inside an editor card; present = fullscreen */
  mode?: 'preview' | 'present';
  themeId?: string;
}

const LAYOUT_LABEL: Record<SlideLayout, string> = {
  TITLE_ONLY: 'TITLE',
  TITLE_BULLETS: 'CONTENT',
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
}: SlideCanvasProps) {
  const theme = getDeckTheme(themeId);
  const isPresent = mode === 'present';
  const accentColor = slide.accentHex ? `#${slide.accentHex}` : theme.primary;

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: '16 / 9',
        background: theme.bg,
        color: theme.text,
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
      />

      {/* Footer */}
      <div
        className="absolute inset-x-0 bottom-0 flex items-center justify-between"
        style={{
          height: '5%',
          background: theme.bg,
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

function SlideBody({
  slide,
  deckTitle,
  accentColor,
  isPresent,
  theme,
}: {
  slide: SlideViewModel;
  deckTitle: string;
  accentColor: string;
  isPresent: boolean;
  theme: DeckTheme;
}) {
  const padX = '6%';
  const padTop = '11%';
  const titleSize = isPresent ? 'clamp(28px, 4.2cqw, 64px)' : 'clamp(16px, 3.2cqw, 36px)';
  const bodySize = isPresent ? 'clamp(16px, 1.9cqw, 28px)' : 'clamp(11px, 1.5cqw, 18px)';

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
            style={{ fontSize: titleSize, color: theme.text }}
          >
            {slide.title}
          </motion.h1>
          <div style={{ width: '14%', height: '0.5%', background: accentColor }} />
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
            style={{ fontSize: titleSize, color: theme.text }}
          >
            {slide.title}
          </motion.h1>
          {slide.bullets.length > 0 && (
            <p style={{ color: theme.subtle, fontSize: bodySize }}>{slide.bullets.join(' · ')}</p>
          )}
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
            style={{ fontSize: bodySize, color: theme.text, lineHeight: 1.4 }}
          >
            {slide.title}
          </motion.p>
          {slide.bullets[0] && (
            <span style={{ color: theme.subtle, fontSize: bodySize, fontStyle: 'italic' }}>
              — {slide.bullets[0]}
            </span>
          )}
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
            style={{ fontSize: titleSize, color: theme.text }}
          >
            {slide.title}
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
                <span>{b}</span>
              </motion.li>
            ))}
          </ul>
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
            style={{ fontSize: titleSize, color: theme.text }}
          >
            {slide.title}
          </motion.h2>
          <div className="grid grid-cols-2 gap-6">
            {[left, right].map((col, ci) => (
              <ul key={ci} className="grid gap-2" style={{ color: theme.subtle, fontSize: bodySize }}>
                {col.map((b, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + (ci * col.length + i) * 0.04 }}
                    className="flex gap-2"
                  >
                    <span style={{ color: accentColor }}>▸</span>
                    <span>{b}</span>
                  </motion.li>
                ))}
              </ul>
            ))}
          </div>
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
            style={{ fontSize: titleSize, color: theme.text }}
          >
            {slide.title}
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
            style={{ fontSize: titleSize, color: theme.text }}
          >
            {slide.title}
          </motion.h2>
          <div style={{ width: '8%', height: '0.4%', background: accentColor }} />
          {/* When an AI image is present, give bullets the left half and the
              image the right half; otherwise bullets span full width. */}
          <div className={slide.imageUrl ? 'grid min-h-0 flex-1 grid-cols-2 gap-6' : ''}>
            <ul className="grid gap-3 self-start" style={{ color: theme.subtle, fontSize: bodySize }}>
              {slide.bullets.map((b, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 + i * 0.05 }}
                  className="flex gap-3"
                >
                  <span style={{ color: accentColor }}>▸</span>
                  <span>{b}</span>
                </motion.li>
              ))}
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
        </div>
      );
  }
}
