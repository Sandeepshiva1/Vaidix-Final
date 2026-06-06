'use client';

// ════════════════════════════════════════════════════════════════════════════
// DeckAiSlidesPanel — "AI Slides" tab body of the deck editor right panel
// ════════════════════════════════════════════════════════════════════════════
// Faculty types what they want; we POST /api/decks/[jobId]/slides/generate which
// AI-generates 1–6 NEW slides and appends them to the deck (non-destructive).
// On success the new slides are handed back via onSlidesAppended so they appear
// instantly in the canvas + left rail. Generation is strictly user-initiated
// (it spends tokens) and degrades gracefully when the AI provider is offline.

import { useState } from 'react';
import { Loader2, Sparkles, Plus, AlertCircle, CheckCircle2, WifiOff } from 'lucide-react';
import type { SlideLayout } from '@prisma/client';
import { csrfHeaders } from '@/lib/csrf-client';
import type { SlideViewModel } from './slide-canvas';

interface GeneratedSlide {
  id: string;
  order: number;
  layout: SlideLayout;
  title: string;
  bullets: string[];
  speakerNotes: string | null;
}

interface Props {
  jobId: string;
  onSlidesAppended: (slides: SlideViewModel[]) => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'done'; titles: string[] }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

function toViewModel(s: GeneratedSlide): SlideViewModel {
  return {
    id: s.id,
    order: s.order,
    layout: s.layout,
    title: s.title,
    bullets: s.bullets,
    speakerNotes: s.speakerNotes,
    accentHex: null,
    imageS3Key: null,
    imageUrl: null,
  };
}

export function DeckAiSlidesPanel({ jobId, onSlidesAppended }: Props) {
  const [prompt, setPrompt] = useState('');
  const [count, setCount] = useState(1);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const busy = phase.kind === 'generating';

  async function generate() {
    if (prompt.trim().length < 3 || busy) return;
    setPhase({ kind: 'generating' });
    try {
      const res = await fetch(`/api/decks/${jobId}/slides/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ prompt: prompt.trim(), count }),
      });
      if (res.status === 503) {
        setPhase({ kind: 'offline' });
        return;
      }
      const json = (await res.json()) as {
        ok: boolean;
        data?: { slides: GeneratedSlide[] };
        error?: { message: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? `Generation failed (${res.status})`);
      }
      const slides = json.data.slides;
      onSlidesAppended(slides.map(toViewModel));
      setPhase({ kind: 'done', titles: slides.map((s) => s.title) });
      setPrompt('');
    } catch (err) {
      setPhase({ kind: 'error', message: (err as Error).message });
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      {/* Info banner */}
      <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/5 px-3 py-2.5">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Describe a slide (or a few) to add — AI drafts them grounded in this deck&apos;s topic and
          appends them to the end. You can edit or reorder afterwards. Generating spends tokens, so
          it only runs when you click.
        </p>
      </div>

      <label className="text-[11px] font-semibold text-muted-foreground">What should the new slide(s) cover?</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
        rows={3}
        placeholder='e.g. "Add a slide on anti-VEGF dosing intervals for DME" or "a key-features question on NPDR severity"'
        className="mt-1 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs disabled:opacity-60"
        data-testid="ai-slides-prompt"
      />

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
          Slides
          <input
            type="number"
            min={1}
            max={6}
            value={count}
            disabled={busy}
            onChange={(e) => setCount(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
            className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-center text-xs font-semibold outline-none focus:border-indigo-500 disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={busy || prompt.trim().length < 3}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-indigo-600 px-4 text-[12px] font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-40"
          data-testid="ai-slides-generate"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? 'Generating…' : 'Generate slides'}
        </button>
      </div>

      {/* Outcome */}
      <div className="mt-4">
        {phase.kind === 'offline' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="ai-slides-offline">
            <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>AI slide builder is offline right now — your deck is unchanged. Try again shortly.</span>
          </div>
        )}
        {phase.kind === 'error' && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[11px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{phase.message}</span>
          </div>
        )}
        {phase.kind === 'done' && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Added {phase.titles.length} slide{phase.titles.length === 1 ? '' : 's'} to the deck
            </div>
            <ul className="mt-1.5 space-y-1">
              {phase.titles.map((t, i) => (
                <li key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Plus className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span className="truncate">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
