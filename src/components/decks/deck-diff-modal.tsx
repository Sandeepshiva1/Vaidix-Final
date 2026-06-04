'use client';

// ════════════════════════════════════════════════════════════════════════════
// DeckDiffModal — show before/after for an AI rewrite proposal
// ════════════════════════════════════════════════════════════════════════════
// Used by both flows that produce a RefineProposal:
//   - Apply suggestion (AI Coach panel)
//   - Per-slide chat refine
// Faculty veto = the modal. Clicking Accept commits via PATCH on the slide;
// Cancel discards the proposal. The Vaidix rule: AI proposes, faculty disposes.

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, X, Sparkles, ArrowRight } from 'lucide-react';
import type { SlideLayout } from '@prisma/client';

export interface RefinedSlideView {
  title: string;
  bullets: string[];
  speakerNotes: string | null;
  layout?: SlideLayout;
}

export interface DiffProposal {
  slideId: string;
  before: RefinedSlideView;
  after: RefinedSlideView;
  rationale: string;
  /**
   * Always 'ai' on the wire — we deliberately do not expose which model
   * produced the proposal. Concrete tier lives in server logs only.
   */
  source: 'ai';
}

interface Props {
  open: boolean;
  proposal: DiffProposal | null;
  /** True when the parent is awaiting the AI proposal. */
  loading: boolean;
  /** True when the parent is committing the accepted proposal. */
  committing: boolean;
  error: string | null;
  onAccept: () => void;
  onCancel: () => void;
}

const SOURCE_BADGE_TONE =
  'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';

export function DeckDiffModal({
  open,
  proposal,
  loading,
  committing,
  error,
  onAccept,
  onCancel,
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !committing) onCancel();
          }}
          data-testid="deck-diff-modal"
        >
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold">AI proposal</h2>
                {proposal && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${SOURCE_BADGE_TONE}`}
                  >
                    AI suggestion
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={committing}
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* Body */}
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI is drafting a rewrite…
                </div>
              ) : proposal ? (
                <>
                  <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    <span className="font-semibold">Rationale: </span>
                    {proposal.rationale}
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <DiffColumn label="Current" tone="muted" view={proposal.before} />
                    <DiffColumn label="Proposed" tone="primary" view={proposal.after} />
                  </div>
                </>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No proposal available.
                </p>
              )}

              {error && (
                <p className="mt-4 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  {error}
                </p>
              )}
            </div>

            {/* Footer */}
            <footer className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3">
              <span className="text-[11px] text-muted-foreground">
                AI proposes, you decide. Accept commits the change.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={committing}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onAccept}
                  disabled={!proposal || loading || committing}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
                  data-testid="diff-accept"
                >
                  {committing ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Committing…
                    </>
                  ) : (
                    <>
                      <Check className="h-3 w-3" /> Accept
                      <ArrowRight className="h-3 w-3" />
                    </>
                  )}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DiffColumn({
  label,
  tone,
  view,
}: {
  label: string;
  tone: 'muted' | 'primary';
  view: RefinedSlideView;
}) {
  const headerTone =
    tone === 'primary'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
      : 'border-border bg-muted text-muted-foreground';
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className={`border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${headerTone}`}>
        {label}
      </div>
      <div className="space-y-3 p-3 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Title</div>
          <p className="font-medium leading-snug">{view.title}</p>
        </div>
        {view.layout && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Layout: <span className="font-mono normal-case text-foreground">{view.layout}</span>
          </div>
        )}
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Bullets ({view.bullets.length})
          </div>
          {view.bullets.length === 0 ? (
            <p className="text-muted-foreground">— none</p>
          ) : (
            <ul className="space-y-1">
              {view.bullets.map((b, i) => (
                <li key={i} className="leading-snug">
                  • {b}
                </li>
              ))}
            </ul>
          )}
        </div>
        {view.speakerNotes && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Speaker notes
            </div>
            <p className="leading-relaxed text-muted-foreground">{view.speakerNotes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
