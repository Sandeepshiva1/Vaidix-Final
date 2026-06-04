// ════════════════════════════════════════════════════════════════════════════
// Orphan cleanup — rows whose required FK points to a non-existent user.
// ════════════════════════════════════════════════════════════════════════════
// Run when Prisma errors with:
//   "Field <relation> is required to return data, got `null` instead."
// usage: npx tsx prisma/cleanup-orphans.ts
//
// Caused by demo seeds being run with hardcoded user IDs that later got wiped.
// This sweeps every table that has a required user-FK and deletes rows whose
// referenced user no longer exists.

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// Each entry: { table, fk } → DELETE rows whose `fk` doesn't match any users.id
// (Soft-deleted users still count as "existing" — we only kill rows pointing
// at completely missing IDs, which is the only state that breaks Prisma.)
const ORPHAN_SWEEPS: Array<{ label: string; table: string; fk: string }> = [
  { label: 'teaching_sessions (host)',     table: 'teaching_sessions',     fk: '"hostId"' },
  { label: 'teaching_sessions (proposer)', table: 'teaching_sessions',     fk: '"proposedBy"' },
  { label: 'cohorts (creator)',            table: 'cohorts',               fk: '"createdBy"' },
  { label: 'cohort_members',               table: 'cohort_members',        fk: '"userId"' },
  { label: 'session_invites',              table: 'session_invites',       fk: '"userId"' },
  { label: 'session_participants',         table: 'session_participants',  fk: '"userId"' },
  { label: 'session_admissions',           table: 'session_admissions',    fk: '"userId"' },
  { label: 'session_chat_messages',        table: 'session_chat_messages', fk: '"userId"' },
  { label: 'session_bans',                 table: 'session_bans',          fk: '"userId"' },
  { label: 'session_approval_audits',      table: 'session_approval_audits', fk: '"actorId"' },
];

async function main() {
  console.log('🧹 Sweeping orphaned FKs...\n');
  let total = 0;
  for (const sweep of ORPHAN_SWEEPS) {
    try {
      const result = await db.$executeRawUnsafe(
        `DELETE FROM "${sweep.table}" WHERE ${sweep.fk} NOT IN (SELECT id FROM users)`
      );
      if (result > 0) {
        console.log(`  ✗ ${sweep.label}: deleted ${result} orphan(s)`);
        total += result;
      } else {
        console.log(`  ✓ ${sweep.label}: clean`);
      }
    } catch (e) {
      // Table may not exist in this branch — skip silently
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('does not exist')) {
        console.log(`  · ${sweep.label}: table missing, skipped`);
      } else {
        console.error(`  ! ${sweep.label}:`, msg);
      }
    }
  }
  console.log(`\nDone. ${total} orphaned row(s) removed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
