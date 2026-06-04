'use client';

// ════════════════════════════════════════════════════════════════════════════
// ThemePicker — shared dropdown for selecting a deck theme
// ════════════════════════════════════════════════════════════════════════════
// Used by both the legacy editor (/teacher/decks/[jobId]) and the presentation
// studio (/teacher/decks/[jobId]/studio). Theme is persisted via PATCH
// /api/decks/[jobId] with { template: id } — the caller wires the callback.

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { SlideCanvas, type SlideViewModel } from '@/components/decks/slide-canvas';
import { DECK_THEMES, THEME_IDS, type DeckThemeId } from '@/lib/deck-themes';

const PREVIEW_SLIDE: SlideViewModel = {
  id: 'preview',
  order: 0,
  layout: 'TITLE_BULLETS',
  title: 'Diabetic Retinopathy',
  bullets: [
    'Anti-VEGF first line for DME',
    'PRP for high-risk PDR',
    'HbA1c control slows progression',
  ],
  speakerNotes: null,
  accentHex: null,
};

export function ThemePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = DECK_THEMES[value as DeckThemeId] ?? DECK_THEMES['deep-space'];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid="deck-theme-picker"
      >
        <span
          className="h-2.5 w-2.5 rounded-sm border border-border/60"
          style={{ background: current.swatch }}
        />
        {current.label}
        <ChevronDown
          className="h-3 w-3 text-muted-foreground transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label="Choose theme"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full z-50 mt-2 grid grid-cols-2 gap-2.5 rounded-xl border border-border bg-card p-3 shadow-2xl"
            style={{ width: 360 }}
          >
            {THEME_IDS.map((id) => {
              const t = DECK_THEMES[id as DeckThemeId];
              const isActive = value === id;
              return (
                <motion.button
                  key={id}
                  role="option"
                  type="button"
                  aria-selected={isActive}
                  aria-label={t.label}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                  className={`rounded-lg border-2 p-1.5 text-left transition-colors ${
                    isActive
                      ? 'border-primary shadow-sm'
                      : 'border-transparent hover:border-border'
                  }`}
                >
                  <div className="overflow-hidden rounded-md">
                    <SlideCanvas
                      slide={PREVIEW_SLIDE}
                      index={0}
                      total={1}
                      deckTitle="Vaidix"
                      themeId={id}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-medium">{t.label}</span>
                    {isActive && (
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: t.primary }}
                      />
                    )}
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
