'use client';

// ════════════════════════════════════════════════════════════════════════════
// Blueprints — generate form (left), library list (left bottom), markdown
// detail (right). Lightweight markdown renderer (headings + lists + bold +
// italics + code) — no need for a full mdx pipeline here.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { csrfHeaders } from '@/lib/csrf-client';

interface BlueprintListRow {
  id: string;
  topic: string;
  learnerLevel: string | null;
  createdAt: string;
}

interface BlueprintFull extends BlueprintListRow {
  sessionLengthMinutes: number | null;
  clinicalSetting: string | null;
  priorKnowledgeAssumed: string | null;
  constraints: string | null;
  content: string;
  source: string;
}

const CLINICAL_SETTING_SUGGESTIONS = [
  'OPD',
  'Operating theatre',
  'Wet-lab',
  'Emergency',
  'Retina clinic',
  'Uveitis service',
  'Pediatric clinic',
  'Simulation lab',
];

const SESSION_LENGTH_PRESETS = [30, 45, 60, 90, 120];

const LEARNER_LEVEL_OPTIONS = [
  '',
  'Intern',
  'PGY-1 student',
  'PGY-2 student',
  'Senior student',
  'Vitreoretinal fellow',
  'Cornea fellow',
  'Glaucoma fellow',
  'Pediatric ophthalmology fellow',
  'Optometrist',
  'Practicing ophthalmologist',
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function BlueprintsClient({ initial }: { initial: BlueprintListRow[] }) {
  const [list, setList] = useState<BlueprintListRow[]>(initial);
  const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null);
  const [activeBlueprint, setActiveBlueprint] = useState<BlueprintFull | null>(null);
  const [topic, setTopic] = useState('');
  const [learnerLevel, setLearnerLevel] = useState('');
  const [sessionLengthMinutes, setSessionLengthMinutes] = useState<number | ''>('');
  const [clinicalSetting, setClinicalSetting] = useState('');
  const [priorKnowledgeAssumed, setPriorKnowledgeAssumed] = useState('');
  const [constraints, setConstraints] = useState('');
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filledAudienceCount = [
    sessionLengthMinutes !== '',
    clinicalSetting.trim().length > 0,
    priorKnowledgeAssumed.trim().length > 0,
    constraints.trim().length > 0,
  ].filter(Boolean).length;

  const loadDetail = useCallback(async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/blueprints/${id}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { blueprint: BlueprintFull };
        error?: { message: string };
      };
      if (!json.ok || !json.data) throw new Error(json.error?.message ?? 'Load failed');
      setActiveBlueprint(json.data.blueprint);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (activeId) loadDetail(activeId);
    else setActiveBlueprint(null);
  }, [activeId, loadDetail]);

  async function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!topic.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          topic: topic.trim(),
          learnerLevel: learnerLevel || undefined,
          sessionLengthMinutes:
            typeof sessionLengthMinutes === 'number' ? sessionLengthMinutes : undefined,
          clinicalSetting: clinicalSetting.trim() || undefined,
          priorKnowledgeAssumed: priorKnowledgeAssumed.trim() || undefined,
          constraints: constraints.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { blueprint: BlueprintFull };
        error?: { message: string };
      };
      if (!json.ok || !json.data) throw new Error(json.error?.message ?? `Failed (${res.status})`);
      const bp = json.data.blueprint;
      setList((prev) => [
        { id: bp.id, topic: bp.topic, learnerLevel: bp.learnerLevel, createdAt: bp.createdAt },
        ...prev,
      ]);
      setActiveId(bp.id);
      setActiveBlueprint(bp);
      setTopic('');
      setSessionLengthMinutes('');
      setClinicalSetting('');
      setPriorKnowledgeAssumed('');
      setConstraints('');
      setAudienceOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteBlueprint(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/blueprints/${id}`, {
        method: 'DELETE',
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(j?.error?.message ?? `Delete failed (${res.status})`);
      }
      setList((prev) => prev.filter((b) => b.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setActiveBlueprint(null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left: form + history */}
      <aside className="space-y-4 lg:col-span-4">
        <form
          onSubmit={generate}
          className="space-y-3 rounded-lg border border-border bg-card p-5"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            New blueprint
          </h2>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Topic / module</span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
              placeholder="e.g. Acute angle-closure glaucoma"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Learner level (optional)</span>
            <select
              value={learnerLevel}
              onChange={(e) => setLearnerLevel(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {LEARNER_LEVEL_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l || '— pick a level —'}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-md border border-dashed border-border">
            <button
              type="button"
              onClick={() => setAudienceOpen((v) => !v)}
              aria-expanded={audienceOpen}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
            >
              <span className="flex items-center gap-2">
                <motion.span
                  animate={{ rotate: audienceOpen ? 90 : 0 }}
                  transition={{ duration: 0.15 }}
                  className="inline-block text-muted-foreground"
                >
                  ▸
                </motion.span>
                <span className="font-medium">Audience context</span>
                <span className="text-muted-foreground">
                  {filledAudienceCount > 0 ? `· ${filledAudienceCount}/4 filled` : '· optional, sharpens the blueprint'}
                </span>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {audienceOpen && (
                <motion.div
                  key="audience-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 border-t border-border px-3 py-3">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Session length</span>
                      <div className="flex flex-wrap gap-1.5">
                        {SESSION_LENGTH_PRESETS.map((m) => {
                          const active = sessionLengthMinutes === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setSessionLengthMinutes(active ? '' : m)}
                              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                                active
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border text-muted-foreground hover:bg-muted'
                              }`}
                            >
                              {m} min
                            </button>
                          );
                        })}
                        <input
                          type="number"
                          min={15}
                          max={240}
                          value={sessionLengthMinutes === '' ? '' : sessionLengthMinutes}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') return setSessionLengthMinutes('');
                            const n = Number.parseInt(v, 10);
                            if (Number.isFinite(n)) setSessionLengthMinutes(n);
                          }}
                          placeholder="custom"
                          className="w-20 rounded-md border border-input bg-background px-2 py-0.5 text-[11px]"
                        />
                      </div>
                    </div>

                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">Clinical setting</span>
                      <input
                        value={clinicalSetting}
                        onChange={(e) => setClinicalSetting(e.target.value)}
                        list="bp-clinical-setting"
                        placeholder="e.g. OPD, wet-lab, retina clinic"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                      />
                      <datalist id="bp-clinical-setting">
                        {CLINICAL_SETTING_SUGGESTIONS.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    </label>

                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">Prior knowledge assumed</span>
                      <textarea
                        value={priorKnowledgeAssumed}
                        onChange={(e) => setPriorKnowledgeAssumed(e.target.value)}
                        rows={2}
                        placeholder="What can you assume learners already know? Stops the model from re-teaching basics."
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                      />
                    </label>

                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">Constraints / available resources</span>
                      <textarea
                        value={constraints}
                        onChange={(e) => setConstraints(e.target.value)}
                        rows={2}
                        placeholder="e.g. no Heidelberg Spectralis, single shared OCT, 2 wet-lab stations"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                      />
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            type="submit"
            disabled={busy || !topic.trim()}
            className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Generating…' : '✨ Generate blueprint'}
          </button>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-[10px] text-muted-foreground">
            ~10–20 seconds. One Gemini call. Saved to your library below.
          </p>
        </form>

        <section className="rounded-lg border border-border bg-card">
          <header className="border-b border-border p-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Library ({list.length})
            </h2>
          </header>
          {list.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              No blueprints yet — generate one above.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              <AnimatePresence initial={false}>
                {list.map((b) => (
                  <motion.li
                    key={b.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`group flex items-start gap-2 p-3 transition ${
                      b.id === activeId ? 'bg-primary/5' : 'hover:bg-muted'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveId(b.id)}
                      className="flex-1 text-left"
                    >
                      <p className="line-clamp-2 text-sm font-medium">{b.topic}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {b.learnerLevel ?? 'Level unspecified'} · {formatDate(b.createdAt)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBlueprint(b.id)}
                      aria-label="Delete"
                      className="opacity-0 transition group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    >
                      ✕
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </aside>

      {/* Right: detail */}
      <main className="lg:col-span-8">
        {activeBlueprint ? (
          <BlueprintDetail blueprint={activeBlueprint} />
        ) : (
          <div className="flex h-[60vh] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            Pick a blueprint, or generate one to begin.
          </div>
        )}
      </main>
    </div>
  );
}

function BlueprintDetail({ blueprint }: { blueprint: BlueprintFull }) {
  const rendered = useMemo(() => renderMarkdown(blueprint.content), [blueprint.content]);

  function copyMarkdown() {
    void navigator.clipboard.writeText(blueprint.content).catch(() => {});
  }

  function downloadMarkdown() {
    const blob = new Blob([blueprint.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${blueprint.topic.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'blueprint'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const audienceChips: Array<{ label: string; value: string }> = [];
  if (blueprint.learnerLevel) audienceChips.push({ label: 'Learner', value: blueprint.learnerLevel });
  if (blueprint.sessionLengthMinutes)
    audienceChips.push({ label: 'Session', value: `${blueprint.sessionLengthMinutes} min` });
  if (blueprint.clinicalSetting)
    audienceChips.push({ label: 'Setting', value: blueprint.clinicalSetting });
  if (blueprint.priorKnowledgeAssumed)
    audienceChips.push({ label: 'Prior knowledge', value: blueprint.priorKnowledgeAssumed });
  if (blueprint.constraints)
    audienceChips.push({ label: 'Constraints', value: blueprint.constraints });

  return (
    <article className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Precision Education Blueprint
          </p>
          <h2 className="mt-1 text-xl font-semibold">{blueprint.topic}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Generated {new Date(blueprint.createdAt).toLocaleString()}
          </p>
          {audienceChips.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {audienceChips.map((c) => (
                <li
                  key={c.label}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px]"
                >
                  <span className="text-muted-foreground">{c.label}:</span>
                  <span className="truncate">{c.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyMarkdown}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Copy markdown
          </button>
          <button
            type="button"
            onClick={downloadMarkdown}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Download .md
          </button>
        </div>
      </header>
      <div
        className="blueprint-prose space-y-3 p-6 text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </article>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Tiny markdown → HTML renderer. Supports the subset Gemini outputs:
// # / ## headings, - / * unordered lists, 1. ordered lists, **bold**, *italic*,
// `inline code`. Escapes raw HTML so the model can't smuggle a <script> via
// the prompt path. Not a full CommonMark parser — sufficient for the
// blueprint's structured headings + bullets.
// ───────────────────────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-[13px]">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  return out;
}

function renderMarkdown(src: string): string {
  const lines = src.split('\n');
  const html: string[] = [];
  let listOpen: 'ul' | 'ol' | null = null;
  let inPara = false;
  const closeList = () => {
    if (listOpen) {
      html.push(`</${listOpen}>`);
      listOpen = null;
    }
  };
  const closePara = () => {
    if (inPara) {
      html.push('</p>');
      inPara = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === '') {
      closeList();
      closePara();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      closePara();
      const level = heading[1].length;
      const sizes = [
        'text-2xl font-bold mt-6 mb-2',
        'text-xl font-semibold mt-5 mb-2',
        'text-lg font-semibold mt-4 mb-1.5',
        'text-base font-semibold mt-3 mb-1',
      ];
      html.push(
        `<h${level} class="${sizes[level - 1]}">${renderInline(heading[2])}</h${level}>`,
      );
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ul) {
      closePara();
      if (listOpen !== 'ul') {
        closeList();
        html.push('<ul class="ml-5 list-disc space-y-1">');
        listOpen = 'ul';
      }
      html.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }
    if (ol) {
      closePara();
      if (listOpen !== 'ol') {
        closeList();
        html.push('<ol class="ml-5 list-decimal space-y-1">');
        listOpen = 'ol';
      }
      html.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }
    closeList();
    if (!inPara) {
      html.push('<p>');
      inPara = true;
    } else {
      html.push(' ');
    }
    html.push(renderInline(line));
  }
  closeList();
  closePara();
  return html.join('');
}
