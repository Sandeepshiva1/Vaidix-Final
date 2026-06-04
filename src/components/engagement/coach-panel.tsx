'use client';

// ════════════════════════════════════════════════════════════════════════════
// CoachPanel —  client surface
// ════════════════════════════════════════════════════════════════════════════
// Learner asks the reinforcement coach a free-form question; bot replies with
// answer + follow-up quiz + case example. Phase A is stateless (no history).

import { useState } from 'react';

interface CoachReply {
  answer: string;
  followUpQuiz: string;
  caseExample: string;
}

interface Turn {
  question: string;
  reply: CoachReply | null;
}

export function CoachPanel({ learnerId }: { learnerId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setSubmitting(true);
    setError(null);
    setTurns((prev) => [...prev, { question: q, reply: null }]);
    setQuestion('');
    try {
      const res = await fetch(`/api/learners/${learnerId}/coach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { reply: CoachReply };
        error?: { message: string };
      };
      if (!json.ok || !json.data) throw new Error(json.error?.message ?? 'Coach failed');
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = { question: q, reply: json.data!.reply };
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
      setTurns((prev) => prev.slice(0, -1));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <p className="text-sm font-medium">Coach</p>
        <p className="text-xs text-muted-foreground">
          Ask the bot to re-explain anything from the session.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {turns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Try: &quot;Explain anti-VEGF in PDR again&quot;
          </p>
        ) : (
          turns.map((t, idx) => (
            <div key={idx} className="space-y-2 text-sm">
              <p className="font-medium">You: {t.question}</p>
              {t.reply ? (
                <div className="rounded-md border bg-muted/40 p-2 text-xs">
                  <p>{t.reply.answer}</p>
                  <p className="mt-2 text-muted-foreground">
                    <strong>Quiz:</strong> {t.reply.followUpQuiz}
                  </p>
                  <p className="text-muted-foreground">
                    <strong>Case:</strong> {t.reply.caseExample}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Coach is thinking…</p>
              )}
            </div>
          ))
        )}
      </div>
      <div className="border-t p-2 space-y-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask the coach…"
          className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          maxLength={1500}
          disabled={submitting}
        />
        <button
          type="button"
          onClick={ask}
          disabled={submitting || !question.trim()}
          className="w-full rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Asking…' : 'Ask'}
        </button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
