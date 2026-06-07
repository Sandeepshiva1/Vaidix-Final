'use client';

// ════════════════════════════════════════════════════════════════════════════
// DeckHooksPanel — "Hooks" tab body of the deck editor right panel
// ════════════════════════════════════════════════════════════════════════════
// Live-session interaction prompts (polls, T/F, etc.). Hooks are session-scoped
// (LiveHook.sessionId), so this tab is only functional when the editor is opened
// from a session (backToSessionId). It lists existing hooks (free DB read) and
// creates new ones via the existing /api/classroom/sessions/[id]/hooks endpoint.
// The active slide is shown only as a label — LiveHook has no slide foreign key.

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Zap,
  Plus,
  AlertCircle,
  CheckCircle2,
  X,
  Vote,
  ToggleLeft,
  MessageSquare,
  RefreshCw,
  Stethoscope,
  Sparkles,
} from 'lucide-react';
import type { LiveHookKind } from '@prisma/client';
import { csrfHeaders } from '@/lib/csrf-client';

interface ListedHook {
  id: string;
  kind: LiveHookKind;
  prompt: string;
  options: string[] | null;
  responseCount: number;
  firedAt: string | null;
  prePublishedAt: string | null;
}

interface Props {
  /** Deck forge job — used by the AI "Suggest" call to load slide content server-side. */
  jobId: string;
  sessionId: string | null;
  /** Focused slide id — the AI grounds drafts in this slide's content. */
  activeSlideId: string | null;
  /** 0-based order of the focused slide, for the "for slide N" label only. */
  activeSlideOrder: number | null;
}

/** A Gemini-drafted hook awaiting the presenter's review (not yet persisted). */
interface SuggestedDraft {
  kind: LiveHookKind;
  prompt: string;
  options: string[] | null;
  correctOption: string | null;
}

const KIND_OPTIONS: {
  kind: LiveHookKind;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  needsOptions: boolean;
}[] = [
  { kind: 'POLL', label: 'Live poll', Icon: Vote, needsOptions: true },
  { kind: 'TRUE_FALSE', label: 'True / False', Icon: ToggleLeft, needsOptions: false },
  { kind: 'ONE_WORD', label: 'One-word', Icon: MessageSquare, needsOptions: false },
  { kind: 'REPEAT_CONCEPT', label: 'Repeat concept', Icon: RefreshCw, needsOptions: false },
  { kind: 'DILEMMA', label: 'Clinical dilemma', Icon: Stethoscope, needsOptions: false },
];

export function DeckHooksPanel({ jobId, sessionId, activeSlideId, activeSlideOrder }: Props) {
  const [hooks, setHooks] = useState<ListedHook[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<LiveHookKind>('POLL');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // ── AI suggest state ──────────────────────────────────────────────────────
  const [suggesting, setSuggesting] = useState(false);
  const [drafts, setDrafts] = useState<SuggestedDraft[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [addingDraftIdx, setAddingDraftIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoadError(null);
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/hooks`, { credentials: 'include' });
      const json = (await res.json()) as { ok: boolean; data?: { hooks: ListedHook[] }; error?: { message: string } };
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error?.message ?? `Failed (${res.status})`);
      setHooks(json.data.hooks);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const needsOptions = KIND_OPTIONS.find((k) => k.kind === kind)?.needsOptions ?? false;

  // Shared POST → create one hook against the session. Throws on failure.
  const postHook = useCallback(
    async (payload: { kind: LiveHookKind; prompt: string; options?: string[]; correctOption?: string | null }) => {
      if (!sessionId) return;
      const body: Record<string, unknown> = { kind: payload.kind, prompt: payload.prompt.trim() };
      if (payload.options && payload.options.length > 0) body.options = payload.options;
      if (payload.correctOption) body.correctOption = payload.correctOption;
      const res = await fetch(`/api/classroom/sessions/${sessionId}/hooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (res.status === 403) throw new Error('Only the session host (or PD/admin) can add hooks.');
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? `Failed (${res.status})`);
    },
    [sessionId],
  );

  async function save() {
    if (!sessionId || prompt.trim().length < 1 || saving) return;
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (needsOptions && cleanOptions.length < 2) {
      setSaveError('Add at least two options for a poll.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await postHook({
        kind,
        prompt,
        options: needsOptions ? cleanOptions : kind === 'TRUE_FALSE' ? ['True', 'False'] : undefined,
      });
      setPrompt('');
      setOptions(['', '']);
      await load();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── AI suggest: Gemini drafts hooks grounded in the focused slide ──────────
  async function suggestWithAi() {
    if (!activeSlideId || suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch(`/api/decks/${jobId}/suggest-hooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        credentials: 'include',
        body: JSON.stringify({ slideId: activeSlideId }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { hooks: SuggestedDraft[] };
        error?: { message: string };
      };
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error?.message ?? `Failed (${res.status})`);
      setDrafts(json.data.hooks);
      if (json.data.hooks.length === 0) {
        setSuggestError('No hooks could be drafted for this slide — add more detail to it.');
      }
    } catch (err) {
      setSuggestError((err as Error).message);
    } finally {
      setSuggesting(false);
    }
  }

  const editDraftPrompt = (i: number, value: string) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, prompt: value } : d)));

  const dismissDraft = (i: number) => setDrafts((prev) => prev.filter((_, j) => j !== i));

  // Load a draft into the composer so the presenter can tweak options before adding.
  const loadDraftIntoComposer = (d: SuggestedDraft) => {
    setKind(d.kind);
    setPrompt(d.prompt);
    setOptions(d.options && d.options.length > 0 ? [...d.options] : ['', '']);
    setSaveError(null);
  };

  // Add a draft directly (skips the composer).
  async function addDraft(i: number) {
    const d = drafts[i];
    if (!d || !d.prompt.trim() || addingDraftIdx !== null) return;
    setAddingDraftIdx(i);
    setSuggestError(null);
    try {
      await postHook({ kind: d.kind, prompt: d.prompt, options: d.options ?? undefined, correctOption: d.correctOption });
      dismissDraft(i);
      await load();
    } catch (err) {
      setSuggestError((err as Error).message);
    } finally {
      setAddingDraftIdx(null);
    }
  }

  // ── No session → disabled explainer ───────────────────────────────────────
  if (!sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Zap className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs font-medium">Hooks are live-session features</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Open this deck from a session (Pre-Conference → My Presentation) to add learner polls,
          true/false checks and clinical dilemmas that fire during the live class.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4" data-testid="deck-hooks-panel">
      {/* Composer */}
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <Zap className="h-3.5 w-3.5" />
          New hook
          {activeSlideOrder != null && (
            <span className="font-normal text-muted-foreground">· for slide {activeSlideOrder + 1}</span>
          )}
        </div>

        {/* AI suggest — drafts grounded in the focused slide */}
        <button
          type="button"
          onClick={suggestWithAi}
          disabled={suggesting || !activeSlideId}
          title={!activeSlideId ? 'Focus a slide first' : undefined}
          className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-linear-to-r from-indigo-500 to-violet-500 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          data-testid="hook-ai-suggest"
        >
          {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {suggesting
            ? 'Drafting…'
            : drafts.length > 0
              ? 'Regenerate with AI'
              : activeSlideOrder != null
                ? `Suggest hooks for slide ${activeSlideOrder + 1}`
                : 'Suggest hooks with AI'}
        </button>

        {suggestError && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{suggestError}</span>
          </div>
        )}

        {drafts.length > 0 && (
          <div className="mt-2 space-y-2 rounded-lg border border-indigo-500/25 bg-indigo-500/4 p-2" data-testid="hook-ai-drafts">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              <Sparkles className="h-3 w-3" /> AI drafts — edit, then add
            </div>
            {drafts.map((d, i) => {
              const meta = KIND_OPTIONS.find((k) => k.kind === d.kind);
              const DIcon = meta?.Icon ?? Zap;
              return (
                <div key={i} className="space-y-1.5 rounded-md border border-border bg-background p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                      <DIcon className="h-3 w-3" /> {meta?.label ?? d.kind}
                    </span>
                    <button
                      type="button"
                      onClick={() => dismissDraft(i)}
                      className="ml-auto text-muted-foreground hover:text-rose-600"
                      aria-label="Dismiss draft"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={d.prompt}
                    onChange={(e) => editDraftPrompt(i, e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-[11px]"
                  />
                  {d.options && d.options.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {d.options.map((o, j) => (
                        <span key={j} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {o}
                          {d.correctOption === o ? ' ✓' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => addDraft(i)}
                      disabled={addingDraftIdx !== null}
                      className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-amber-500 py-1.5 text-[11px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
                    >
                      {addingDraftIdx === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => loadDraftIntoComposer(d)}
                      className="rounded-md border border-border px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                      title="Load into the composer below to tweak before adding"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-1.5">
          {KIND_OPTIONS.map((k) => {
            const KIcon = k.Icon;
            return (
              <button
                key={k.kind}
                type="button"
                onClick={() => setKind(k.kind)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition ${
                  kind === k.kind
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
                data-testid={`hook-kind-${k.kind}`}
              >
                <KIcon className="h-3 w-3" /> {k.label}
              </button>
            );
          })}
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Question or prompt to put to the learners…"
          className="mt-2 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs"
          data-testid="hook-prompt"
        />

        {needsOptions && (
          <div className="mt-2 space-y-1.5">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={opt}
                  onChange={(e) => setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                  placeholder={`Option ${i + 1}`}
                  className="flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-rose-600"
                    aria-label="Remove option"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ''])}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 hover:underline dark:text-amber-300"
              >
                <Plus className="h-3 w-3" /> Add option
              </button>
            )}
          </div>
        )}

        {saveError && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving || prompt.trim().length < 1}
          className="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 text-[12px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          data-testid="hook-save"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {saving ? 'Saving…' : 'Add hook'}
        </button>
      </div>

      {/* Existing hooks */}
      <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Hooks in this session {hooks ? `(${hooks.length})` : ''}
      </h3>
      {loadError ? (
        <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{loadError}</span>
        </div>
      ) : !hooks ? (
        <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : hooks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No hooks yet — add the first one above.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="hook-list">
          {hooks.map((h) => {
            const meta = KIND_OPTIONS.find((k) => k.kind === h.kind);
            const KIcon = meta?.Icon ?? Zap;
            return (
              <li key={h.id} className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">
                    <KIcon className="h-3 w-3" /> {meta?.label ?? h.kind}
                  </span>
                  {h.firedAt ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Fired
                    </span>
                  ) : h.prePublishedAt ? (
                    <span className="text-[10px] text-muted-foreground">Pre-published</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Draft</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">{h.responseCount} responses</span>
                </div>
                <p className="text-xs leading-relaxed text-foreground">{h.prompt}</p>
                {h.options && h.options.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {h.options.map((o, i) => (
                      <span key={i} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {o}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
