// ════════════════════════════════════════════════════════════════════════════
// provision-class.ts — stand up a live-class cohort for a demo / real class.
// Creates: 1 faculty host, N learner accounts (default 25), 1 cohort, and
// M scheduled sessions (default 10) with all learners enrolled.
//
// Idempotent: users upsert by email, cohort/members upsert, sessions use
// deterministic ids. Re-running updates instead of duplicating.
//
// Run inside the app container (it has prisma client + bcryptjs + DB access):
//   docker cp prisma/provision-class.ts vaidix-app:/app/prisma/provision-class.ts
//   docker compose -f docker-compose.prod.yml --env-file .env exec app \
//     npx tsx prisma/provision-class.ts
//
// Tunables (env):  MEMBER_COUNT, CLASS_COUNT, CLASS_MEMBER_PASSWORD,
//                  CLASS_FACULTY_PASSWORD
// ════════════════════════════════════════════════════════════════════════════
import {
  PrismaClient, Role, UserStatus, CohortStatus,
  SessionStatus, SessionApprovalStatus, SessionType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PROGRAM_ID = process.env.CLASS_PROGRAM_ID ?? 'prg_default_lvpei_ms';
const MEMBER_COUNT = Number(process.env.MEMBER_COUNT ?? 25);
const CLASS_COUNT = Number(process.env.CLASS_COUNT ?? 10);
const MEMBER_PW = process.env.CLASS_MEMBER_PASSWORD ?? 'Vaidix@Class2026';
const FACULTY_PW = process.env.CLASS_FACULTY_PASSWORD ?? 'Vaidix@Faculty2026';

const CLASS_TITLES = [
  'Diabetic Retinopathy — Staging & Anti-VEGF',
  'Age-related Macular Degeneration — Diagnosis & Therapy',
  'Glaucoma — IOP Control & Surgical Options',
  'Cataract Surgery — Phaco Fundamentals',
  'Corneal Dystrophies & Keratoconus',
  'Retinal Detachment — Recognition & Repair',
  'Uveitis — Workup & Management',
  'Pediatric Ophthalmology — Strabismus & Amblyopia',
  'Neuro-ophthalmology — Optic Nerve Disorders',
  'Ocular Trauma — Emergency Management',
];

// Child rows (profile/preferences/stats) are nice-to-have — never block the
// account on them. Auth + joining a live session only need the User row.
async function ensureChildRows(userId: string) {
  try { await prisma.userPreferences.upsert({ where: { userId }, update: {}, create: { userId } }); } catch { /* optional */ }
  try { await prisma.userStats.upsert({ where: { userId }, update: {}, create: { userId } }); } catch { /* optional */ }
  try { await prisma.userProfile.upsert({ where: { userId }, update: {}, create: { userId, languages: [] } }); } catch { /* optional */ }
}

async function main() {
  const program = await prisma.program.findUnique({ where: { id: PROGRAM_ID }, select: { id: true } });
  if (!program) throw new Error(`Program ${PROGRAM_ID} not found — run the base seed first (npx prisma db seed).`);

  // ── 1. Faculty host ───────────────────────────────────────────────────────
  const facHash = await bcrypt.hash(FACULTY_PW, 12);
  const faculty = await prisma.user.upsert({
    where: { email: 'faculty1@vaidix.local' },
    update: { name: 'Dr. Faculty One', role: Role.FACULTY, status: UserStatus.ACTIVE, activeProgramId: PROGRAM_ID, passwordHash: facHash },
    create: { email: 'faculty1@vaidix.local', name: 'Dr. Faculty One', role: Role.FACULTY, status: UserStatus.ACTIVE, activeProgramId: PROGRAM_ID, passwordHash: facHash },
    select: { id: true },
  });
  await ensureChildRows(faculty.id);

  // ── 2. Members (learners) ────────────────────────────────────────────────
  const memberHash = await bcrypt.hash(MEMBER_PW, 12);
  const members: { id: string }[] = [];
  for (let i = 1; i <= MEMBER_COUNT; i++) {
    const n = String(i).padStart(2, '0');
    const email = `member${n}@vaidix.local`;
    const u = await prisma.user.upsert({
      where: { email },
      update: { name: `Member ${n}`, role: Role.RESIDENT, status: UserStatus.ACTIVE, activeProgramId: PROGRAM_ID, passwordHash: memberHash },
      create: { email, name: `Member ${n}`, role: Role.RESIDENT, status: UserStatus.ACTIVE, activeProgramId: PROGRAM_ID, passwordHash: memberHash },
      select: { id: true },
    });
    await ensureChildRows(u.id);
    members.push(u);
  }
  console.log(`✓ ${members.length} members + 1 faculty (ACTIVE)`);

  // ── 3. Cohort + membership ───────────────────────────────────────────────
  const cohort = await prisma.cohort.upsert({
    where: { id: 'class-2026' },
    update: { name: 'Class of 2026', status: CohortStatus.ACTIVE, programId: PROGRAM_ID },
    create: { id: 'class-2026', name: 'Class of 2026', description: 'Live class cohort', status: CohortStatus.ACTIVE, createdBy: faculty.id, programId: PROGRAM_ID },
    select: { id: true },
  });
  for (const m of members) {
    await prisma.cohortMember.upsert({
      where: { cohortId_userId: { cohortId: cohort.id, userId: m.id } },
      update: {}, create: { cohortId: cohort.id, userId: m.id, addedBy: faculty.id },
    });
  }
  console.log(`✓ cohort "Class of 2026" with ${members.length} members`);

  // ── 4. Classes (sessions) + enroll everyone ──────────────────────────────
  const now = Date.now();
  for (let c = 0; c < CLASS_COUNT; c++) {
    const id = `class-2026-session-${String(c + 1).padStart(2, '0')}`;
    const start = new Date(now + (c + 1) * 24 * 60 * 60 * 1000); // one per upcoming day
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const title = CLASS_TITLES[c] ?? `Class ${c + 1}`;
    const data = {
      title, sessionType: SessionType.LECTURE,
      hostId: faculty.id, proposedBy: faculty.id, programId: PROGRAM_ID,
      status: SessionStatus.SCHEDULED, approvalStatus: SessionApprovalStatus.APPROVED, approvedBy: faculty.id, approvedAt: new Date(),
      scheduledStart: start, scheduledEnd: end,
      cohortId: cohort.id, maxParticipants: Math.max(100, MEMBER_COUNT + 5),
      recordingEnabled: true, consentRequired: true, tags: ['Vitreoretina'],
    };
    const sess = await prisma.teachingSession.upsert({ where: { id }, update: data, create: { id, ...data }, select: { id: true, title: true } });
    for (const m of members) {
      await prisma.sessionParticipant.upsert({
        where: { sessionId_userId: { sessionId: sess.id, userId: m.id } },
        update: {}, create: { sessionId: sess.id, userId: m.id, role: 'PARTICIPANT' },
      });
    }
    console.log(`  ✓ ${title}  (${sess.id})`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`Provisioned: 1 faculty, ${members.length} members, ${CLASS_COUNT} classes.`);
  console.log(`  Faculty:  faculty1@vaidix.local  /  ${FACULTY_PW}`);
  console.log(`  Members:  member01..member${String(MEMBER_COUNT).padStart(2, '0')}@vaidix.local  /  ${MEMBER_PW}`);
  console.log('──────────────────────────────────────────────');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect().finally(() => process.exit(1)); });
