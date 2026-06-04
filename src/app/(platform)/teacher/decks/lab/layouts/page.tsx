// ════════════════════════════════════════════════════════════════════════════
// /teacher/decks/lab/layouts — Phase 1 UI mock route for the 5 proposed new
// SlideLayouts (Deck Forge v2 visual surface). No DB, no AI, no API — pure
// visual validation against ophthalmology pedagogy patterns. Sample data is
// drawn from Dr Pathengay's "Endophthalmitis: The First 48-Hour Decisions"
// faculty deck (the canonical use case driving v2).
//
// This route is internal — gated to faculty-like roles so it never appears in
// the resident-facing nav. Once Phase 2 (renderer) + Phase 3 (schema + AI)
// land, the lab is retained as a per-component visual regression surface.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Role } from '@prisma/client';
import { ComparisonPanelSlide } from '@/components/decks/layouts/comparison-panel';
import { CalloutBandSlide } from '@/components/decks/layouts/callout-band';
import { TrafficLightGridSlide } from '@/components/decks/layouts/traffic-light-grid';
import { CardStackSlide } from '@/components/decks/layouts/card-stack';
import { TimelineStripSlide } from '@/components/decks/layouts/timeline-strip';
import type {
  ComparisonPanelData,
  CalloutBandData,
  TrafficLightGridData,
  CardStackData,
  TimelineStripData,
} from '@/components/decks/layouts/types';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

// ── Sample data drawn from Dr Pathengay's endophthalmitis deck ─────────────

const DECK_TITLE = 'Endophthalmitis: The First 48-Hour Decisions';

const comparisonSample: ComparisonPanelData = {
  left: {
    label: 'TASS',
    tone: 'positive',
    items: [
      'CLEAR vitreous on B-scan',
      'No membranous echoes',
      'Fibrinous AC reaction',
      'Hypopyon can be present',
    ],
  },
  right: {
    label: 'Endophthalmitis',
    tone: 'negative',
    items: [
      'MEMBRANOUS echoes on B-scan',
      'Dense vitritis',
      'Ring infiltrate',
      'Progression at 12–24 h',
    ],
  },
  caption:
    'B-scan is the disambiguator — clear vitreous rules in TASS, membranous echoes rule in endophthalmitis.',
};

const calloutSample: CalloutBandData = {
  prelude: 'CORE MESSAGE',
  statement:
    'The constellation drives the decision — never a single sign, never the vision chart.',
  attribution: 'EMS Investigators · 2025',
};

const trafficLightSample: TrafficLightGridData = {
  rowLabels: ['Cornea', 'Ant. chamber', 'Iris', 'Vitreous'],
  colLabels: ['0', '1', '2', '3', '4'],
  cells: [
    [
      'Crystal clear',
      'Trace haze · iris visible',
      'Moderate oedema · iris blurred',
      'Dense oedema · AC hard to view',
      'Opaque · AC not assessable',
    ],
    [
      'Clear · no cells',
      'Few cells · no hypopyon',
      'Cells +++ · hypopyon <1 mm',
      'Dense cells · hypopyon 1–2 mm',
      'Fibrinous · hypopyon >2 mm',
    ],
    [
      'Normal · detail crisp',
      'Mild congestion',
      'Engorged vessels · rubeosis',
      'Loss of detail · membranes',
      'Iris not visualisable',
    ],
    [
      'Clear · disc crisp',
      'Mild haze · disc visible',
      'Moderate haze · vessels blurred',
      'Dense haze · disc not seen',
      'No view · no red reflex',
    ],
  ],
  tones: [
    ['positive', 'positive', 'caution', 'negative', 'critical'],
    ['positive', 'positive', 'caution', 'negative', 'critical'],
    ['positive', 'positive', 'caution', 'negative', 'critical'],
    ['positive', 'positive', 'caution', 'negative', 'critical'],
  ],
  decisionLine:
    'IS < 10 → Vitreous biopsy + IOAB     ·     IS ≥ 10 → PPV     ·     RD on B-scan or no view → PPV regardless',
};

const cardStackSample: CardStackData = {
  cards: [
    {
      name: 'Vancomycin',
      dose: '1.0 mg / 0.1 mL',
      coverage: { label: 'GPC', percent: 97 },
      badge: { text: 'Gold standard', tone: 'positive' },
      rule: 'Always include — backbone of empiric cover',
    },
    {
      name: 'Colistin',
      dose: '1000 IU / 0.1 mL',
      coverage: { label: 'GNB', percent: 89 },
      badge: { text: 'New first-line', tone: 'positive' },
      rule: 'Replaces ceftazidime · covers MDR GNB',
    },
    {
      name: 'Ceftazidime',
      dose: '2.25 mg / 0.1 mL',
      coverage: { label: 'GNB', percent: 60 },
      badge: { text: 'Reserve', tone: 'caution' },
      rule: 'Only when colistin-resistant',
    },
    {
      name: 'Voriconazole',
      dose: '100 µg / 0.1 mL',
      badge: { text: 'Fungi first-line', tone: 'caution' },
      rule: 'ABSOLUTE CI: never give with dexamethasone',
    },
    {
      name: 'Imipenem',
      dose: '0.5 mg / 0.1 mL',
      badge: { text: 'Removed', tone: 'negative' },
      rule: 'EMS pulled mid-trial — replaced by colistin',
    },
  ],
};

const timelineSample: TimelineStripData = {
  phases: [
    { marker: '0 h', label: 'Diagnose', detail: 'Score IS · constellation check', tone: 'neutral' },
    { marker: '1–2 h', label: 'Empiric IOAB', detail: 'Vanco + Colistin', tone: 'caution' },
    { marker: '12–24 h', label: 'First reassessment', detail: 'Hypopyon · vitritis · ring infiltrate', tone: 'caution' },
    { marker: '24–48 h', label: 'Persistence vs Recurrence', detail: 'Re-inject on SIGNS', tone: 'critical' },
    { marker: 'Day 3', label: 'Culture-guided', detail: 'Escalate · narrow · explant', tone: 'positive' },
  ],
};

// ── Slide registry — single source of truth for the lab grid ────────────────

const SLIDES = [
  {
    key: 'comparison',
    title: 'TASS vs Endophthalmitis — read the B-scan',
    description: 'COMPARISON_PANEL — side-by-side teaching, tone-coded for "rule-in" vs "rule-out".',
    render: (index: number, total: number) => (
      <ComparisonPanelSlide
        deckTitle={DECK_TITLE}
        title="TASS vs Endophthalmitis — read the B-scan"
        index={index}
        total={total}
        data={comparisonSample}
      />
    ),
  },
  {
    key: 'callout',
    title: 'Core message',
    description: 'CALLOUT_BAND — single high-signal sentence; the core message slide that repeats.',
    render: (index: number, total: number) => (
      <CalloutBandSlide
        deckTitle={DECK_TITLE}
        title="Core message"
        index={index}
        total={total}
        data={calloutSample}
      />
    ),
  },
  {
    key: 'traffic-light',
    title: 'EMS Inflammatory Score — score the eye',
    description: 'TRAFFIC_LIGHT_GRID — NxM colour-coded rubric; anchor for IS scoring.',
    render: (index: number, total: number) => (
      <TrafficLightGridSlide
        deckTitle={DECK_TITLE}
        title="EMS Inflammatory Score — CAIV × 0-4"
        index={index}
        total={total}
        data={trafficLightSample}
      />
    ),
  },
  {
    key: 'card-stack',
    title: 'Empiric intravitreal antibiotics — the two drugs',
    description: 'CARD_STACK — stacked drug cards with dose, coverage bar, badge, rule.',
    render: (index: number, total: number) => (
      <CardStackSlide
        deckTitle={DECK_TITLE}
        title="Empiric intravitreal antibiotics — what changed in 2025"
        index={index}
        total={total}
        data={cardStackSample}
      />
    ),
  },
  {
    key: 'timeline',
    title: 'First 48 hours — the decision rhythm',
    description: 'TIMELINE_STRIP — left-to-right phases, tone-coded escalation.',
    render: (index: number, total: number) => (
      <TimelineStripSlide
        deckTitle={DECK_TITLE}
        title="First 48 hours — the decision rhythm"
        index={index}
        total={total}
        data={timelineSample}
      />
    ),
  },
];

export default async function LayoutLabPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/teacher/decks/lab/layouts');
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const total = SLIDES.length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
          Phase 1 · UI mock · not yet wired into Forge or Studio
        </p>
        <h1 className="mb-3 text-3xl font-bold text-white">Deck Forge v2 — new layouts</h1>
        <p className="text-base text-white/70">
          Five new <code className="rounded bg-white/10 px-1 py-0.5 text-xs">SlideLayout</code> values
          proposed to close the gap between Deck Forge output and Doc 4.1.1 (Smart Presentation
          Enhancement) pedagogy. Sample data is drawn from Dr Pathengay&rsquo;s endophthalmitis deck so
          you can sanity-check pedagogy fit, density, and visual hierarchy against the real
          use-case before any DB / AI / renderer changes ship.
        </p>
      </header>

      <ul className="grid gap-12" data-testid="layout-sections">
        {SLIDES.map((s, i) => (
          <li key={s.key} className="grid gap-3" data-testid="layout-section">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-semibold text-white">{s.title}</h2>
              <span className="font-mono text-xs uppercase tracking-wider text-white/40">
                {String(i + 1).padStart(2, '0')} / {String(total).padStart(2, '0')} ·{' '}
                {s.key.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-white/60">{s.description}</p>
            <div>{s.render(i, total)}</div>
          </li>
        ))}
      </ul>

      <footer className="mt-12 rounded-lg border border-white/10 bg-white/5 p-6 text-sm text-white/70">
        <p className="mb-2 font-bold text-white">Next steps once these are signed off:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Phase 2 — port these five renderers into{' '}
            <code className="rounded bg-white/10 px-1 text-xs">deck-pptx-renderer.ts</code> so the
            .pptx export matches pixel-for-pixel.
          </li>
          <li>
            Phase 3 — Prisma migration to extend{' '}
            <code className="rounded bg-white/10 px-1 text-xs">SlideLayout</code> enum and add
            <code className="rounded bg-white/10 px-1 text-xs">layoutData Json?</code>; update the
            three system prompts (forge / wizard-forge / refine) to teach Opus when to pick each.
          </li>
          <li>
            Phase 4 — Studio editor surfaces for editing{' '}
            <code className="rounded bg-white/10 px-1 text-xs">layoutData</code> per slide.
          </li>
          <li>
            Phase 5 — <code className="rounded bg-white/10 px-1 text-xs">scripts/e2e-deck-layouts-v2.ts</code>{' '}
            + Playwright UI test exercising all five layouts end-to-end.
          </li>
          <li>
            Phase 6 — single new entry in the project roadmap
            committed in the same turn as the Phase 3 API/DB changes.
          </li>
        </ol>
      </footer>
    </div>
  );
}
