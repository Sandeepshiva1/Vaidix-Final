'use client';

// ════════════════════════════════════════════════════════════════════════════
// HookOverlay — Stream D #4 (live hook prompt for learners)
// ════════════════════════════════════════════════════════════════════════════
// Polls /api/classroom/sessions/[id]/hooks?onlyFired=true every 4s. When a new
// fired hook arrives, surfaces a centered modal with options. Submitting POSTs
// to /[hookId]/respond. Records latency client-side and sends with the response.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface LiveHookDTO {
  id: string;
  kind: 'TRUE_FALSE' | 'POLL' | 'ONE_WORD' | 'REPEAT_CONCEPT' | 'DILEMMA';
  prompt: string;
  options: string[] | null;
  intervalSeconds: number | null;
  scheduledAt: string | null;
  firedAt: string | null;
  closedAt: string | null;
}

const POLL_INTERVAL_MS = 4000;

function defaultOptions(kind: LiveHookDTO['kind']): string[] | null {
  if (kind === 'TRUE_FALSE') return ['True', 'False'];
  return null;
}

export function HookOverlay({ sessionId }: { sessionId: string }) {
  const [activeHook, setActiveHook] = useState<LiveHookDTO | null>(null);
  const [respondedIds, setRespondedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const firedAtMsRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/hooks?onlyFired=true`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { ok: boolean; data?: { hooks: LiveHookDTO[] } };
      if (!json.ok || !json.data) return;
      const open = json.data.hooks
        .filter((h) => h.firedAt && !h.closedAt && !respondedIds.has(h.id))
        .sort((a, b) => (b.firedAt ?? '').localeCompare(a.firedAt ?? ''))[0];
      if (open && open.id !== activeHook?.id) {
        setActiveHook(open);
        firedAtMsRef.current = open.firedAt ? new Date(open.firedAt).getTime() : Date.now();
        setFeedback(null);
        setFreeText('');
      }
    } catch {
      /* swallow — transient network errors are fine */
    }
  }, [sessionId, activeHook, respondedIds]);

  useEffect(() => {
    void poll();
    const iv = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [poll]);

  const options = useMemo(
    () => activeHook?.options ?? (activeHook ? defaultOptions(activeHook.kind) : null),
    [activeHook]
  );

  if (!activeHook) return null;

  const isFreeForm = !options;

  async function submit(answer: string) {
    if (!activeHook) return;
    setSubmitting(true);
    setFeedback(null);
    const latency = firedAtMsRef.current ? Date.now() - firedAtMsRef.current : undefined;
    try {
      const res = await fetch(
        `/api/classroom/sessions/${sessionId}/hooks/${activeHook.id}/respond`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: answer, latencyMs: latency }),
        }
      );
      const json = (await res.json()) as {
        ok: boolean;
        data?: { isCorrect: boolean | null };
        error?: { message: string };
      };
      if (!json.ok) {
        setFeedback(json.error?.message ?? 'Failed to submit');
        return;
      }
      const result = json.data?.isCorrect;
      setFeedback(
        result == null
          ? 'Got it — thanks for responding.'
          : result
            ? 'Correct.'
            : 'Not quite — see the explanation after the session.'
      );
      setRespondedIds((prev) => new Set(prev).add(activeHook.id));
      setTimeout(() => setActiveHook(null), 1800);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Explicit dark colours — LiveKit's data-lk-theme overrides CSS variables
    // inside the live-session shell, making bg-card / text-foreground resolve
    // to near-identical values and rendering the modal content invisible.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl shadow-black/60 text-white">
        <div className="mb-3 flex items-center justify-between">
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
            {activeHook.kind.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-white/50">Quick check</span>
        </div>
        <p className="text-base font-semibold leading-relaxed text-white">{activeHook.prompt}</p>

        {isFreeForm ? (
          <div className="mt-4 space-y-2">
            <input
              autoFocus
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Your answer…"
              className="w-full rounded-lg border border-white/15 bg-white/8 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-teal-400/60 focus:ring-2 focus:ring-teal-400/20"
              maxLength={200}
              disabled={submitting}
            />
            <button
              type="button"
              disabled={submitting || !freeText.trim()}
              onClick={() => submit(freeText.trim())}
              className="w-full rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-400 disabled:opacity-40"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        ) : (
          <div className="mt-4 grid gap-2">
            {options!.map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={submitting}
                onClick={() => submit(opt)}
                className="rounded-lg border border-white/15 bg-white/8 px-4 py-2.5 text-left text-sm font-medium text-white hover:border-teal-400/50 hover:bg-teal-500/15 transition-colors disabled:opacity-40"
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {feedback && <p className="mt-3 text-sm text-teal-300">{feedback}</p>}
      </div>
    </div>
  );
}
