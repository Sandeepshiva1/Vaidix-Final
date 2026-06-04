// ════════════════════════════════════════════════════════════════════════════
// Vaidix — Demo seed (opt-in, NOT run by default)
// ════════════════════════════════════════════════════════════════════════════
// Run: npm run db:seed:demo
// Idempotent: re-running upserts the same fixed-ID rows.
//
// Adds on top of the base seed (prisma/seed.ts):
//   • One user per non-admin role (resident, faculty, PD, external_learner)
//   • Two cohorts (active)
//   • Five teaching sessions: 1 LIVE, 2 SCHEDULED (next 14d), 2 ENDED (past 30d)
//
// Filter: every row stamps `metadata: { seedSource: 'demo' }` (sessions) or a
// known fixed ID prefix (`demo-*`) so they can be cleaned with a single query.
//
// Safety: this script is intentionally NOT wired into `prisma.seed`. It must
// be invoked explicitly. Production should never run this.

import { PrismaClient, Role, UserStatus, SessionType, SessionStatus, SessionApprovalStatus, CohortStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const DEFAULT_PASSWORD = 'Vaidix@2026!'

const DEMO_USERS = [
  { id: 'demo-user-resident',  email: 'resident@vaidix.demo',  name: 'Dr. Ananya Krishnan',   role: Role.RESIDENT,         subspecialty: 'Vitreoretinal Surgery', yearOfResidency: 3 },
  { id: 'demo-user-faculty',   email: 'faculty@vaidix.demo',   name: 'Dr. Avinash Pathengay', role: Role.FACULTY,          subspecialty: 'Vitreoretinal Surgery' },
  { id: 'demo-user-pd',        email: 'pd@vaidix.demo',        name: 'Dr. Gullapalli N. Rao', role: Role.PROGRAM_DIRECTOR, subspecialty: 'Cornea' },
  { id: 'demo-user-external',  email: 'external@vaidix.demo',  name: 'Dr. Meera Iyer',        role: Role.EXTERNAL_LEARNER, subspecialty: 'Visiting Fellow' },
] as const

async function main() {
  console.log('🎬 Seeding Vaidix DEMO data...\n')

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12)

  // ─── 1. Find/seed admin (host of demo sessions) ────────────────────────────
  // The base seed creates sandeep@vaidix.local. We require it to be present
  // so demo sessions have a valid host/proposer.
  const admin = await prisma.user.findUnique({ where: { email: 'sandeep@vaidix.local' } })
  if (!admin) {
    console.error('❌ Base seed has not been run. Run `npm run db:seed` first.')
    process.exit(1)
  }

  // ─── 2. Seed demo users (one per role) ─────────────────────────────────────
  // Each user gets its child rows (profile / preferences / stats) upserted
  // independently keyed on `userId`. Nesting them under the parent
  // `prisma.user.upsert(... create: { profile: { create: {} } })` makes the
  // seed brittle: if a prior partial run created the children but not the
  // user (or vice-versa), the second run trips the unique constraint on
  // `userId` because Prisma's nested-create has no upsert mode. Splitting
  // the inserts makes every step independently idempotent.
  console.log('👥 Seeding demo users...')
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { name: u.name, role: u.role, status: UserStatus.ACTIVE, passwordHash },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: UserStatus.ACTIVE,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    })
    await prisma.userProfile.upsert({
      where: { userId: u.id },
      update: {
        subspecialty: u.subspecialty,
        yearOfResidency: 'yearOfResidency' in u ? u.yearOfResidency : null,
      },
      create: {
        userId: u.id,
        subspecialty: u.subspecialty,
        yearOfResidency: 'yearOfResidency' in u ? u.yearOfResidency : null,
        affiliation: 'L V Prasad Eye Institute',
        languages: ['en'],
        timezone: 'Asia/Kolkata',
      },
    })
    await prisma.userPreferences.upsert({
      where: { userId: u.id },
      update: {},
      create: { userId: u.id },
    })
    await prisma.userStats.upsert({
      where: { userId: u.id },
      update: {},
      create: { userId: u.id },
    })
  }
  console.log(`   ✓ ${DEMO_USERS.length} demo users (profile + preferences + stats upserted)`)

  // ─── 3. Seed cohorts ───────────────────────────────────────────────────────
  console.log('👨‍👩‍👧‍👦 Seeding cohorts...')
  const cohort2025 = await prisma.cohort.upsert({
    where: { id: 'demo-cohort-2025' },
    update: {},
    create: {
      id: 'demo-cohort-2025',
      name: 'LVPEI Residents 2025',
      description: 'Demo cohort — first-year residents',
      academicYear: '2025-26',
      status: CohortStatus.ACTIVE,
      createdBy: admin.id,
      programId: 'prg_default_lvpei_ms',
    },
  })
  const cohortFellows = await prisma.cohort.upsert({
    where: { id: 'demo-cohort-fellows' },
    update: {},
    create: {
      id: 'demo-cohort-fellows',
      name: 'LVPEI Fellows 2026',
      description: 'Demo cohort — visiting fellows',
      academicYear: '2026',
      status: CohortStatus.ACTIVE,
      createdBy: admin.id,
      programId: 'prg_default_lvpei_ms',
    },
  })

  // Add the resident demo user to cohort2025
  await prisma.cohortMember.upsert({
    where: { id: 'demo-cohort-member-1' },
    update: {},
    create: {
      id: 'demo-cohort-member-1',
      cohortId: cohort2025.id,
      userId: 'demo-user-resident',
      addedBy: admin.id,
    },
  })

  // Also enrol the base-seed users (Arjun the RESIDENT, Meera the FACULTY)
  // so the primary demo logins see the seeded sessions in /classroom. Without
  // this the demo sessions are scoped to demo-cohort-2025 and only the demo
  // resident account sees them — the base-seed accounts wouldn't intersect.
  // With the new audience-flags model, openToAll alone does not auto-list a
  // session in anyone's feed, so cohort membership is the way to make demo
  // sessions visible to non-host learners.
  const baseSeedEmails = ['arjun.mehta@vaidix.local', 'meera.krishnan@vaidix.local']
  let baseMemberships = 0
  for (const email of baseSeedEmails) {
    const u = await prisma.user.findUnique({ where: { email } })
    if (!u) continue
    await prisma.cohortMember.upsert({
      where: { cohortId_userId: { cohortId: cohort2025.id, userId: u.id } },
      update: {},
      create: { cohortId: cohort2025.id, userId: u.id, addedBy: admin.id },
    })
    baseMemberships += 1
  }
  console.log(`   ✓ 2 cohorts, ${1 + baseMemberships} membership(s)`)

  // ─── 4. Seed teaching sessions ─────────────────────────────────────────────
  console.log('📅 Seeding demo teaching sessions...')

  const now = Date.now()
  const hour = 60 * 60 * 1000
  const day = 24 * hour

  const sessions = [
    {
      id: 'demo-session-live',
      title: 'Grand Rounds: Complex Retinal Detachments (LIVE demo)',
      sessionType: SessionType.GRAND_ROUNDS,
      status: SessionStatus.LIVE,
      start: new Date(now - 15 * 60 * 1000),
      end: new Date(now + 45 * 60 * 1000),
      description: 'Live demo session — Surgical decision making for complex RD cases.',
    },
    {
      id: 'demo-session-upcoming-1',
      title: 'Journal Club: Anti-VEGF Advances 2026',
      sessionType: SessionType.JOURNAL_CLUB,
      status: SessionStatus.SCHEDULED,
      start: new Date(now + 2 * day),
      end: new Date(now + 2 * day + 1 * hour),
      description: 'Monthly journal club — review of new anti-VEGF agents.',
    },
    {
      id: 'demo-session-upcoming-2',
      title: 'Case Conference: Pediatric Strabismus',
      sessionType: SessionType.CASE_CONFERENCE,
      status: SessionStatus.SCHEDULED,
      start: new Date(now + 7 * day),
      end: new Date(now + 7 * day + 1.5 * hour),
      description: 'Difficult cases discussion with the pediatric ophthalmology team.',
    },
    {
      id: 'demo-session-past-1',
      title: 'Lecture: Diabetic Retinopathy Staging',
      sessionType: SessionType.LECTURE,
      status: SessionStatus.ENDED,
      start: new Date(now - 7 * day),
      end: new Date(now - 7 * day + 1 * hour),
      description: 'Recorded — staging and management of diabetic retinopathy.',
    },
    {
      id: 'demo-session-past-2',
      title: 'Skills Workshop: Suturing Techniques',
      sessionType: SessionType.SKILLS_WORKSHOP,
      status: SessionStatus.ENDED,
      start: new Date(now - 14 * day),
      end: new Date(now - 14 * day + 2 * hour),
      description: 'Hands-on suturing for cataract and corneal surgery.',
    },
  ]

  for (const s of sessions) {
    await prisma.teachingSession.upsert({
      where: { id: s.id },
      update: {
        status: s.status,
        scheduledStart: s.start,
        scheduledEnd: s.end,
      },
      create: {
        id: s.id,
        title: s.title,
        description: s.description,
        sessionType: s.sessionType,
        hostId: 'demo-user-faculty',
        proposedBy: 'demo-user-pd',
        programId: 'prg_default_lvpei_ms',
        approvedBy: admin.id,
        approvedAt: new Date(now - 1 * day),
        status: s.status,
        approvalStatus: SessionApprovalStatus.APPROVED,
        // Audience: cohort-scoped + anyone-with-link. Cohort members get the
        // session in their Classroom feed and access to materials; outside
        // observers can still join the live call via the share URL.
        openToAll: true,
        scheduledStart: s.start,
        scheduledEnd: s.end,
        actualStart: s.status === SessionStatus.LIVE || s.status === SessionStatus.ENDED ? s.start : null,
        actualEnd: s.status === SessionStatus.ENDED ? s.end : null,
        cohortId: cohort2025.id,
        recordingEnabled: true,
        consentRequired: true,
        breakoutsEnabled: false,
        maxParticipants: 100,
        tags: ['demo'],
        metadata: { seedSource: 'demo' },
      },
    })
  }
  console.log(`   ✓ ${sessions.length} teaching sessions`)

  console.log('\n✅ Demo seed complete.\n')
  console.log(`   Demo accounts (password: ${DEFAULT_PASSWORD}):`)
  for (const u of DEMO_USERS) {
    console.log(`     ${u.email.padEnd(28)}  →  ${u.role}`)
  }
  console.log(`\n   Reference cohort id: ${cohort2025.id}, ${cohortFellows.id}`)
}

main()
  .catch((e) => {
    console.error('❌ Demo seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
