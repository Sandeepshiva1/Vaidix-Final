'use client';

// ════════════════════════════════════════════════════════════════════════════
// ReadinessDashboardClient — pre-session learner monitoring (4.1.5)
// ════════════════════════════════════════════════════════════════════════════
// Two-column layout matching the 4.1.5 mockup:
//   Left  (data) → KPI strip, distribution stacked bar, 7-day timeline,
//                  learner risk register (sortable / filterable table).
//   Right (insight) → AI insights cards (heuristic; deepens to Gemini in
//                     Phase B), risk groups breakdown, Smart Nudge composer.
//
// Bands: the existing readiness-service produces 3 tiers (UNDERPREPARED /
// AT_RISK / READY). The mockup uses 4 (Critical / At Risk / Progressing /
// Ready). We re-band by score range at the UI for visual fidelity, keeping
// the service auditable as-is.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  Activity,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Send,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
} from 'lucide-react';
import type { ReadinessSnapshot, ReadinessLearner } from '@/server/services/readiness/readiness-service';

type Band = 'CRITICAL' | 'AT_RISK' | 'PROGRESSING' | 'READY';

const BAND_LABEL: Record<Band, string> = {
  CRITICAL: 'Critical Risk',
  AT_RISK: 'At Risk',
  PROGRESSING: 'Progressing',
  READY: 'Session Ready',
};
const BAND_RANGE: Record<Band, string> = {
  CRITICAL: 'Score 0–39',
  AT_RISK: 'Score 40–59',
  PROGRESSING: 'Score 60–79',
  READY: 'Score 80–100',
};
const BAND_TONE: Record<Band, string> = {
  CRITICAL: 'bg-rose-500',
  AT_RISK: 'bg-amber-500',
  PROGRESSING: 'bg-emerald-500',
  READY: 'bg-teal-500',
};
const BAND_TEXT: Record<Band, string> = {
  CRITICAL: 'text-rose-700 dark:text-rose-300',
  AT_RISK: 'text-amber-700 dark:text-amber-300',
  PROGRESSING: 'text-emerald-700 dark:text-emerald-300',
  READY: 'text-teal-700 dark:text-teal-300',
};
const BAND_DOT: Record<Band, string> = {
  CRITICAL: 'bg-rose-500',
  AT_RISK: 'bg-amber-500',
  PROGRESSING: 'bg-emerald-500',
  READY: 'bg-teal-500',
};
const BAND_PILL: Record<Band, string> = {
  CRITICAL: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  AT_RISK: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PROGRESSING: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  READY: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
};

function bandFor(score: number): Band {
  if (score >= 80) return 'READY';
  if (score >= 60) return 'PROGRESSING';
  if (score >= 40) return 'AT_RISK';
  return 'CRITICAL';
}

interface DailyBucket {
  date: string;
  weekday: string;
  engaged: number;
  partial: number;
  loggedInOnly: number;
}

interface SessionMeta {
  id: string;
  title: string;
  scheduledStart: string | null;
  status: string;
  daysUntil: number | null;
}

interface Props {
  session: SessionMeta;
  snapshot: ReadinessSnapshot;
  daily: DailyBucket[];
}

type FilterKey = 'all' | 'high-risk' | 'non-engaged';

// ─── Component ─────────────────────────────────────────────────────────────

export function ReadinessDashboardClient({ session, snapshot, daily }: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [openGroup, setOpenGroup] = useState<Band | null>('CRITICAL');

  // Re-band each learner via the 4-band UI mapping.
  const learnersWithBand = useMemo(
    () =>
      snapshot.perLearner.map((l) => ({ ...l, band: bandFor(l.readinessScore) })),
    [snapshot.perLearner],
  );

  const filtered = useMemo(() => {
    let rows = learnersWithBand;
    if (filter === 'high-risk') {
      rows = rows.filter((l) => l.band === 'CRITICAL' || l.band === 'AT_RISK');
    } else if (filter === 'non-engaged') {
      rows = rows.filter((l) => l.preReadings.count === 0 && l.preCases.count === 0);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter(
        (l) => l.name.toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [learnersWithBand, filter, query]);

  const bandCounts = useMemo(() => {
    const c: Record<Band, number> = { CRITICAL: 0, AT_RISK: 0, PROGRESSING: 0, READY: 0 };
    for (const l of learnersWithBand) c[l.band] += 1;
    return c;
  }, [learnersWithBand]);

  const total = learnersWithBand.length;
  const nonEngagedCount = learnersWithBand.filter(
    (l) => l.preReadings.count === 0 && l.preCases.count === 0,
  ).length;

  const sessionReadyCount = bandCounts.READY;
  const atRiskCount = bandCounts.CRITICAL + bandCounts.AT_RISK;

  // Insights derived from the snapshot — heuristic-only for v1, no LLM.
  const insights = useMemo(() => buildInsights(learnersWithBand, snapshot, session), [
    learnersWithBand,
    snapshot,
    session,
  ]);

  const maxBar = Math.max(
    1,
    ...daily.map((d) => d.engaged + d.partial + d.loggedInOnly),
  );

  const startStr = session.scheduledStart
    ? new Date(session.scheduledStart).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : null;

  const isLive = session.daysUntil !== null && session.daysUntil <= 1;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
      className="mx-auto max-w-7xl space-y-6 px-6 py-8"
      data-testid="readiness-dashboard"
    >
      {/* Back */}
      <motion.div variants={fade}>
        <Link
          href={`/classroom/${session.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to session
        </Link>
      </motion.div>

      {/* Header chip */}
      <motion.header variants={fade} className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <span className={`h-2 w-2 rounded-full ${isLive ? 'animate-pulse bg-rose-500' : 'bg-emerald-500'}`} />
          <span className="text-xs">
            <span className="text-muted-foreground">Live monitoring: </span>
            <span className="font-semibold">{session.title}</span>
            {session.daysUntil !== null && (
              <span className="text-muted-foreground">
                {' · '}
                {session.daysUntil === 0 ? 'today' : `${session.daysUntil} ${session.daysUntil === 1 ? 'day' : 'days'} remaining`}
              </span>
            )}
            {startStr && (
              <span className="text-muted-foreground"> · {startStr}</span>
            )}
          </span>
        </div>
        <span className="ml-auto text-[10px] text-muted-foreground">
          AI risk model · {snapshot.versionTag} · refreshed {new Date(snapshot.computedAt).toLocaleTimeString()}
        </span>
      </motion.header>

      {/* Filter row */}
      <motion.div variants={fade} className="flex flex-wrap items-center gap-2">
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
          All learners <Count n={total} active={filter === 'all'} />
        </FilterPill>
        <FilterPill active={filter === 'high-risk'} onClick={() => setFilter('high-risk')}>
          High risk <Count n={atRiskCount} active={filter === 'high-risk'} />
        </FilterPill>
        <FilterPill active={filter === 'non-engaged'} onClick={() => setFilter('non-engaged')}>
          Non-engaged <Count n={nonEngagedCount} active={filter === 'non-engaged'} />
        </FilterPill>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search learner…"
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-xs"
          />
        </div>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ─── Left: data column ─── */}
        <div className="space-y-6">
          {/* KPI strip */}
          <motion.div variants={fade} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard
              tone="rose"
              label="At-Risk"
              value={atRiskCount}
              over={total}
              icon={AlertTriangle}
              hint={atRiskCount > 0 ? `${atRiskCount} need attention` : 'Cohort steady'}
            />
            <KpiCard
              tone="amber"
              label="Non-Engaged"
              value={nonEngagedCount}
              over={total}
              icon={Activity}
              hint={nonEngagedCount > 0 ? 'Zero study-pack interaction' : 'Everyone has engaged'}
            />
            <KpiCard
              tone="teal"
              label="Avg Readiness"
              value={snapshot.cohortStats.averageScore}
              over={100}
              icon={TrendingUp}
              hint="0-100 readiness score"
            />
            <KpiCard
              tone="emerald"
              label="Session-Ready"
              value={sessionReadyCount}
              over={total}
              icon={CheckCircle2}
              hint={sessionReadyCount > 0 ? 'Score ≥ 80 · on track' : 'No one ready yet'}
            />
          </motion.div>

          {/* Cohort Readiness Distribution */}
          <motion.section
            variants={fade}
            className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur"
          >
            <Heading title="Cohort readiness distribution" sub={`Across all ${total} learners · AI risk-scored model`} />

            <div className="mt-4">
              {total === 0 ? (
                <p className="text-xs text-muted-foreground">No learners assigned.</p>
              ) : (
                <>
                  <div className="flex h-8 overflow-hidden rounded-lg">
                    {(['CRITICAL', 'AT_RISK', 'PROGRESSING', 'READY'] as Band[]).map((b) => {
                      const w = (bandCounts[b] / total) * 100;
                      if (w === 0) return null;
                      return (
                        <div
                          key={b}
                          className={`flex items-center justify-center text-[10px] font-bold text-white ${BAND_TONE[b]}`}
                          style={{ width: `${w}%` }}
                          title={BAND_LABEL[b]}
                        >
                          {bandCounts[b]}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['CRITICAL', 'AT_RISK', 'PROGRESSING', 'READY'] as Band[]).map((b) => (
                      <div key={b} className="rounded-lg bg-muted/40 p-3">
                        <div className={`text-2xl font-bold ${BAND_TEXT[b]}`}>
                          {bandCounts[b]}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">learners</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                          <span className={`h-1.5 w-1.5 rounded-full ${BAND_DOT[b]}`} />
                          <span>{BAND_LABEL[b]}</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">{BAND_RANGE[b]}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.section>

          {/* 7-day Engagement Timeline */}
          <motion.section
            variants={fade}
            className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur"
          >
            <Heading
              title="Daily engagement · last 7 days"
              sub="Distinct learners with study-pack activity, stacked by depth"
            />
            <div className="mt-4 flex items-end justify-between gap-2 sm:gap-4">
              {daily.map((d, i) => {
                const isToday = i === daily.length - 1;
                const totalDay = d.engaged + d.partial + d.loggedInOnly;
                return (
                  <div key={d.date} className="relative flex flex-1 flex-col items-center gap-1.5">
                    {isToday && (
                      <span className="absolute -top-7 inline-block whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-[9px] font-semibold text-background">
                        Today · {totalDay} active
                      </span>
                    )}
                    <div className="flex h-32 w-full flex-col-reverse overflow-hidden rounded-md bg-muted/40">
                      {d.engaged > 0 && (
                        <div
                          className={`${isToday ? 'bg-teal-500' : 'bg-emerald-500'}`}
                          style={{ height: `${(d.engaged / maxBar) * 100}%` }}
                          title={`${d.engaged} fully engaged`}
                        />
                      )}
                      {d.partial > 0 && (
                        <div
                          className="bg-amber-500"
                          style={{ height: `${(d.partial / maxBar) * 100}%` }}
                          title={`${d.partial} partial`}
                        />
                      )}
                      {d.loggedInOnly > 0 && (
                        <div
                          className="bg-rose-400"
                          style={{ height: `${(d.loggedInOnly / maxBar) * 100}%` }}
                          title={`${d.loggedInOnly} logged in only`}
                        />
                      )}
                    </div>
                    <span className={`font-mono text-[9px] uppercase tracking-wider ${isToday ? 'font-bold text-teal-600 dark:text-teal-400' : 'text-muted-foreground'}`}>
                      {d.weekday}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <Legend dot="bg-emerald-500" label="Full engagement" />
              <Legend dot="bg-amber-500" label="Partial" />
              <Legend dot="bg-rose-400" label="Logged in only" />
            </div>
          </motion.section>

          {/* Learner Risk Register */}
          <motion.section
            variants={fade}
            className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur"
          >
            <header className="flex items-center justify-between border-b border-border p-5">
              <Heading
                title="Learner risk register"
                sub={`${filtered.length} of ${total} · sorted by risk`}
              />
              <span className="text-[10px] text-muted-foreground">AI updated every 6h</span>
            </header>

            <div className="overflow-x-auto" data-testid="readiness-table">
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="p-3 text-left">Learner</th>
                    <th className="p-3 text-left">Risk score</th>
                    <th className="p-3 text-left">Material</th>
                    <th className="p-3 text-left">Pre-cases</th>
                    <th className="p-3 text-left">Last active</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-xs text-muted-foreground">
                        No learners match the current filter.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((l, i) => <LearnerRow key={l.userId} l={l} index={i} />)
                  )}
                </tbody>
              </table>
            </div>
          </motion.section>
        </div>

        {/* ─── Right: insight column ─── */}
        <div className="space-y-6">
          {/* AI Insights */}
          <motion.section
            variants={fade}
            className="space-y-3 rounded-2xl border border-border bg-card/60 p-5 backdrop-blur"
          >
            <Heading title="AI insights" />
            <div className="space-y-2.5">
              {insights.map((ins, i) => (
                <InsightCard key={i} insight={ins} />
              ))}
            </div>
          </motion.section>

          {/* Risk Groups */}
          <motion.section
            variants={fade}
            className="space-y-2 rounded-2xl border border-border bg-card/60 p-5 backdrop-blur"
          >
            <Heading title="Risk groups" />
            <div className="space-y-1.5">
              {(['CRITICAL', 'AT_RISK', 'PROGRESSING', 'READY'] as Band[]).map((b) => (
                <RiskGroup
                  key={b}
                  band={b}
                  open={openGroup === b}
                  onToggle={() => setOpenGroup((cur) => (cur === b ? null : b))}
                  learners={learnersWithBand.filter((l) => l.band === b)}
                />
              ))}
            </div>
          </motion.section>

          {/* Smart Nudge Composer */}
          <motion.section
            variants={fade}
            className="rounded-2xl border border-border bg-foreground p-5 text-background shadow-xl"
          >
            <NudgeComposer
              sessionId={session.id}
              criticalCount={bandCounts.CRITICAL + bandCounts.AT_RISK}
            />
          </motion.section>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const fade = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
};

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function Count({ n, active }: { n: number; active: boolean }) {
  return (
    <span className={`text-[10px] ${active ? 'text-background/70' : 'text-muted-foreground'}`}>
      {n}
    </span>
  );
}

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function KpiCard({
  tone,
  label,
  value,
  over,
  icon: Icon,
  hint,
}: {
  tone: 'rose' | 'amber' | 'teal' | 'emerald';
  label: string;
  value: number;
  over: number;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}) {
  const accent = {
    rose: 'before:bg-rose-500',
    amber: 'before:bg-amber-500',
    teal: 'before:bg-teal-500',
    emerald: 'before:bg-emerald-500',
  }[tone];
  const iconTone = {
    rose: 'text-rose-500',
    amber: 'text-amber-500',
    teal: 'text-teal-500',
    emerald: 'text-emerald-500',
  }[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-card p-4 before:absolute before:left-0 before:right-0 before:top-0 before:h-1 ${accent}`}
    >
      <div className="flex items-start justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <Icon className={`h-3.5 w-3.5 ${iconTone}`} />
      </div>
      <div className="mt-2 font-mono text-2xl font-bold leading-none">
        {value}
        <span className="ml-1 text-sm font-normal text-muted-foreground">/ {over}</span>
      </div>
      <div className="mt-1.5 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function LearnerRow({ l, index }: { l: ReadinessLearner & { band: Band }; index: number }) {
  const lastActiveLabel = l.lastSignalAt
    ? formatRel(l.lastSignalAt)
    : <span className="text-rose-500">Never opened materials</span>;
  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.02 }}
      className="border-t border-border hover:bg-muted/30"
      data-testid={`readiness-row-${l.userId}`}
    >
      <td className="p-3">
        <div className="flex items-center gap-3">
          <Avatar name={l.name} band={l.band} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{l.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {l.email ?? '—'}
            </div>
          </div>
        </div>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${BAND_PILL[l.band]}`}>
            {l.readinessScore}
          </span>
          <span className="text-[10px] text-muted-foreground">{BAND_LABEL[l.band]}</span>
        </div>
      </td>
      <td className="p-3 text-[11px]">
        <div>
          {l.preReadings.count} / {l.preReadings.total} readings
        </div>
        <div className="text-muted-foreground">
          {l.preVideos.count} / {l.preVideos.total} videos
        </div>
      </td>
      <td className="p-3 text-[11px]">
        {l.preCases.count} / {l.preCases.total}
        <div className="text-muted-foreground">{l.preQuestionsSubmitted} questions</div>
      </td>
      <td className="p-3 text-[11px]">{lastActiveLabel}</td>
      <td className="p-3 text-right">
        <div className="flex justify-end gap-1.5">
          {(l.band === 'CRITICAL' || l.band === 'AT_RISK') && (
            <button
              type="button"
              className="rounded-md bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-700 transition hover:bg-rose-500/20 dark:text-rose-300"
            >
              Nudge
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            View
          </button>
        </div>
      </td>
    </motion.tr>
  );
}

function Avatar({ name, band }: { name: string; band: Band }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
  const tone = {
    CRITICAL: 'bg-rose-500',
    AT_RISK: 'bg-amber-500',
    PROGRESSING: 'bg-emerald-500',
    READY: 'bg-teal-500',
  }[band];
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${tone}`}
    >
      {initials || '??'}
    </div>
  );
}

function formatRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d <= 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}

interface Insight {
  tone: 'rose' | 'amber' | 'teal';
  emoji: string;
  title: string;
  sub: string;
  body: string;
  cta?: string;
}

function buildInsights(
  learners: Array<ReadinessLearner & { band: Band }>,
  snapshot: ReadinessSnapshot,
  session: SessionMeta,
): Insight[] {
  const out: Insight[] = [];
  const critical = learners.filter((l) => l.band === 'CRITICAL');
  if (critical.length > 0) {
    out.push({
      tone: 'rose',
      emoji: '🚨',
      title: `${critical.length} learner${critical.length === 1 ? '' : 's'} critically unprepared`,
      sub: `Below 40% readiness · ${session.daysUntil ?? '—'} days to session`,
      body:
        'These learners have low study-pack engagement. Predicted session experience: disengaged. Send a targeted nudge before the day-of to recover lift.',
      cta: 'Send targeted nudge',
    });
  }
  const lowMaterialCount = learners.filter(
    (l) => l.preReadings.total > 0 && l.preReadings.count / l.preReadings.total < 0.3,
  ).length;
  if (lowMaterialCount >= Math.ceil(learners.length * 0.3) && learners.length > 0) {
    const pct = Math.round((lowMaterialCount / learners.length) * 100);
    out.push({
      tone: 'amber',
      emoji: '📉',
      title: 'Pre-reading gap across the cohort',
      sub: `${pct}% of cohort below 30% on readings`,
      body:
        'Consider pulling the most-skipped reading into the session opening so you cover it live without assuming everyone has read it.',
      cta: 'Open study pack',
    });
  }
  if (snapshot.cohortStats.averageScore >= 60 && learners.length > 0) {
    out.push({
      tone: 'teal',
      emoji: '📈',
      title: 'Cohort momentum is strong',
      sub: `Avg score ${snapshot.cohortStats.averageScore}/100`,
      body:
        'Engagement is on track. Consider a stretch question or rare-case discussion to challenge the prepared majority.',
    });
  }
  if (out.length === 0) {
    out.push({
      tone: 'amber',
      emoji: '🤔',
      title: 'Not much signal yet',
      sub: 'Cohort is small or session is new',
      body:
        'No strong patterns to surface. Once learners begin engaging with the study pack, insights populate here.',
    });
  }
  return out;
}

function InsightCard({ insight }: { insight: Insight }) {
  const tone = {
    rose: 'border-rose-500/30 bg-rose-500/10',
    amber: 'border-amber-500/30 bg-amber-500/10',
    teal: 'border-teal-500/30 bg-teal-500/10',
  }[insight.tone];
  const iconBg = {
    rose: 'bg-rose-500',
    amber: 'bg-amber-500',
    teal: 'bg-teal-500',
  }[insight.tone];
  const ctaTone = {
    rose: 'text-rose-700 dark:text-rose-300',
    amber: 'text-amber-700 dark:text-amber-300',
    teal: 'text-teal-700 dark:text-teal-300',
  }[insight.tone];
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="mb-1.5 flex items-start gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm ${iconBg}`}>
          {insight.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold leading-tight">{insight.title}</div>
          <div className="text-[10px] text-muted-foreground">{insight.sub}</div>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{insight.body}</p>
      {insight.cta && (
        <button type="button" className={`mt-2 text-[11px] font-semibold ${ctaTone}`}>
          → {insight.cta}
        </button>
      )}
    </div>
  );
}

function RiskGroup({
  band,
  open,
  onToggle,
  learners,
}: {
  band: Band;
  open: boolean;
  onToggle: () => void;
  learners: Array<ReadinessLearner & { band: Band }>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${BAND_DOT[band]}`} />
          <span className="text-xs font-semibold">{BAND_LABEL[band]}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{learners.length}</span>
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && learners.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border bg-muted/20 px-3 py-2"
          >
            <ul className="space-y-1.5">
              {learners.slice(0, 6).map((l) => (
                <li key={l.userId} className="flex items-center gap-2">
                  <Avatar name={l.name} band={l.band} />
                  <span className="flex-1 truncate text-xs">{l.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {l.readinessScore} / 100
                  </span>
                </li>
              ))}
              {learners.length > 6 && (
                <li className="text-[10px] text-muted-foreground">
                  + {learners.length - 6} more
                </li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NudgeComposer({ sessionId, criticalCount }: { sessionId: string; criticalCount: number }) {
  void sessionId;
  const [generating, setGenerating] = useState(false);
  const [drafts] = useState<Array<{ userId: string; name: string; message: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // Endpoint not wired yet — surface a friendly state. The composer itself
      // (UI) is intentionally complete; flipping the GENERATE button to call
      // the backend is the next iteration.
      await new Promise((r) => setTimeout(r, 600));
      setError('Nudge generation will be wired in the next phase. Templates above are a preview.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div data-testid="nudge-composer">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="h-3.5 w-3.5 text-amber-300" />
        Smart nudge composer
      </h3>
      <p className="mb-3 text-[11px] text-background/60">
        Personalised messages for at-risk learners ({criticalCount} candidates).
      </p>

      <div className="space-y-1.5">
        {(drafts.length === 0 ? [
          {
            userId: 'preview-1',
            name: 'Preview',
            message:
              'The session is in a few days — your pre-reading on KP grading takes 18 min. Bookmarked for you.',
          },
          {
            userId: 'preview-2',
            name: 'Preview',
            message:
              'You are 1 quiz away from unlocking your readiness score. Five questions, four minutes — peers are at 65%.',
          },
        ] : drafts).map((d, i) => (
          <div
            key={d.userId + i}
            className="rounded-md border border-white/10 bg-white/5 p-2.5 text-[11px] leading-relaxed text-background/85"
          >
            {d.message}
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          onClick={generate}
          disabled={generating || criticalCount === 0}
          className="flex-1 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-400 disabled:opacity-50"
          data-testid="nudge-generate"
        >
          {generating ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Generating…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Send className="h-3 w-3" /> Generate nudges
            </span>
          )}
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-background/80 transition hover:bg-white/10"
        >
          Customise
        </button>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1 text-[10px] text-amber-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
