'use client';

// CALLOUT_BAND — single high-signal sentence rendered large across the slide.
// Used for core-message callbacks, myth-busters, contrast hooks, the rule.
// Prelude is a tiny uppercase label above the statement; attribution is a
// quiet trailing line. The slide title prints small at the top so the
// statement gets the visual stage.

import { motion } from 'framer-motion';
import { SlideShell } from './slide-shell';
import type { CalloutBandData, NewLayoutShellProps } from './types';

interface Props extends NewLayoutShellProps {
  data: CalloutBandData;
}

export function CalloutBandSlide({ data, title, mode = 'preview', ...shell }: Props) {
  const isPresent = mode === 'present';
  const eyebrowSize = isPresent ? 'clamp(11px, 1.2cqw, 16px)' : 'clamp(8px, 0.9cqw, 12px)';
  const subtitleSize = isPresent ? 'clamp(14px, 1.6cqw, 22px)' : 'clamp(10px, 1.2cqw, 16px)';
  const statementSize = isPresent ? 'clamp(28px, 5.5cqw, 88px)' : 'clamp(18px, 4cqw, 56px)';
  const attributionSize = isPresent ? 'clamp(12px, 1.4cqw, 18px)' : 'clamp(9px, 1.05cqw, 14px)';

  return (
    <SlideShell {...shell} title={title} mode={mode} layout="CALLOUT_BAND">
      {(theme, accent) => (
        <div
          className="absolute flex flex-col items-center justify-center text-center"
          style={{ left: '8%', right: '8%', top: '11%', bottom: '10%' }}
        >
          <span
            className="tracking-[0.18em] uppercase"
            style={{ color: theme.subtle, fontSize: subtitleSize }}
          >
            {title}
          </span>

          <div
            style={{
              width: '6%',
              height: '0.5%',
              background: accent,
              margin: '2.2% 0',
            }}
          />

          {data.prelude && (
            <motion.span
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="tracking-[0.34em] uppercase"
              style={{ color: accent, fontSize: eyebrowSize, marginBottom: '1.6%' }}
            >
              {data.prelude}
            </motion.span>
          )}

          <motion.p
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="font-serif font-bold leading-[1.08]"
            style={{
              color: theme.text,
              fontSize: statementSize,
              maxWidth: '92%',
            }}
          >
            {data.statement}
          </motion.p>

          {data.attribution && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.4 }}
              className="italic"
              style={{
                color: theme.faint,
                fontSize: attributionSize,
                marginTop: '2.4%',
              }}
            >
              {data.attribution}
            </motion.span>
          )}
        </div>
      )}
    </SlideShell>
  );
}
