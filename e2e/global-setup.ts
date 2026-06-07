// Playwright global setup — seeds the DB rows the specs assert against, using
// ONLY @prisma/client (no app-service imports, so Playwright's loader never has
// to resolve `@/` aliases here). The REAL service + route code is still
// exercised — by the authenticated HTTP requests the specs make against the
// running dev server.
//
// Seeds:
//   • LIVE session "present"  — 2 fired hooks, resident joined BEFORE they fired
//   • LIVE session "late"     — 2 fired hooks, resident joined AFTER they fired
//   • SCHEDULED session "Q"   — 1 pre-question, NOT yet reviewed (Fix #2)
// Writes ids/credentials to e2e/.state.json for the specs + teardown.

import { PrismaClient, SessionStatus, SessionApprovalStatus, SessionType, LiveHookKind } from '@prisma/client'
import { writeFileSync, readFileSync } from 'node:fs'

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* optional */ }

const db = new PrismaClient()
const PROGRAM_ID = 'prg_default_lvpei_ms'
const TAG = `e2e-pw-${Date.now()}`
const PASSWORD = '12345678' // DEMO_PASSWORD for *.vaidix.local seed users

async function findUser(email: string, role: 'FACULTY' | 'RESIDENT') {
  const byEmail = await db.user.findFirst({ where: { email, status: 'ACTIVE' }, select: { id: true, email: true } })
  if (byEmail) return byEmail
  const byRole = await db.user.findFirst({
    where: { role, status: 'ACTIVE', email: { endsWith: '@vaidix.local' } },
    select: { id: true, email: true },
  })
  if (!byRole) throw new Error(`No ${role} seed user found (need *.vaidix.local with password ${PASSWORD})`)
  return byRole
}

async function makeLiveSessionWithFiredHooks(hostId: string, joinedAt: Date, residentId: string) {
  const now = Date.now()
  const firedAt = new Date(now - 5 * 60 * 1000) // hooks fired 5 min ago
  const s = await db.teachingSession.create({
    data: {
      title: `${TAG} live`,
      sessionType: SessionType.LECTURE,
      hostId, proposedBy: hostId, programId: PROGRAM_ID,
      status: SessionStatus.LIVE,
      approvalStatus: SessionApprovalStatus.APPROVED, approvedBy: hostId, approvedAt: new Date(),
      actualStart: new Date(now - 30 * 60 * 1000),
      scheduledStart: new Date(now - 30 * 60 * 1000),
      scheduledEnd: new Date(now + 60 * 60 * 1000),
      maxParticipants: 100,
      metadata: { e2e: TAG },
    },
    select: { id: true },
  })
  // Two fired hooks (direct rows — equivalent to createHook + fireHook).
  for (const [i, prompt] of [
    'Target IOP in advanced primary open angle glaucoma is typically below 12 mmHg.',
    'Which class is first-line medical therapy for primary open angle glaucoma?',
  ].entries()) {
    await db.liveHook.create({
      data: {
        sessionId: s.id,
        createdById: hostId,
        kind: i === 0 ? LiveHookKind.TRUE_FALSE : LiveHookKind.POLL,
        prompt,
        options: i === 0 ? ['True', 'False'] : ['Prostaglandin analogue', 'Oral acetazolamide', 'Pilocarpine', 'Steroid drops'],
        scheduledAt: firedAt,
        firedAt,
      },
    })
  }
  await db.sessionParticipant.create({
    data: { sessionId: s.id, userId: residentId, role: 'PARTICIPANT', joinedAt },
  })
  return s.id
}

async function makeQuestionsSession(hostId: string, authorId: string) {
  const now = Date.now()
  const s = await db.teachingSession.create({
    data: {
      title: `${TAG} questions`,
      sessionType: SessionType.LECTURE,
      hostId, proposedBy: hostId, programId: PROGRAM_ID,
      status: SessionStatus.SCHEDULED,
      approvalStatus: SessionApprovalStatus.APPROVED,
      scheduledStart: new Date(now + 24 * 3600 * 1000),
      scheduledEnd: new Date(now + 25 * 3600 * 1000),
      maxParticipants: 100,
      metadata: { e2e: TAG }, // note: NO questionsReviewed flag
    },
    select: { id: true },
  })
  await db.preSessionQuestion.create({
    data: { sessionId: s.id, userId: authorId, content: `${TAG} What is the target IOP in advanced glaucoma?` },
  })
  return s.id
}

export default async function globalSetup() {
  const faculty = await findUser('meera.krishnan@vaidix.local', 'FACULTY')
  const resident = await findUser('arjun.mehta@vaidix.local', 'RESIDENT')

  const now = Date.now()
  const sessionPresent = await makeLiveSessionWithFiredHooks(
    faculty.id, new Date(now - 10 * 60 * 1000), resident.id, // joined 10 min ago (before fire)
  )
  const sessionLate = await makeLiveSessionWithFiredHooks(
    faculty.id, new Date(now), resident.id,                  // joined now (after fire)
  )
  const sessionQuestions = await makeQuestionsSession(faculty.id, resident.id)

  const state = {
    tag: TAG,
    password: PASSWORD,
    facultyEmail: faculty.email,
    residentEmail: resident.email,
    sessionPresent,
    sessionLate,
    sessionQuestions,
    sessionIds: [sessionPresent, sessionLate, sessionQuestions],
  }
  writeFileSync('e2e/.state.json', JSON.stringify(state, null, 2))
  console.log(`[global-setup] seeded ${TAG}: present=${sessionPresent} late=${sessionLate} questions=${sessionQuestions}`)
  await db.$disconnect()
}
