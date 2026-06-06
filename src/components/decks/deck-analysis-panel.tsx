'use client';

// ════════════════════════════════════════════════════════════════════════════
// DeckAnalysisPanel — "Analysis" tab body of the deck editor right panel
// ════════════════════════════════════════════════════════════════════════════
// Score card (readability / density / balance) + Analyze/Re-run CTA + the
// "Refine this slide" instruction box. Lifted from the former single
// DeckAiCoach; the parent (DeckRightPanel) owns the analysis state and the
// shared diff modal, so this panel is presentational + emits onAnalyze/onRefine.

import { useState } from 'react';
import {
  Loader2,
  Sparkles,
  MessageSquare,
  Send,
  RefreshCw,
  AlertCircle,
  Languages,
  Brain,
} from 'lucide-react';
import type { DeckAnalysisResult } from '@/server/services/decks/deck-analyze-service';
import { scoreTone } from './deck-coach-shared';

interface Props {
  analysis: DeckAnalysisResult | null;
  analyzing: boolean;
  analyzeError: string | null;
  onAnalyze: () => void;
  /** The currently focused slide — the refine box only shows when one exists. */
  activeSlideId: string | null;
  /** True while a refine/apply diff is being computed (drives the send spinner). */
  refining: boolean;
  onRefine: (instruction: string, intent: 'english' | 'content') => void;
}

export function DeckAnalysisPanel({
  analysis,
  analyzing,
  analyzeError,
  onAnalyze,
  activeSlideId,
  refining,
  onRefine,
}: Props) {
  const [refineInstruction, setRefineInstruction] = useState('');
  const [refineIntent, setRefineIntent] = useState<'english' | 'content'>('english');

  const appliedCount = analysis
    ? analysis.suggestions.filter((s) => s.appliedAt).length
    : 0;
  const dismissedCount = analysis
    ? analysis.suggestions.filter((s) => s.dismissedAt).length
    : 0;

  function submitRefine() {
    if (!refineInstruction.trim()) return;
    onRefine(refineInstruction.trim(), refineIntent);
    setRefineInstruction('');
  }

  return (
    <div className="flex h-full flex-col">
      {/* Score card */}
      <section className="border-b border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            AI Analysis
          </h3>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={analyzing}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium transition hover:bg-muted disabled:opacity-50"
            data-testid="coach-reanalyze"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Analyzing
              </>
            ) : analysis ? (
              <>
                <RefreshCw className="h-3 w-3" /> Re-run
              </>
            ) : (
              <>
                <Brain className="h-3 w-3" /> Analyze
              </>
            )}
          </button>
        </div>

        {analyzing && !analysis ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
            AI is reviewing the deck…
          </div>
        ) : analysis ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <ScoreTile label="Read" score={analysis.readabilityScore} />
              <ScoreTile label="Density" score={analysis.slideDensityScore} />
              <ScoreTile label="Balance" score={analysis.visualBalanceScore} />
            </div>
            {analysis.notes && (
              <p className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {analysis.notes}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
              {analysis.passes?.review === 'failed' && (
                <span className="text-rose-500">Review pass failed</span>
              )}
              {analysis.passes?.design === 'failed' && (
                <span className="text-rose-500">Design pass failed</span>
              )}
              {appliedCount > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">✓ {appliedCount} applied</span>
              )}
              {dismissedCount > 0 && <span>{dismissedCount} dismissed</span>}
            </div>
          </>
        ) : analyzeError ? (
          <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{analyzeError}</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No analysis yet — click Analyze.</p>
        )}
      </section>

      {/* Spacer / hint */}
      <div className="flex-1 overflow-y-auto p-4 text-[11px] leading-relaxed text-muted-foreground">
        {analysis ? (
          <>
            Switch to the <span className="font-medium text-foreground">Fixes</span> tab to apply
            individual suggestions, or refine the focused slide below.
          </>
        ) : (
          'Analysis scores the deck on readability, density and visual balance, and lists clinical + design fixes you can apply one by one. It costs tokens, so it only runs when you click Analyze.'
        )}
      </div>

      {/* Refine chat */}
      {activeSlideId && (
        <section className="border-t border-border bg-card/30 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            Refine this slide
          </h3>

          <div className="mb-2 inline-flex rounded-lg border border-border bg-background p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setRefineIntent('english')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                refineIntent === 'english'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Languages className="h-3 w-3" /> English
            </button>
            <button
              type="button"
              onClick={() => setRefineIntent('content')}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                refineIntent === 'content'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Brain className="h-3 w-3" /> Content
            </button>
            <span className="ml-2 self-center pr-2 text-[9px] text-muted-foreground">
              {refineIntent === 'english' ? 'Quick polish' : 'Deeper reasoning'}
            </span>
          </div>

          <div className="flex gap-1.5">
            <textarea
              value={refineInstruction}
              onChange={(e) => setRefineInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitRefine();
                }
              }}
              placeholder={
                refineIntent === 'english'
                  ? 'e.g. "tighten these bullets" or "fix grammar"'
                  : 'e.g. "add evidence for PRP threshold" or "include AAO PPP cutoff"'
              }
              className="min-h-[60px] flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs"
              data-testid="coach-refine-input"
            />
            <button
              type="button"
              onClick={submitRefine}
              disabled={!refineInstruction.trim() || refining}
              className="self-start rounded-lg bg-foreground p-2 text-background transition hover:opacity-90 disabled:opacity-50"
              aria-label="Send refine instruction"
              data-testid="coach-refine-send"
            >
              {refining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">⌘/Ctrl + Enter to send</p>
        </section>
      )}
    </div>
  );
}

function ScoreTile({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-bold ${scoreTone(score)}`}>
        {score.toFixed(1)}
        <span className="text-[10px] font-normal text-muted-foreground">/10</span>
      </div>
    </div>
  );
}
