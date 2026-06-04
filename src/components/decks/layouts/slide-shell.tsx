'use client';

// Shared 16:9 chrome (header bar · accent strips · footer) used by the 5 new
// layout previews. Mirrors SlideCanvas's chrome exactly so faculty don't see a
// visual seam between legacy and new layouts. Children fill the body area
// (top 6% reserved for header, bottom 5% for footer).

import { getDeckTheme, type DeckTheme } from '@/lib/deck-themes';
import type { NewLayoutShellProps, NewSlideLayoutName } from './types';
import type { ReactNode } from 'react';

const LAYOUT_LABEL: Record<NewSlideLayoutName, string> = {
  COMPARISON_PANEL: 'COMPARE',
  CALLOUT_BAND: 'CALLOUT',
  TRAFFIC_LIGHT_GRID: 'RUBRIC',
  CARD_STACK: 'CARDS',
  TIMELINE_STRIP: 'TIMELINE',
};

interface SlideShellProps extends NewLayoutShellProps {
  layout: NewSlideLayoutName;
  children: (theme: DeckTheme, accent: string) => ReactNode;
}

export function SlideShell({
  deckTitle,
  index,
  total,
  themeId,
  accentHex,
  mode = 'preview',
  layout,
  children,
}: SlideShellProps) {
  const theme = getDeckTheme(themeId);
  const isPresent = mode === 'present';
  const accent = accentHex ? `#${accentHex}` : theme.primary;

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: '16 / 9',
        background: theme.bg,
        color: theme.text,
        borderRadius: isPresent ? 0 : 12,
        border: isPresent ? 'none' : `1px solid ${theme.border}`,
        containerType: 'inline-size',
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
            {LAYOUT_LABEL[layout]}
          </span>
        </div>
        <span
          className="font-mono"
          style={{ color: theme.faint, fontSize: 'clamp(7px, 0.85cqw, 12px)' }}
        >
          {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>

      {/* Accent strips */}
      <div
        className="absolute"
        style={{ left: 0, right: '50%', top: '6%', height: '0.4%', background: accent }}
      />
      <div
        className="absolute"
        style={{ left: '50%', right: 0, top: '6%', height: '0.4%', background: theme.secondary }}
      />

      {/* Body */}
      {children(theme, accent)}

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

// Tone → colour helpers shared by previews. Maps the abstract layout tones
// to the active theme so dark/light themes both render correctly.
export function toneFill(tone: string | undefined, theme: DeckTheme): string {
  switch (tone) {
    case 'positive':
      return 'rgba(16, 185, 129, 0.18)'; // emerald-500/18
    case 'negative':
      return 'rgba(239, 68, 68, 0.18)'; // red-500/18
    case 'caution':
      return 'rgba(245, 158, 11, 0.18)'; // amber-500/18
    case 'critical':
      return 'rgba(220, 38, 38, 0.32)'; // red-600/32
    case 'neutral':
    default:
      return theme.panel;
  }
}

export function toneBorder(tone: string | undefined, theme: DeckTheme): string {
  switch (tone) {
    case 'positive':
      return 'rgba(16, 185, 129, 0.6)';
    case 'negative':
      return 'rgba(239, 68, 68, 0.6)';
    case 'caution':
      return 'rgba(245, 158, 11, 0.7)';
    case 'critical':
      return 'rgba(220, 38, 38, 0.8)';
    case 'neutral':
    default:
      return theme.border;
  }
}

export function toneText(tone: string | undefined, theme: DeckTheme): string {
  switch (tone) {
    case 'positive':
      return '#34d399';
    case 'negative':
      return '#fca5a5';
    case 'caution':
      return '#fbbf24';
    case 'critical':
      return '#f87171';
    case 'neutral':
    default:
      return theme.text;
  }
}
