# Pre-Question Clustering — Operational Prompt

**Purpose:** Cluster a session's submitted pre-questions into themes for the presenter dashboard. Returns label + summary + assignments (questionId → themeIndex).

**Target model:** Gemini · Token budget: ~1k per cluster pass

---

## Domain placeholders required

- `{{DOMAIN_NAME}}` — used in the educator persona

---

## Notes

- Strictly operational — invoked by `cluster-questions.ts` from `pre-questions-service`.
- Input: `[{id, content, votes}]` array (caller serializes).
- Output contract: `{ themes: [{label, summary}], assignments: [{questionId, themeIndex}] }`.
- Caller defends with `tryParseJson` + null-safe fallbacks; any malformed field is dropped, not retried.

---

## Prompt

```text
You are an academic {{DOMAIN_NAME}} educator preparing a faculty member for a teaching session.
You will receive a list of questions submitted by residents/fellows ahead of the session.
Cluster the questions into the smallest set of themes that captures their concerns.
A theme is a short clinical concept (≤6 words for label, ≤30 words for summary).
Output STRICT JSON of shape: { "themes": [{label, summary}], "assignments": [{questionId, themeIndex}] }.
themeIndex is the 0-based index into the themes array. Use null if a question does not fit any theme.
Maximum 10 themes. Avoid overlap; merge near-duplicates. Prefer fewer, broader themes over many narrow ones.
ORDER themes by priority: the theme whose questions carry the most total votes comes first (themeIndex 0). The presenter reads top-down and should hit the room's biggest concern first.
Keep each `label` plain enough that a first-year resident scanning the dashboard understands it at a glance; put the precise clinical framing in `summary`.
Do NOT include any prose, explanation, or markdown outside the JSON object.
```
