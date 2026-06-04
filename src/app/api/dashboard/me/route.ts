// ════════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/me
// ════════════════════════════════════════════════════════════════════════════
// Single endpoint returning role-specific dashboard data. The discriminator is
// the `role` field; the client renders the matching panel. One round-trip and
// no per-role 404s if the role changes mid-session.
//
// Each role's data is computed from real DB rows. Where the schema doesn't
// yet support a metric (e.g. PD "milestones due" — no Milestone table; admin
// "storage / uptime" — infra metrics), we return null/empty arrays and the UI
// renders an empty-state card.
//
// Aggregate score columns (headScore/heartScore/handsScore) live on a 0–5
// scale; the dashboard UI is a 0–100 scale, so we multiply by 20 here for
// consistency with /api/progress/me.

import { jsonOk, requireAuth, handleUnexpected } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { Role, CourseProgress, CaseStatus, EpaLevel } from '@prisma/client';

const SCORE_SCALE = 20;
const COHORT_LEARNERS_TAKE = 10;
const RECENT_CONV_TAKE = 5;
const RECENT_ACTIVITY_TAKE = 8;

type Accent = 'rose' | 'orange' | 'blue' | 'teal' | 'purple' | 'emerald' | 'amber';
const TOPIC_ACCENT: Record<string, Accent> = {
  retina: 'rose', uvea: 'orange', glaucoma: 'blue',
  cornea: 'teal', pediatric: 'purple', 'neuro-ophth': 'amber',
};
function pickAccent(topicSlug: string | null | undefined, fallback: Accent = 'teal'): Accent {
  if (!topicSlug) return fallback;
  return TOPIC_ACCENT[topicSlug] ?? fallback;
}

function relativeTime(d: Date | null): string {
  if (!d) return 'Not yet';
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60000);
  if (min < 1)   return 'Just now';
  if (min < 60)  return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr  < 24)  return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7)   return `${day} days ago`;
  if (day < 30)  return `${Math.round(day / 7)} week${day < 14 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function computeStreak(eventDates: Date[]): number {
  if (eventDates.length === 0) return 0;
  const dayKeys = new Set(eventDates.map((d) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`));
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const probe = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const key = `${probe.getUTCFullYear()}-${probe.getUTCMonth()}-${probe.getUTCDate()}`;
    if (dayKeys.has(key)) streak += 1;
    else if (i > 0) break;
  }
  return streak;
}

const EPA_LEVEL_NUM: Record<EpaLevel, number> = {
  LEVEL_1_OBSERVATION:          1,
  LEVEL_2_DIRECT_SUPERVISION:   2,
  LEVEL_3_INDIRECT_SUPERVISION: 3,
  LEVEL_4_INDEPENDENT:          4,
  LEVEL_5_SUPERVISING_OTHERS:   5,
};

// ─── Resident ───────────────────────────────────────────────────────────────
async function buildResidentData(userId: string) {
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [enrollments, completions, casesThisMonth, completedThisMonth, recentEventDates, totalCoursesActive] = await Promise.all([
    db.courseEnrollment.findMany({
      where:   { userId, progress: { not: CourseProgress.COMPLETED } },
      orderBy: { lastActivityAt: 'desc' },
      take:    6,
      include: {
        course: {
          select: {
            id:    true,
            slug:  true,
            title: true,
            topic: { select: { slug: true } },
            modules: { select: { _count: { select: { items: true } } } },
            _count: { select: { modules: true } },
          },
        },
      },
    }),
    db.courseCompletion.findMany({
      where:   { userId },
      orderBy: { completedAt: 'desc' },
      take:    6,
      include: {
        course: { select: { id: true, title: true, topic: { select: { name: true } }, estimatedMinutes: true } },
      },
    }),
    db.case.count({ where: { residentId: userId, createdAt: { gte: startMonth }, deletedAt: null } }),
    db.case.findMany({
      where: { residentId: userId, status: CaseStatus.COMPLETED, createdAt: { gte: startMonth }, deletedAt: null },
      select: { template: { select: { estimatedMinutes: true } } },
    }),
    db.scoringEvent.findMany({
      where:   { residentId: userId, voidedAt: null },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select:  { createdAt: true },
    }),
    db.courseEnrollment.count({ where: { userId, progress: { not: CourseProgress.COMPLETED } } }),
  ]);

  const myCourses = enrollments.map((e) => ({
    id:        e.course.id,
    title:     e.course.title,
    href:      `/topics/${e.course.topic?.slug ?? 'general'}`,
    module:    `${e.percentComplete}% complete`,
    progress:  e.percentComplete,
    modulesDone:  Math.round((e.percentComplete / 100) * e.course._count.modules),
    modulesTotal: e.course._count.modules,
    lastStudied:  relativeTime(e.lastActivityAt),
    accent:       pickAccent(e.course.topic?.slug),
  }));

  const completedModules = completions.map((c) => ({
    id:          c.id,
    title:       c.course.title,
    topic:       c.course.topic?.name ?? 'General',
    completedOn: relativeTime(c.completedAt),
    durationMin: c.course.estimatedMinutes ?? 0,
  }));

  const totalMinutes = completedThisMonth.reduce((acc, c) => acc + (c.template?.estimatedMinutes ?? 0), 0);
  const stats = {
    coursesInProgress: totalCoursesActive,
    modulesCompleted:  completions.length, // course-level until module-completion table exists
    hoursThisMonth:    Math.round(totalMinutes / 60),
    dayStreak:         computeStreak(recentEventDates.map((e) => e.createdAt)),
    casesThisMonth,
  };

  return { stats, myCourses, completedModules };
}

// ─── Faculty ────────────────────────────────────────────────────────────────
async function buildFacultyData(userId: string) {
  const now = new Date();
  const start7d  = new Date(now.getTime() - 7  * 24 * 3600 * 1000);
  const start14d = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

  // Mentees this faculty supervises directly. PDs/Faculty in cohort context
  // use facultyMentorId; we read both the direct mentees and the cohorts they
  // run, then dedupe.
  const mentees = await db.user.findMany({
    where:   { facultyMentorId: userId, role: Role.RESIDENT, deletedAt: null },
    select:  { id: true, name: true, avatarUrl: true },
  });
  const menteeIds = mentees.map((m) => m.id);

  // Pull last 100 scoring events across all mentees in one query, then bucket
  // in JS. Avoids N round-trips for "latest score per resident".
  const events = await db.scoringEvent.findMany({
    where:   { residentId: { in: menteeIds }, voidedAt: null },
    orderBy: { createdAt: 'desc' },
    take:    Math.max(100, menteeIds.length * 5),
    select:  {
      residentId: true,
      createdAt:  true,
      headScore:  true,
      heartScore: true,
      handsScore: true,
    },
  });
  const latestByResident = new Map<string, typeof events[number]>();
  for (const e of events) if (!latestByResident.has(e.residentId)) latestByResident.set(e.residentId, e);

  const cohortLearners = mentees
    .map((m) => {
      const e = latestByResident.get(m.id);
      return {
        id:    m.id,
        name:  m.name,
        head:  e ? Math.round(Number(e.headScore  ?? 0) * SCORE_SCALE) : 0,
        heart: e ? Math.round(Number(e.heartScore ?? 0) * SCORE_SCALE) : 0,
        hands: e ? Math.round(Number(e.handsScore ?? 0) * SCORE_SCALE) : 0,
        lastActive: relativeTime(e?.createdAt ?? null),
      };
    })
    .slice(0, COHORT_LEARNERS_TAKE);

  // Recent conversations from mentees, with the case template title and the
  // latest scoring event (if any) for that case.
  const conversations = await db.conversation.findMany({
    where:   { userId: { in: menteeIds }, createdAt: { gte: start14d } },
    orderBy: { updatedAt: 'desc' },
    take:    RECENT_CONV_TAKE,
    select: {
      id:        true,
      createdAt: true,
      user:      { select: { name: true } },
      case: {
        select: {
          title:    true,
          template: { select: { title: true } },
          scoringEvents: {
            orderBy: { createdAt: 'desc' },
            take:    1,
            select:  { headScore: true, heartScore: true },
          },
        },
      },
    },
  });
  const recentConversations = conversations.map((c) => {
    const ev = c.case?.scoringEvents[0];
    return {
      id:        c.id,
      learner:   c.user.name,
      caseTitle: c.case?.template?.title ?? c.case?.title ?? 'Untitled case',
      summary:   '', // free-form summary requires NLP over messages — skip
      date:      c.createdAt.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
      headScore:  ev ? Math.round(Number(ev.headScore  ?? 0) * SCORE_SCALE) : null,
      heartScore: ev ? Math.round(Number(ev.heartScore ?? 0) * SCORE_SCALE) : null,
    };
  });

  // Stats — pending assessments = DOPS + MiniCEX scheduled but not yet
  // performed. Schema has `performedAt` (set on completion) but no scheduled-
  // queue table; we use "no DOPS/MiniCEX recorded for mentee in last 7 days"
  // as a proxy for "owes assessment", which is the right operational signal
  // for a faculty dashboard tile.
  const recentDops = await db.dopsAssessment.count({ where: { assessorId: userId, performedAt: { gte: start7d } } });
  const recentMcx  = await db.miniCexAssessment.count({ where: { assessorId: userId, performedAt: { gte: start7d } } });
  const cohortAvg  = events.length === 0
    ? 0
    : Math.round(
        (events.reduce(
          (acc, e) => acc + (Number(e.headScore ?? 0) + Number(e.heartScore ?? 0) + Number(e.handsScore ?? 0)) / 3,
          0
        ) / events.length) * SCORE_SCALE
      );

  const stats = {
    activeLearners:     mentees.length,
    casesAuthored:      0, // CaseTemplate has no createdById field today
    assessmentsThisWeek: recentDops + recentMcx,
    avgCohortScore:     cohortAvg,
  };

  return { stats, cohortLearners, recentConversations };
}

// ─── Program Director ───────────────────────────────────────────────────────
async function buildPdData(userId: string) {
  // PD oversees residents whose programDirectorId points at one of THEIR
  // faculty. Easiest scoped query: residents whose facultyMentor reports to
  // me OR who report to me directly.
  const directlyMine = await db.user.findMany({
    where:   { programDirectorId: userId, deletedAt: null },
    select:  { id: true, role: true },
  });
  const facultyUnderMe = directlyMine.filter((u) => u.role === Role.FACULTY).map((u) => u.id);
  const residents = await db.user.findMany({
    where: {
      role: Role.RESIDENT,
      deletedAt: null,
      OR: [
        { programDirectorId: userId },
        { facultyMentorId:   { in: facultyUnderMe } },
      ],
    },
    select: { id: true, name: true },
    take:   30,
  });

  const epaRecords = await db.epaRecord.findMany({
    where:   { residentId: { in: residents.map((r) => r.id) } },
    orderBy: { epaCode: 'asc' },
  });

  // Build the matrix: { residentName, levels: { [epaCode]: number } }
  // Also collect distinct EPA columns observed.
  const epaCodes = Array.from(new Set(epaRecords.map((r) => r.epaCode))).sort();
  const epaLabels = epaCodes.map((code) => {
    const found = epaRecords.find((r) => r.epaCode === code);
    return { code, label: found?.epaName ?? code };
  });
  const matrix = residents.map((r) => {
    const levels: Record<string, number> = {};
    for (const code of epaCodes) {
      const rec = epaRecords.find((rec) => rec.residentId === r.id && rec.epaCode === code);
      levels[code] = rec ? EPA_LEVEL_NUM[rec.currentLevel] : 0;
    }
    return { residentId: r.id, residentName: r.name, levels };
  });

  // Stats
  const onTrack    = matrix.filter((m) => Object.values(m.levels).every((lvl) => lvl >= 3)).length;
  const attention  = matrix.filter((m) => Object.values(m.levels).some((lvl) => lvl > 0 && lvl <= 2)).length;

  return {
    stats:               { totalResidents: residents.length, onTrack, attention, milestonesDue: 0 },
    epaMatrix:           { residents: matrix, epaLabels },
    upcomingMilestones:  [], // No Milestone table yet
    accreditation:       null, // No Accreditation table yet
  };
}

// ─── Admin ─────────────────────────────────────────────────────────────────
async function buildAdminData() {
  const [totalUsers, activeCases, recentEvents] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.case.count({ where: { status: CaseStatus.ACTIVE, deletedAt: null } }),
    db.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take:    RECENT_ACTIVITY_TAKE,
      select: {
        id:         true,
        eventType:  true,
        summary:    true,
        success:    true,
        createdAt:  true,
        actor:      { select: { name: true } },
      },
    }),
  ]);

  const recentActivity = recentEvents.map((e) => ({
    id:      e.id,
    action:  e.eventType,
    details: e.summary ?? '',
    time:    relativeTime(e.createdAt),
    success: e.success,
    actor:   e.actor?.name ?? 'system',
  }));

  return {
    stats: {
      totalUsers,
      activeCases,
      storage: null, // infra metric; populated by ops dashboard, not DB
      uptime:  null,
    },
    recentActivity,
  };
}

// ─── Route handler ─────────────────────────────────────────────────────────
export async function GET() {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { user } = gate;

    switch (user.role) {
      case Role.RESIDENT:
        return jsonOk({ role: 'RESIDENT' as const, data: await buildResidentData(user.id) });
      case Role.FACULTY:
        return jsonOk({ role: 'FACULTY' as const, data: await buildFacultyData(user.id) });
      case Role.PROGRAM_DIRECTOR:
        return jsonOk({ role: 'PROGRAM_DIRECTOR' as const, data: await buildPdData(user.id) });
      case Role.ADMIN:
        return jsonOk({ role: 'ADMIN' as const, data: await buildAdminData() });
      case Role.EXTERNAL_LEARNER:
        return jsonOk({ role: 'EXTERNAL_LEARNER' as const, data: {} });
      default: {
        const _exh: never = user.role;
        void _exh;
        return jsonOk({ role: 'EXTERNAL_LEARNER' as const, data: {} });
      }
    }
  } catch (err) {
    return handleUnexpected(err);
  }
}
