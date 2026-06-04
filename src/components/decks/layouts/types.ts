// Phase 1 UI mocks for 5 new slide layouts proposed for Deck Forge v2.
// These types are the eventual shape of `Slide.layoutData: Json?` once the
// Prisma migration lands in Phase 3. Keeping them here, decoupled from
// @prisma/client, so the lab page renders without any DB or AI surface change.
// When the migration lands, the discriminated union below becomes the source
// of truth that the prompt + normalizer + renderer all read.

export type LayoutTone = 'positive' | 'negative' | 'neutral' | 'caution' | 'critical';

// ── COMPARISON_PANEL ────────────────────────────────────────────────────────
// Side-by-side teaching pattern: normal vs abnormal, mild vs severe, look-alike
// differentials, pre vs post. Each side has its own label, tone (drives the
// colour strip), and a short list of items. Tone defaults: left=neutral,
// right=neutral; ophthalmology decks frequently use positive/negative pairings
// (e.g. TASS vs Endophthalmitis on B-scan).
export interface ComparisonPanelData {
  left: { label: string; items: string[]; tone?: LayoutTone };
  right: { label: string; items: string[]; tone?: LayoutTone };
  caption?: string;
}

// ── CALLOUT_BAND ────────────────────────────────────────────────────────────
// One high-signal sentence rendered large. Used for core-message callbacks,
// myth-busters, contrast hooks, "the rule." Optional prelude is a small
// uppercase label above the statement (e.g. "MYTH-BUSTER", "CORE MESSAGE",
// "THE RULE"). Attribution is a small trailing line (e.g. "— EMS 2025").
export interface CalloutBandData {
  prelude?: string;
  statement: string;
  attribution?: string;
}

// ── TRAFFIC_LIGHT_GRID ──────────────────────────────────────────────────────
// NxM colour-coded matrix. Anchor visual for scoring rubrics like EMS IS:
// rows = dimensions (Cornea / AC / Iris / Vitreous), cols = severity grades
// (0..4). Cells hold the cell descriptor (short text). Tones drive the cell
// background colour. Decision line is an optional rule rendered below the
// grid ("IS <10 → biopsy + IOAB · IS ≥10 → PPV").
export interface TrafficLightGridData {
  rowLabels: string[];
  colLabels: string[];
  cells: string[][];
  tones: LayoutTone[][];
  decisionLine?: string;
}

// ── CARD_STACK ──────────────────────────────────────────────────────────────
// Stacked cards each with a header + monospace dose strip + coverage bar + a
// 1-line usage rule. Designed for drug comparisons, classifications, OR
// staging tables that read better as cards than as a row-wise table.
export interface CardStackData {
  cards: Array<{
    name: string;
    dose?: string;
    badge?: { text: string; tone: LayoutTone };
    coverage?: { label: string; percent: number };
    rule?: string;
  }>;
}

// ── TIMELINE_STRIP ──────────────────────────────────────────────────────────
// Left-to-right phase strip. Used for "first 48 hours" sequences, pre-op →
// intra-op → post-op flows, day-1 / day-3 / week-1 follow-up rhythms. Each
// phase has a short marker ("0h", "24h", "48h", "Day 3"), a label, and an
// optional sub-detail.
export interface TimelineStripData {
  phases: Array<{
    marker: string;
    label: string;
    detail?: string;
    tone?: LayoutTone;
  }>;
}

// ── Discriminated union ─────────────────────────────────────────────────────
// Used by the renderer + Studio editor to dispatch on layout.
export type NewSlideLayout =
  | { layout: 'COMPARISON_PANEL'; data: ComparisonPanelData }
  | { layout: 'CALLOUT_BAND'; data: CalloutBandData }
  | { layout: 'TRAFFIC_LIGHT_GRID'; data: TrafficLightGridData }
  | { layout: 'CARD_STACK'; data: CardStackData }
  | { layout: 'TIMELINE_STRIP'; data: TimelineStripData };

export type NewSlideLayoutName = NewSlideLayout['layout'];

// ── Shell props shared by all 5 preview components ──────────────────────────
// Mirrors the chrome from SlideCanvas — deck title, slide index/total, theme,
// accent. Defined here (not imported from @prisma/client) so the lab renders
// before the migration lands.
export interface NewLayoutShellProps {
  deckTitle: string;
  title: string;
  index: number;
  total: number;
  themeId?: string;
  accentHex?: string | null;
  /** preview = inside an editor card; present = fullscreen */
  mode?: 'preview' | 'present';
}
