'use client';

// TIMELINE_STRIP — horizontal left-to-right phase strip.
// Each phase has a marker (short label above the dot — "0h", "24h", "Day 3"),
// a label (the action), and an optional sub-detail. Tone colours the dot +
// connecting line segment to its right. Used for first-48h sequences,
// pre-op → post-op flows, follow-up rhythms.

import { motion } from 'framer-motion';
import { SlideShell, toneText } from './slide-shell';
import type { TimelineStripData, NewLayoutShellProps } from './types';

interface Props extends NewLayoutShellProps {
  data: TimelineStripData;
}

export function TimelineStripSlide({ data, title, mode = 'preview', ...shell }: Props) {
  const isPresent = mode === 'present';
  const titleSize = isPresent ? 'clamp(22px, 3.2cqw, 44px)' : 'clamp(13px, 2.4cqw, 28px)';
  const markerSize = isPresent ? 'clamp(13px, 1.8cqw, 22px)' : 'clamp(10px, 1.3cqw, 17px)';
  const labelSize = isPresent ? 'clamp(13px, 1.7cqw, 22px)' : 'clamp(10px, 1.3cqw, 16px)';
  const detailSize = isPresent ? 'clamp(11px, 1.4cqw, 18px)' : 'clamp(8px, 1.05cqw, 13px)';

  const n = data.phases.length;

  return (
    <SlideShell {...shell} title={title} mode={mode} layout="TIMELINE_STRIP">
      {(theme, accent) => (
        <div
          className="absolute flex flex-col gap-4"
          style={{ left: '5%', right: '5%', top: '11%', bottom: '10%' }}
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

          {/* Strip — markers row */}
          <div className="relative flex-1">
            {/* Connecting horizontal line */}
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="absolute"
              style={{
                left: `${100 / (2 * n)}%`,
                right: `${100 / (2 * n)}%`,
                top: '34%',
                height: 3,
                background: accent,
                transformOrigin: 'left',
                borderRadius: 2,
              }}
            />

            {/* Phase columns */}
            <div
              className="grid h-full"
              style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}
            >
              {data.phases.map((p, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 + i * 0.08 }}
                  className="flex flex-col items-center gap-2"
                  style={{ padding: '0 0.6cqw' }}
                >
                  {/* Marker label above dot */}
                  <span
                    className="font-mono font-bold uppercase tracking-wider"
                    style={{ color: toneText(p.tone, theme), fontSize: markerSize }}
                  >
                    {p.marker}
                  </span>
                  {/* Dot */}
                  <div
                    className="rounded-full"
                    style={{
                      width: '1.5cqw',
                      height: '1.5cqw',
                      minWidth: 12,
                      minHeight: 12,
                      background: toneText(p.tone, theme),
                      border: `2px solid ${theme.bg}`,
                      boxShadow: `0 0 0 2px ${toneText(p.tone, theme)}`,
                    }}
                  />
                  {/* Label + detail */}
                  <div className="flex flex-col items-center gap-1 px-1 text-center">
                    <span
                      className="font-bold"
                      style={{ color: theme.text, fontSize: labelSize, lineHeight: 1.2 }}
                    >
                      {p.label}
                    </span>
                    {p.detail && (
                      <span
                        style={{
                          color: theme.subtle,
                          fontSize: detailSize,
                          lineHeight: 1.25,
                        }}
                      >
                        {p.detail}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      )}
    </SlideShell>
  );
}
