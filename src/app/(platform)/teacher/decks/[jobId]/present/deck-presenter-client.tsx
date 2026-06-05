'use client';

// ════════════════════════════════════════════════════════════════════════════
// Fullscreen presenter — arrow keys, page-up/down, F for fullscreen, ESC to
// exit. Speaker notes drawer toggles with N. Smooth slide transitions via
// AnimatePresence.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { SlideCanvas, type SlideViewModel } from '@/components/decks/slide-canvas';

interface Props {
  jobId: string;
  deckTitle: string;
  slides: SlideViewModel[];
  themeId?: string;
  backgroundHex?: string | null;
  /** VERBATIM decks present the faithful original slide images, not the canvas. */
  importMode?: string;
}

export function DeckPresenterClient({ jobId, deckTitle, slides, themeId, backgroundHex, importMode }: Props) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (next: number) => {
      setIdx((curr) => Math.min(slides.length - 1, Math.max(0, next < 0 ? curr + next : next)));
    },
    [slides.length],
  );

  const next = useCallback(() => setIdx((i) => Math.min(slides.length - 1, i + 1)), [slides.length]);
  const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);

  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    router.push(`/teacher/decks/${jobId}`);
  }, [jobId, router]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          next();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          prev();
          break;
        case 'Home':
          e.preventDefault();
          go(0);
          break;
        case 'End':
          e.preventDefault();
          go(slides.length - 1);
          break;
        case 'f':
        case 'F':
          if (containerRef.current && !document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch(() => {});
          } else if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
          break;
        case 'n':
        case 'N':
          setShowNotes((v) => !v);
          break;
        case 'Escape':
          if (!document.fullscreenElement) exit();
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, go, slides.length, exit]);

  if (slides.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <p>No slides in this deck.</p>
      </div>
    );
  }

  const active = slides[idx];

  return (
    <div ref={containerRef} className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Slide */}
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="w-full max-w-[min(100%,calc(100vh*16/9))]">
          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              {importMode === 'VERBATIM' && active.sourceImageUrl ? (
                // Faithful import: present the original slide image exactly as
                // uploaded. eslint-disable — presigned S3 URL, not a static asset.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={active.sourceImageUrl}
                  alt={active.title}
                  className="block w-full"
                  style={{ aspectRatio: '16 / 9', objectFit: 'contain', background: '#000' }}
                />
              ) : (
                <SlideCanvas
                  slide={active}
                  index={idx}
                  total={slides.length}
                  deckTitle={deckTitle}
                  mode="present"
                  themeId={themeId}
                  backgroundHex={backgroundHex}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Hover controls */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center gap-3 opacity-0 transition hover:opacity-100 group-hover:opacity-100">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs text-white/80 backdrop-blur">
          <button
            type="button"
            onClick={prev}
            disabled={idx === 0}
            className="rounded px-2 hover:bg-white/10 disabled:opacity-40"
          >
            ←
          </button>
          <span className="font-mono">
            {idx + 1} / {slides.length}
          </span>
          <button
            type="button"
            onClick={next}
            disabled={idx === slides.length - 1}
            className="rounded px-2 hover:bg-white/10 disabled:opacity-40"
          >
            →
          </button>
          <span className="mx-2 h-3 w-px bg-white/20" />
          <button
            type="button"
            onClick={() => setShowNotes((v) => !v)}
            className="rounded px-2 hover:bg-white/10"
            title="Toggle notes (N)"
          >
            Notes
          </button>
          <button
            type="button"
            onClick={exit}
            className="rounded px-2 hover:bg-white/10"
            title="Exit (Esc)"
          >
            Exit
          </button>
        </div>
      </div>

      {/* Speaker notes drawer */}
      <AnimatePresence>
        {showNotes && active.speakerNotes && (
          <motion.aside
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-6 bottom-16 max-h-[30vh] overflow-y-auto rounded-lg bg-white/10 p-5 text-white/90 backdrop-blur"
          >
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
              Speaker notes
            </p>
            <p className="text-base leading-relaxed">{active.speakerNotes}</p>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Slide progress dots */}
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center gap-1">
        {slides.map((s, i) => (
          <span
            key={s.id}
            className="block h-1 rounded-full transition-all"
            style={{
              width: i === idx ? 18 : 6,
              background: i === idx ? '#00d4f0' : 'rgba(255,255,255,0.25)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
