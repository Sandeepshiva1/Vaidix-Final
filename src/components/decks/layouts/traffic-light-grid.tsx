'use client';

// TRAFFIC_LIGHT_GRID — NxM colour-coded matrix.
// Anchor visual for scoring rubrics like the EMS Inflammatory Score: rows are
// dimensions (Cornea / AC / Iris / Vitreous), columns are severity grades
// (0..4). Each cell holds a short descriptor, the tone drives the colour.
// Decision line is an optional rule rendered below the grid, separated from
// the matrix by an accent strip.

import { motion } from 'framer-motion';
import { SlideShell, toneFill, toneBorder } from './slide-shell';
import type { TrafficLightGridData, NewLayoutShellProps } from './types';

interface Props extends NewLayoutShellProps {
  data: TrafficLightGridData;
}

export function TrafficLightGridSlide({ data, title, mode = 'preview', ...shell }: Props) {
  const isPresent = mode === 'present';
  const titleSize = isPresent ? 'clamp(22px, 3.2cqw, 44px)' : 'clamp(13px, 2.4cqw, 28px)';
  const rowLabelSize = isPresent ? 'clamp(13px, 1.7cqw, 22px)' : 'clamp(10px, 1.3cqw, 16px)';
  const colLabelSize = isPresent ? 'clamp(13px, 1.8cqw, 22px)' : 'clamp(10px, 1.4cqw, 17px)';
  const cellSize = isPresent ? 'clamp(10px, 1.4cqw, 18px)' : 'clamp(8px, 1.05cqw, 13px)';
  const decisionSize = isPresent ? 'clamp(14px, 1.9cqw, 26px)' : 'clamp(10px, 1.4cqw, 18px)';

  const nCols = data.colLabels.length;
  // 5% reserved for the row label column. Grid template uses fractional
  // columns so the matrix scales with container.
  const gridTemplate = `minmax(8%, 14%) repeat(${nCols}, 1fr)`;

  return (
    <SlideShell {...shell} title={title} mode={mode} layout="TRAFFIC_LIGHT_GRID">
      {(theme, accent) => (
        <div
          className="absolute flex flex-col gap-3"
          style={{ left: '4%', right: '4%', top: '10%', bottom: '9%' }}
        >
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-bold leading-tight"
            style={{ fontSize: titleSize, color: theme.text }}
          >
            {title}
          </motion.h2>

          <div className="flex flex-1 flex-col gap-1.5 overflow-hidden">
            {/* Header row */}
            <div className="grid gap-1.5" style={{ gridTemplateColumns: gridTemplate }}>
              <span />
              {data.colLabels.map((cl, ci) => (
                <span
                  key={ci}
                  className="text-center font-mono font-bold"
                  style={{ color: accent, fontSize: colLabelSize }}
                >
                  {cl}
                </span>
              ))}
            </div>

            {/* Data rows */}
            {data.rowLabels.map((rl, ri) => (
              <motion.div
                key={ri}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + ri * 0.08 }}
                className="grid flex-1 items-stretch gap-1.5"
                style={{ gridTemplateColumns: gridTemplate, minHeight: 0 }}
              >
                <div
                  className="flex items-center font-bold uppercase tracking-wider"
                  style={{ color: theme.text, fontSize: rowLabelSize }}
                >
                  {rl}
                </div>
                {data.cells[ri]?.map((cell, ci) => {
                  const tone = data.tones[ri]?.[ci];
                  return (
                    <div
                      key={ci}
                      className="flex items-center justify-center rounded px-1 py-1 text-center"
                      style={{
                        background: toneFill(tone, theme),
                        border: `1px solid ${toneBorder(tone, theme)}`,
                        color: theme.text,
                        fontSize: cellSize,
                        lineHeight: 1.15,
                      }}
                    >
                      {cell}
                    </div>
                  );
                })}
              </motion.div>
            ))}
          </div>

          {data.decisionLine && (
            <>
              <div style={{ width: '100%', height: '0.4%', background: accent }} />
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.55 }}
                className="rounded-md px-3 py-2 text-center font-medium"
                style={{
                  background: theme.panel,
                  border: `1px solid ${theme.border}`,
                  color: theme.text,
                  fontSize: decisionSize,
                }}
              >
                {data.decisionLine}
              </motion.div>
            </>
          )}
        </div>
      )}
    </SlideShell>
  );
}
