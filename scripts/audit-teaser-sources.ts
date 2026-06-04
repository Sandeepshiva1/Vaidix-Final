// Teaser source pipeline audit — confirm the AI now sees:
//   1. Objectives (text + Bloom's level)
//   2. Study pack documents + pre-cases (titles, kind)
//   3. Top pre-questions (content, votes)
//   4. Tags
// AND that this same data is queryable via the curator-facing
// GET /api/promo/teaser-video/sources endpoint.

import {
  db,
  CookieJar,
  ensureUsers,
  jsonGet,
  login,
  step,
  expect,
  fail,
  summarize,
  cleanupTestSessions,
  TEST_PROGRAM_ID,
} from './e2e-w4-helpers';
import { gatherTeaserSources } from '../src/server/services/promo/teaser-sources';

const PREFIX = 'teaserss';
const PASSWORD = 'TestPass123!';

async function main() {
  step('Setup — fixtures + Faculty session with rich signals');
  const users = await ensureUsers(PREFIX, PASSWORD);
  await cleanupTestSessions(`${PREFIX}-`);
  const faculty = await db.user.findUnique({ where: { email: users.facultyEmail }, select: { id: true } });
  const pd = await db.user.findUnique({ where: { email: users.pdEmail }, select: { id: true } });
  const resident = await db.user.findUnique({ where: { email: users.residentEmail }, select: { id: true } });
  if (!faculty || !pd || !resident) throw new Error('users');

  const start = new Date(Date.now() + 3 * 24 * 3600_000);
  const end = new Date(start.getTime() + 60 * 60_000);
  const sess = await db.teachingSession.create({
    data: {
      title: `${PREFIX}-Band Keratopathy`,
      description: 'A focused review of band keratopathy with EDTA chelation outcomes.',
      sessionType: 'CASE_CONFERENCE',
      hostId: faculty.id, proposedBy: pd.id, approvedBy: pd.id, approvedAt: new Date(),
      approvalStatus: 'APPROVED', visibility: 'OPEN_TO_ALL', status: 'SCHEDULED',
      scheduledStart: start, scheduledEnd: end,
      maxParticipants: 50, recordingEnabled: true, consentRequired: false,
      programId: TEST_PROGRAM_ID,
      tags: ['cornea', 'anterior-segment'],
      objectives: [
        { id: 'obj-aaa', text: 'Identify the four hallmark slit-lamp findings of band keratopathy', blooms: 1, epaTag: null },
        { id: 'obj-bbb', text: 'Differentiate calcific vs lipid keratopathy on history', blooms: 4, epaTag: null },
        { id: 'obj-ccc', text: 'Plan first-line treatment with EDTA chelation', blooms: 6, epaTag: null },
      ] as never,
    },
    select: { id: true },
  });
  const sessionId = sess.id;
  expect(true, `session ${sessionId} created`);

  // Seed a pre-session document
  const seededDoc = await db.document.create({
    data: {
      uploadedById: faculty.id,
      title: `${PREFIX}-Slit-Lamp Atlas — Band Keratopathy`,
      description: 'Reference reading',
      kind: 'PDF',
      route: 'REFERENCE',
      s3Key: `documents/raw/${faculty.id}/${PREFIX}-fixture.pdf`,
      sizeBytes: BigInt(12_345),
      mimeType: 'application/pdf',
      status: 'PRIVATE_FACULTY',
      visibility: 'PRIVATE_FACULTY',
      sessionLinks: { create: { sessionId, linkedById: faculty.id, isPreSession: true, preSessionRank: 1 } },
    },
    select: { id: true },
  });
  expect(true, `seeded study-pack doc ${seededDoc.id}`);

  // Seed pre-questions from residents
  await db.preSessionQuestion.createMany({
    data: [
      { sessionId, userId: resident.id, content: 'What is the EDTA dose for an adult cornea?', voteCount: 7 },
      { sessionId, userId: resident.id, content: 'How do you differentiate calcific from lipid on slit-lamp alone?', voteCount: 5 },
      { sessionId, userId: resident.id, content: 'Is amniotic membrane needed routinely after EDTA?', voteCount: 3 },
    ],
  });
  expect(true, 'seeded 3 pre-questions');

  // ─── 1. Service-level source gathering ────────────────────────────────────
  step('Service: gatherTeaserSources picks up every signal');
  const sources = await gatherTeaserSources(sessionId);
  if (!sources) {
    fail('gatherTeaserSources returned null');
    summarize('Teaser source pipeline');
    return;
  }
  expect(sources.objectives.length === 3, `objectives count = 3 (got ${sources.objectives.length})`);
  expect(sources.objectives[0].blooms === 1, `first objective Bloom level = 1`);
  expect(sources.studyMaterial.length >= 1, `at least 1 study-material item (got ${sources.studyMaterial.length})`);
  expect(sources.studyMaterial[0].title.includes('Slit-Lamp Atlas'), `study material title carries through`);
  expect(sources.topPreQuestions.length === 3, `3 pre-questions (got ${sources.topPreQuestions.length})`);
  expect(
    sources.topPreQuestions[0].voteCount === 7,
    `top question is the 7-vote one (got ${sources.topPreQuestions[0].voteCount})`
  );
  expect(sources.tags.includes('cornea'), `tag "cornea" present`);
  expect(sources.counts.preQuestions === 3, `total pre-question count = 3`);

  // ─── 2. API: GET /api/promo/teaser-video/sources ─────────────────────────
  step('API: GET /api/promo/teaser-video/sources?sessionId=...');
  const facultyJar = new CookieJar();
  const residentJar = new CookieJar();
  await login(facultyJar, users.facultyEmail, PASSWORD);
  await login(residentJar, users.residentEmail, PASSWORD);

  const got = await jsonGet(facultyJar, `/api/promo/teaser-video/sources?sessionId=${sessionId}`);
  expect(got.status === 200, `${got.status}`);
  const apiSources = got.json?.data?.sources;
  expect(apiSources?.counts?.objectives === 3, `API counts.objectives = 3`);
  expect(apiSources?.counts?.studyMaterial >= 1, `API counts.studyMaterial >= 1`);
  expect(apiSources?.counts?.preQuestions === 3, `API counts.preQuestions = 3`);
  expect(
    apiSources?.topPreQuestions?.[0]?.voteCount === 7,
    `API surfaces top-voted question first`
  );

  step('API: Resident BLOCKED from previewing teaser sources');
  const denied = await jsonGet(residentJar, `/api/promo/teaser-video/sources?sessionId=${sessionId}`);
  expect(denied.status === 403, `${denied.status} for resident (expected 403)`);

  // ─── 3. Heuristic fallback uses the signals ───────────────────────────────
  // (Without GEMINI_API_KEY, buildCopy falls through to heuristicCopy; we can
  //  inspect what subtitle + hook look like by importing the module directly.)
  step('Service: buildCopy via heuristic now uses real signals (no Gemini)');
  const { buildCopy } = await import('../src/server/services/promo/promo-service');
  const copy = await buildCopy({
    title: sources.title,
    description: sources.description,
    hostName: sources.hostName,
    scheduledStart: sources.scheduledStart,
    objectives: sources.objectives,
    studyMaterial: sources.studyMaterial,
    topPreQuestions: sources.topPreQuestions,
    tags: sources.tags,
  });
  // Heuristic should pick the first objective as subtitle and the top
  // pre-question as the hook. If GEMINI_API_KEY is set, this will actually
  // call Gemini — both outcomes are acceptable; we just verify the copy is
  // grounded in the signals (subtitle echoes objective OR mentions content).
  const subtitleLooksGrounded =
    copy.subtitle.toLowerCase().includes('slit-lamp') ||
    copy.subtitle.toLowerCase().includes('keratopathy') ||
    copy.subtitle.toLowerCase().includes('edta') ||
    copy.subtitle.toLowerCase().includes('cornea');
  expect(
    subtitleLooksGrounded,
    `subtitle is grounded in the actual session content (got: "${copy.subtitle}")`
  );
  const hookLooksGrounded =
    copy.hook.toLowerCase().includes('edta') ||
    copy.hook.toLowerCase().includes('calcific') ||
    copy.hook.toLowerCase().includes('amniotic') ||
    copy.hook.toLowerCase().includes('slit') ||
    copy.hook.toLowerCase().includes('cornea');
  expect(
    hookLooksGrounded,
    `hook reflects a real resident question (got: "${copy.hook}")`
  );
  console.log(`     [debug] copy.source=${copy.source} subtitle="${copy.subtitle}" hook="${copy.hook}"`);

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  step('Cleanup');
  await db.preSessionQuestion.deleteMany({ where: { sessionId } });
  await db.documentSessionLink.deleteMany({ where: { sessionId } });
  await db.document.delete({ where: { id: seededDoc.id } });
  await db.teachingSession.delete({ where: { id: sessionId } });
  await db.$disconnect();
  summarize('Teaser source pipeline');
}

main().catch(async (err) => {
  fail(`unexpected: ${(err as Error).message}\n${(err as Error).stack ?? ''}`);
  await db.$disconnect().catch(() => {});
  summarize('Teaser source pipeline');
});
