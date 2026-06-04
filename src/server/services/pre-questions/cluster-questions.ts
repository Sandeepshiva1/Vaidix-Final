// ════════════════════════════════════════════════════════════════════════════
// Pre-question clustering
// ════════════════════════════════════════════════════════════════════════════
// Calls Gemini to cluster a session's submitted pre-questions into themes.
// Returns label + summary + assignments (questionId → themeIndex). Caller
// persists the result through pre-questions-service.applyClustering().
//
// System prompt lives in src/server/prompts/_base/op-cluster-questions.md and
// is loaded fresh per call (cached in-memory by the loader). Update the .md
// to change the prompt — no TypeScript edit required.
//
// Phase B will swap to Vaidix Core via the same shape — keep this module
// provider-agnostic at the seam.

import { geminiGenerate, tryParseJson, GeminiUnavailableError } from '@/server/services/ai/gemini';
import { loadPrompt } from '@/server/prompts/loader';

export interface ClusterInputQuestion {
  id: string;
  content: string;
  voteCount: number;
}

export interface ClusterOutputTheme {
  /** Index-based id used by `assignments` to reference this theme. */
  themeIndex: number;
  label: string;
  summary: string;
}

export interface ClusterOutput {
  themes: ClusterOutputTheme[];
  /** Per-question assignment to a theme (or null if unclassifiable). */
  assignments: Array<{ questionId: string; themeIndex: number | null }>;
}

interface RawCluster {
  themes?: Array<{ label?: string; summary?: string }>;
  assignments?: Array<{ questionId?: string; themeIndex?: number | null }>;
}

export async function clusterPreQuestions(
  questions: ClusterInputQuestion[]
): Promise<ClusterOutput> {
  if (questions.length === 0) return { themes: [], assignments: [] };

  // Compact prompt — only the fields the model needs.
  const userText = JSON.stringify(
    questions.map((q) => ({ id: q.id, content: q.content, votes: q.voteCount })),
    null,
    2
  );

  // System prompt is loaded from _base/op-cluster-questions.md; the loader
  // interpolates {{DOMAIN_*}} placeholders against the active domain config.
  const prompt = await loadPrompt('op-cluster-questions');

  let raw: string;
  try {
    raw = await geminiGenerate({
      systemInstruction: prompt.text,
      userParts: [{ text: userText }],
      responseMimeType: 'application/json',
      temperature: 0.2,
    });
  } catch (err) {
    if (err instanceof GeminiUnavailableError) throw err;
    throw err;
  }

  const parsed = tryParseJson<RawCluster>(raw);
  const themes: ClusterOutputTheme[] = (parsed.themes ?? [])
    .slice(0, 10)
    .map((t, i) => ({
      themeIndex: i,
      label: (t.label ?? 'Untitled theme').trim().slice(0, 80) || 'Untitled theme',
      summary: (t.summary ?? '').trim().slice(0, 600),
    }));

  const themeCount = themes.length;
  const assignments = (parsed.assignments ?? [])
    .filter((a): a is { questionId: string; themeIndex: number | null } => typeof a.questionId === 'string')
    .map((a) => ({
      questionId: a.questionId,
      themeIndex:
        a.themeIndex == null || a.themeIndex < 0 || a.themeIndex >= themeCount
          ? null
          : a.themeIndex,
    }));

  return { themes, assignments };
}
