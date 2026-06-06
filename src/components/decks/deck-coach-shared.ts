// Shared types for the deck-editor right-panel tabs (Analysis / Fixes / AI
// Slides / Hooks). Kept dependency-light so every panel can import it without
// pulling in the others.

export interface SlideForCoach {
  id: string;
  order: number;
}

/** Score → traffic-light text colour, shared by the Analysis score tiles. */
export function scoreTone(s: number): string {
  if (s >= 8) return 'text-emerald-600 dark:text-emerald-400';
  if (s >= 5) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}
