'use client';

// CARD_STACK — vertical stack of cards each with header + dose strip + S/R
// coverage bar + status badge + 1-line usage rule. Designed for drug tables,
// classification staging, OR-step lists — anywhere a small comparable set of
// items reads better as cards than as a row-wise table.

import { motion } from 'framer-motion';
import { SlideShell, toneFill, toneBorder, toneText } from './slide-shell';
import type { CardStackData, NewLayoutShellProps } from './types';

interface Props extends NewLayoutShellProps {
  data: CardStackData;
}

export function CardStackSlide({ data, title, mode = 'preview', ...shell }: Props) {
  const isPresent = mode === 'present';
  const titleSize = isPresent ? 'clamp(22px, 3.2cqw, 44px)' : 'clamp(13px, 2.4cqw, 28px)';
  const nameSize = isPresent ? 'clamp(15px, 2cqw, 26px)' : 'clamp(11px, 1.5cqw, 18px)';
  const doseSize = isPresent ? 'clamp(11px, 1.4cqw, 18px)' : 'clamp(8px, 1.05cqw, 13px)';
  const ruleSize = isPresent ? 'clamp(11px, 1.4cqw, 18px)' : 'clamp(9px, 1.1cqw, 14px)';
  const badgeSize = isPresent ? 'clamp(9px, 1.05cqw, 13px)' : 'clamp(7px, 0.85cqw, 11px)';

  return (
    <SlideShell {...shell} title={title} mode={mode} layout="CARD_STACK">
      {(theme, accent) => (
        <div
          className="absolute flex flex-col gap-3"
          style={{ left: '5%', right: '5%', top: '10%', bottom: '9%' }}
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

          <div
            className="grid flex-1 gap-2"
            style={{ gridTemplateRows: `repeat(${data.cards.length}, minmax(0, 1fr))` }}
          >
            {data.cards.map((card, i) => {
              const badgeTone = card.badge?.tone;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 + i * 0.07 }}
                  className="flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2"
                  style={{
                    background: theme.panel,
                    border: `1px solid ${theme.border}`,
                  }}
                >
                  {/* Name + dose stack */}
                  <div className="flex min-w-[18%] flex-col">
                    <span
                      className="font-bold uppercase tracking-wider"
                      style={{ color: theme.text, fontSize: nameSize }}
                    >
                      {card.name}
                    </span>
                    {card.dose && (
                      <span
                        className="font-mono"
                        style={{ color: theme.subtle, fontSize: doseSize }}
                      >
                        {card.dose}
                      </span>
                    )}
                  </div>

                  {/* Coverage bar */}
                  {card.coverage && (
                    <div className="flex min-w-[28%] flex-1 items-center gap-2">
                      <span
                        className="font-mono uppercase tracking-wider"
                        style={{ color: theme.faint, fontSize: badgeSize, minWidth: '5cqw' }}
                      >
                        {card.coverage.label}
                      </span>
                      <div
                        className="relative h-2 flex-1 overflow-hidden rounded-full"
                        style={{ background: theme.panelAlt }}
                      >
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(0, Math.min(100, card.coverage.percent))}%` }}
                          transition={{ delay: 0.25 + i * 0.07, duration: 0.6 }}
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ background: accent }}
                        />
                      </div>
                      <span
                        className="font-mono"
                        style={{ color: theme.text, fontSize: doseSize, minWidth: '3cqw' }}
                      >
                        {card.coverage.percent}%
                      </span>
                    </div>
                  )}

                  {/* Rule + badge */}
                  <div className="flex flex-1 items-center justify-end gap-2">
                    {card.rule && (
                      <span
                        className="truncate text-right italic"
                        style={{ color: theme.subtle, fontSize: ruleSize, maxWidth: '36cqw' }}
                      >
                        {card.rule}
                      </span>
                    )}
                    {card.badge && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 font-bold uppercase tracking-wider"
                        style={{
                          background: toneFill(badgeTone, theme),
                          border: `1px solid ${toneBorder(badgeTone, theme)}`,
                          color: toneText(badgeTone, theme),
                          fontSize: badgeSize,
                        }}
                      >
                        {card.badge.text}
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </SlideShell>
  );
}
