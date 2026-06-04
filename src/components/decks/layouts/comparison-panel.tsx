'use client';

// COMPARISON_PANEL — side-by-side teaching pattern.
// Two equal halves with tone-coded headers + bullet lists. Caption strip
// optional at the bottom. Used for normal vs abnormal, mild vs severe, look-
// alike differentials. Tones (positive/negative/caution/critical) drive the
// header chip + left/right accent bar so the eye lands on the right side.

import { motion } from 'framer-motion';
import { SlideShell, toneFill, toneBorder, toneText } from './slide-shell';
import type { ComparisonPanelData, NewLayoutShellProps } from './types';

interface Props extends NewLayoutShellProps {
  data: ComparisonPanelData;
}

export function ComparisonPanelSlide({ data, title, mode = 'preview', ...shell }: Props) {
  const isPresent = mode === 'present';
  const titleSize = isPresent ? 'clamp(24px, 3.4cqw, 48px)' : 'clamp(14px, 2.6cqw, 30px)';
  const panelHeaderSize = isPresent ? 'clamp(16px, 2cqw, 28px)' : 'clamp(11px, 1.6cqw, 20px)';
  const bodySize = isPresent ? 'clamp(13px, 1.7cqw, 22px)' : 'clamp(10px, 1.3cqw, 16px)';

  return (
    <SlideShell {...shell} title={title} mode={mode} layout="COMPARISON_PANEL">
      {(theme, accent) => (
        <div
          className="absolute flex flex-col gap-4"
          style={{ left: '6%', right: '6%', top: '11%', bottom: '10%' }}
        >
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-bold leading-tight"
            style={{ fontSize: titleSize, color: theme.text }}
          >
            {title}
          </motion.h2>
          <div style={{ width: '8%', height: '0.4%', background: accent }} />

          <div className="grid flex-1 grid-cols-2 gap-4">
            {(['left', 'right'] as const).map((side, idx) => {
              const panel = data[side];
              return (
                <motion.div
                  key={side}
                  initial={{ opacity: 0, x: idx === 0 ? -10 : 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + idx * 0.08 }}
                  className="flex flex-col gap-3 overflow-hidden rounded-lg"
                  style={{
                    background: toneFill(panel.tone, theme),
                    border: `1px solid ${toneBorder(panel.tone, theme)}`,
                    padding: '4% 4% 4% 4%',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="font-bold tracking-wide"
                      style={{
                        fontSize: panelHeaderSize,
                        color: toneText(panel.tone, theme),
                      }}
                    >
                      {panel.label}
                    </span>
                  </div>
                  <ul className="grid gap-2" style={{ color: theme.subtle, fontSize: bodySize }}>
                    {panel.items.map((it, i) => (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + idx * 0.08 + i * 0.04 }}
                        className="flex gap-2"
                      >
                        <span style={{ color: toneText(panel.tone, theme) }}>▸</span>
                        <span>{it}</span>
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </div>

          {data.caption && (
            <div
              className="rounded-md px-3 py-2 text-center italic"
              style={{
                color: theme.subtle,
                fontSize: bodySize,
                background: theme.panel,
                border: `1px solid ${theme.border}`,
              }}
            >
              {data.caption}
            </div>
          )}
        </div>
      )}
    </SlideShell>
  );
}
