// ════════════════════════════════════════════════════════════════════════════
// GET /api/progress/me
// ════════════════════════════════════════════════════════════════════════════
// Returns the signed-in resident's progress snapshot used by /progress.
// Source: scoring_events (3H aggregates), cases (counts/streak), case_templates
// (Oslerian principles touched), user_level_progress (Bloom's max).
//
// Aggregate columns headScore/heartScore/handsScore are stored on a 0–5 scale
// (mean of four 0–5 subscores). The progress UI is laid out for a 0–100 scale,
// so we multiply by 20 here to map cleanly. STRONG_THRESHOLD on a 0-5 scale
// matches /api/learners/[id]/blooms-progression.
//
// Empty-state contract: every list/object is returned even when zero data
// exists (so the UI can render an honest "no activity yet" state rather than
// crash on undefined). Only `growthDeltas` returns null — the UI swaps the
// delta cards for an empty hero when null.
//
// Auth: any signed-in user. Non-residents see their own progress (which will
// be empty for FACULTY/PD/ADMIN) — no role gate is needed because residents
// own scoring_events; the query is scoped to `residentId = me.id`.

import { jsonOk, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { CaseStatus } from '@prisma/client';

const TRAJECTORY_TAKE = 10;
const RECENT_TAKE = 5;
const STRONG_SUBSCORE = 4; // 0–5 axis; matches blooms-progression
const SCORE_SCALE = 20;    // 0–5 aggregate × 20 → 0–100 for the UI

interface ProgressGrowthPoint { case: string; head: number; heart: number; hands: number; date: string }
interface DeltaTriple { head: { current: number; delta: number }; heart: { current: number; delta: number }; hands: { current: number; delta: number } }
interface OslerianGrowth { id: string; engagementCount: number; baseline: number | null; current: number | null }
interface RecentCaseRow { id: string; date: string; name: string; head: number; heart: number; hands: number }

interface ProgressSnapshot {
  growthData:    ProgressGrowthPoint[];
  growthDeltas:  DeltaTriple | null;
  consistency:   { streak: number; casesThisMonth: number; avgSessionMinutes: number | null; totalHours: number | null };
  oslerianGrowth: OslerianGrowth[];
  bloomsAchieved: number;
  recentCases:   RecentCaseRow[];
}

function toScale(d: { toString(): string } | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return Math.round(Number(d) * SCORE_SCALE);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

// Calendar-day streak: count consecutive days ending today where ≥1 scoring
// event exists. Stops at the first gap. Cheap because we only walk distinct
// dates pulled from a single indexed query.
function computeStreak(eventDates: Date[]): number {
  if (eventDates.length === 0) return 0;
  const dayKeys = new Set(
    eventDates.map((d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`)
  );
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const probe = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const key = `${probe.getUTCFullYear()}-${probe.getUTCMonth()}-${probe.getUTCDate()}`;
    if (dayKeys.has(key)) streak += 1;
    else if (i > 0) break;
    else continue; // today might have no event yet — don't break on i===0
  }
  return streak;
}

export async function GET() {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const me = gate.user;

    const now = new Date();
    const start30  = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const start60  = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // ─── Pull scoring events (resident-scoped, non-voided) ──────────────────
    // One query covers trajectory + deltas + recent table + streak. We cap at
    // 200 rows to keep p95 latency flat for power users; the UI only needs ≤10
    // for the trajectory line and ≤5 for the recent table.
    const events = await db.scoringEvent.findMany({
      where:    { residentId: me.id, voidedAt: null },
      orderBy:  { createdAt: 'desc' },
      take:     200,
      select: {
        id:         true,
        createdAt:  true,
        headScore:  true,
        heartScore: true,
        handsScore: true,
        case: {
          select: {
            id:              true,
            title:           true,
            difficultyLevel: true,
            template: { select: { oslerianPrinciples: true, title: true } },
          },
        },
      },
    });

    // ─── 3H Growth Trajectory (last 10, oldest→newest) ──────────────────────
    const trajectory = events.slice(0, TRAJECTORY_TAKE).reverse();
    const growthData: ProgressGrowthPoint[] = trajectory.map((e, i) => ({
      case: `C${i + 1}`,
      head:  toScale(e.headScore),
      heart: toScale(e.heartScore),
      hands: toScale(e.handsScore),
      date:  formatDate(e.createdAt),
    }));

    // ─── Growth Deltas (last 30d avg − previous 30d avg) ────────────────────
    function avgWindow(from: Date, to: Date) {
      const win = events.filter((e) => e.createdAt >= from && e.createdAt < to);
      if (win.length === 0) return null;
      const sum = win.reduce(
        (acc, e) => ({
          head:  acc.head  + Number(e.headScore  ?? 0),
          heart: acc.heart + Number(e.heartScore ?? 0),
          hands: acc.hands + Number(e.handsScore ?? 0),
        }),
        { head: 0, heart: 0, hands: 0 }
      );
      return {
        head:  Math.round((sum.head  / win.length) * SCORE_SCALE),
        heart: Math.round((sum.heart / win.length) * SCORE_SCALE),
        hands: Math.round((sum.hands / win.length) * SCORE_SCALE),
      };
    }
    const cur = avgWindow(start30, now);
    const prev = avgWindow(start60, start30);
    const growthDeltas: DeltaTriple | null =
      cur === null
        ? null
        : {
            head:  { current: cur.head,  delta: cur.head  - (prev?.head  ?? 0) },
            heart: { current: cur.heart, delta: cur.heart - (prev?.heart ?? 0) },
            hands: { current: cur.hands, delta: cur.hands - (prev?.hands ?? 0) },
          };

    // ─── Bloom's Achieved (max difficultyLevel where event was strong) ──────
    // Strong = all three subscore aggregates ≥ STRONG_SUBSCORE (matches the
    // blooms-progression endpoint's threshold). This avoids inventing a
    // separate "Bloom's level" field; difficultyLevel 1–6 already maps.
    let bloomsAchieved = 0;
    for (const e of events) {
      const head  = Number(e.headScore  ?? 0);
      const heart = Number(e.heartScore ?? 0);
      const hands = Number(e.handsScore ?? 0);
      const lvl   = e.case?.difficultyLevel ?? 0;
      if (lvl > bloomsAchieved && Math.min(head, heart, hands) >= STRONG_SUBSCORE) {
        bloomsAchieved = Math.min(6, lvl);
      }
    }

    // ─── Recent Cases (last 5 events with a case) ───────────────────────────
    const recentCases: RecentCaseRow[] = events
      .filter((e) => e.case)
      .slice(0, RECENT_TAKE)
      .map((e) => ({
        id:    e.case!.id,
        date:  e.createdAt.toISOString().slice(0, 10),
        name:  e.case!.template?.title ?? e.case!.title,
        head:  toScale(e.headScore),
        heart: toScale(e.heartScore),
        hands: toScale(e.handsScore),
      }));

    // ─── Oslerian Principles — engagement count from cases touched ──────────
    // We don't track per-principle scoring yet, so we report HOW MANY cases
    // exercised each principle. Front-end shows engagement as "current"
    // (max-clamped to 100) and leaves baseline null → progress bar without
    // a baseline ghost. When per-principle scoring lands, swap to that.
    const principleHits = new Map<string, number>();
    for (const e of events) {
      const list = e.case?.template?.oslerianPrinciples ?? [];
      for (const id of list) principleHits.set(id, (principleHits.get(id) ?? 0) + 1);
    }
    const PRINCIPLE_IDS = ['direct_observation', 'listen_to_patient', 'first_principles', 'equanimity', 'teaching_to_learn'];
    const oslerianGrowth: OslerianGrowth[] = PRINCIPLE_IDS.map((id) => {
      const hits = principleHits.get(id) ?? 0;
      return { id, engagementCount: hits, baseline: null, current: hits === 0 ? null : Math.min(100, hits * 10) };
    });

    // ─── Consistency: cases-this-month, streak, hours ───────────────────────
    const casesThisMonth = await db.case.count({
      where: { residentId: me.id, createdAt: { gte: startMonth }, deletedAt: null },
    });

    // Total minutes this month — sum of CaseTemplate.estimatedMinutes for
    // completed cases this month. It's an estimate, not a stopwatch, but it
    // matches what residents see when they pick a case ("~20 min").
    const completedThisMonth = await db.case.findMany({
      where: {
        residentId: me.id,
        createdAt:  { gte: startMonth },
        status:     CaseStatus.COMPLETED,
        deletedAt:  null,
      },
      select: { template: { select: { estimatedMinutes: true } } },
    });
    const totalMinutes = completedThisMonth.reduce(
      (acc, c) => acc + (c.template?.estimatedMinutes ?? 0),
      0
    );
    const totalHours = totalMinutes > 0 ? Number((totalMinutes / 60).toFixed(1)) : null;
    const avgSessionMinutes =
      completedThisMonth.length > 0
        ? Math.round(totalMinutes / completedThisMonth.length)
        : null;

    const streak = computeStreak(events.map((e) => e.createdAt));

    const snapshot: ProgressSnapshot = {
      growthData,
      growthDeltas,
      consistency: { streak, casesThisMonth, avgSessionMinutes, totalHours },
      oslerianGrowth,
      bloomsAchieved,
      recentCases,
    };

    return jsonOk(snapshot);
  } catch (err) {
    return handleUnexpected(err);
  }
}
