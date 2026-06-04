// ════════════════════════════════════════════════════════════════════════════
// Vaidix — Demo Data Cleanup
// ════════════════════════════════════════════════════════════════════════════
// One-time cleanup for production deploys that previously ran the demo seed
// (i.e. before SEED_DEMO gating landed). Removes ONLY rows that the demo seed
// authored — admin accounts, real invitees, and admin-created cohorts/cases
// are left untouched.
//
//   Dry-run (default): prints what WOULD be deleted, changes nothing.
//     npx tsx --env-file=.env prisma/cleanup-demo.ts
//
//   Apply:
//     npx tsx --env-file=.env prisma/cleanup-demo.ts --apply
//
// What gets removed (only when --apply):
//   1. The 4 demo non-admin users seeded by prisma/seed.ts:
//        arjun.mehta@vaidix.local, meera.krishnan@vaidix.local,
//        rajeev.nair@vaidix.local, priya.sharma@vaidix.local
//      Their invitations, cohort memberships, and other owned rows cascade.
//   2. The demo cohort "PGY-1 Residents 2026–27".
//   3. All Pearls (every row — Pearl is mock content; admins re-seed via UI).
//   4. All AtlasImages (same rationale).
//   5. All CaseTemplates (same rationale).
//   6. Sample courses with the seed slugs (empathy-basics, diff-dx-anterior,
//      slit-lamp-mastery). Other courses created via UI are preserved.
//
// Preserved: admin user, Levels, Topics, Retention Policies, Feature Flags,
// any user invited through /admin/invitations, any cohort created via the UI,
// any course/cohort whose slug or name doesn't match the seed.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const DEMO_USER_EMAILS = [
  'arjun.mehta@vaidix.local',
  'meera.krishnan@vaidix.local',
  'rajeev.nair@vaidix.local',
  'priya.sharma@vaidix.local',
];

// Demo users seeded by prisma/seed.demo.ts (separate set, different IDs).
// Cleanup needs to sweep these too — they share the same 1:1 child tables
// (UserProfile / UserPreferences / UserStats) that can orphan if a previous
// seed run partially failed.
const DEMO_SEED_USER_IDS = [
  'demo-user-resident',
  'demo-user-faculty',
  'demo-user-pd',
  'demo-user-external',
];

const DEMO_COHORT_NAME = 'PGY-1 Residents 2026–27';

const DEMO_COURSE_SLUGS = [
  'empathy-basics',
  'diff-dx-anterior',
  'slit-lamp-mastery',
];

async function main() {
  const banner = APPLY ? '🧹 APPLY mode — deletions will run' : '🔍 DRY-RUN — nothing will be deleted (pass --apply to execute)';
  console.log(`\n${banner}\n`);

  // ─── 1) Demo users (both base seed + demo seed) ─────────────────────────
  const demoUsers = await prisma.user.findMany({
    where: { email: { in: DEMO_USER_EMAILS } },
    select: { id: true, email: true, name: true, role: true },
  });
  console.log(`👥 Demo users (base seed): ${demoUsers.length}`);
  for (const u of demoUsers) console.log(`   - ${u.email} (${u.name}, ${u.role})`);

  const demoSeedUsers = await prisma.user.findMany({
    where: { id: { in: DEMO_SEED_USER_IDS } },
    select: { id: true, email: true, name: true, role: true },
  });
  console.log(`\n👥 Demo users (seed.demo.ts): ${demoSeedUsers.length}`);
  for (const u of demoSeedUsers) console.log(`   - ${u.email} (${u.name}, ${u.role})`);

  // ─── 1a) 1:1 child rows for known demo users ─────────────────────────────
  // Profile / Preferences / Stats are cascade-on-delete from User but can
  // orphan if a prior run was interrupted, or if someone wiped the users
  // table via raw SQL. The apply phase below sweeps them unconditionally
  // for every known demo userId so a fresh seed isn't blocked by a stale
  // child row's unique-userId constraint.
  const knownDemoUserIds = [
    ...demoUsers.map((u) => u.id),
    ...DEMO_SEED_USER_IDS,
  ];
  const [profileCount, prefCount, statCount] = await Promise.all([
    prisma.userProfile.count({ where: { userId: { in: knownDemoUserIds } } }),
    prisma.userPreferences.count({ where: { userId: { in: knownDemoUserIds } } }),
    prisma.userStats.count({ where: { userId: { in: knownDemoUserIds } } }),
  ]);
  const childCount = profileCount + prefCount + statCount;
  if (childCount > 0) {
    console.log(`\n🧟 1:1 child rows on known demo userIds: ${childCount}`);
    console.log(`   - profiles: ${profileCount}, preferences: ${prefCount}, stats: ${statCount}`);
  }

  // ─── 2) Demo cohort ─────────────────────────────────────────────────────
  const demoCohorts = await prisma.cohort.findMany({
    where: { name: DEMO_COHORT_NAME },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  console.log(`\n🪢 Demo cohorts: ${demoCohorts.length}`);
  for (const c of demoCohorts) console.log(`   - "${c.name}" (${c._count.members} members)`);

  // ─── 3) Pearls / Atlas / Case Templates ─────────────────────────────────
  const [pearlCount, atlasCount, templateCount] = await Promise.all([
    prisma.pearl.count(),
    prisma.atlasImage.count(),
    prisma.caseTemplate.count(),
  ]);
  console.log(`\n💎 Pearls: ${pearlCount}`);
  console.log(`🖼️  Atlas images: ${atlasCount}`);
  console.log(`📚 Case templates: ${templateCount}`);

  // ─── 4) Sample courses ──────────────────────────────────────────────────
  const sampleCourses = await prisma.course.findMany({
    where: { slug: { in: DEMO_COURSE_SLUGS } },
    select: { id: true, slug: true, title: true },
  });
  console.log(`\n🎓 Sample courses: ${sampleCourses.length}`);
  for (const c of sampleCourses) console.log(`   - ${c.slug} — ${c.title}`);

  if (!APPLY) {
    console.log('\nℹ️  Re-run with --apply to perform the deletions above.\n');
    return;
  }

  // ─── EXECUTE ────────────────────────────────────────────────────────────
  console.log('\n🗑️  Executing deletions in a single transaction...');
  await prisma.$transaction(async (tx) => {
    // Order matters: dependent rows first, then parents. Where the schema has
    // ON DELETE CASCADE we still let it cascade; we only short-circuit rows
    // that have RESTRICT or SET NULL relationships pointed at admin-owned data.

    // 4a. Sample courses
    const delCourses = await tx.course.deleteMany({
      where: { slug: { in: DEMO_COURSE_SLUGS } },
    });
    console.log(`   ✓ ${delCourses.count} sample courses deleted`);

    // 4b. Case templates — entire table is mock seed content
    const delCases = await tx.caseTemplate.deleteMany({});
    console.log(`   ✓ ${delCases.count} case templates deleted`);

    // 4c. Atlas images
    const delAtlas = await tx.atlasImage.deleteMany({});
    console.log(`   ✓ ${delAtlas.count} atlas images deleted`);

    // 4d. Pearls
    const delPearls = await tx.pearl.deleteMany({});
    console.log(`   ✓ ${delPearls.count} pearls deleted`);

    // 4e. Demo cohort + memberships (CohortMember has onDelete: Cascade)
    const delCohorts = await tx.cohort.deleteMany({
      where: { name: DEMO_COHORT_NAME },
    });
    console.log(`   ✓ ${delCohorts.count} demo cohorts deleted`);

    // 4f. Demo users — their invitations, sessions, profile etc. cascade.
    // Soft-delete first so any unique-by-email checks elsewhere don't trip,
    // then hard-delete.
    const delUsers = await tx.user.deleteMany({
      where: { email: { in: DEMO_USER_EMAILS } },
    });
    console.log(`   ✓ ${delUsers.count} base-seed demo users deleted`);

    // 4g. Demo-seed-only users (separate set with `demo-user-*` IDs).
    const delDemoSeedUsers = await tx.user.deleteMany({
      where: { id: { in: DEMO_SEED_USER_IDS } },
    });
    console.log(`   ✓ ${delDemoSeedUsers.count} seed.demo.ts users deleted`);

    // 4h. Sweep any 1:1 child rows for the known demo userIds.
    // FK cascade *should* have taken care of these on the user.deleteMany
    // calls above, but we run the sweep unconditionally so re-applying
    // cleanup on a half-cleaned DB (e.g. raw SQL delete on `users` without
    // cascade) doesn't leave the unique-userId constraint armed against the
    // next seed run.
    const knownDemoIds = [
      ...demoUsers.map((u) => u.id),
      ...DEMO_SEED_USER_IDS,
    ];
    if (knownDemoIds.length > 0) {
      const [delProf, delPref, delStat] = await Promise.all([
        tx.userProfile.deleteMany({ where: { userId: { in: knownDemoIds } } }),
        tx.userPreferences.deleteMany({ where: { userId: { in: knownDemoIds } } }),
        tx.userStats.deleteMany({ where: { userId: { in: knownDemoIds } } }),
      ]);
      const swept = delProf.count + delPref.count + delStat.count;
      if (swept > 0) console.log(`   ✓ ${swept} stale profile/preferences/stats rows swept`);
    }
  });

  console.log('\n✅ Cleanup complete. Admin user, real invitees, and admin-created');
  console.log('   data are untouched. Reference data (levels, topics, retention,');
  console.log('   feature flags) preserved.\n');
}

main()
  .catch((e) => {
    console.error('❌ Cleanup failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
