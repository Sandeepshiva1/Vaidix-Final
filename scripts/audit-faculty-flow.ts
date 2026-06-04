// Faculty workflow audit — what can a FACULTY user actually do end-to-end?
// Tests the real paths a teacher would attempt: schedule a session, set
// objectives, upload material, define prerequisites, invite pre-questions.
// Each "✗" is a real product gap, not a test bug.

import {
  db,
  CookieJar,
  ensureUsers,
  jsonPost,
  doFetch,
  login,
  step,
  expect,
  fail,
  summarize,
  cleanupTestSessions,
  TEST_PROGRAM_ID,
} from './e2e-w4-helpers';

const PREFIX = 'facaudit';
const PASSWORD = 'TestPass123!';

async function jsonPatch(jar: CookieJar, path: string, body: unknown) {
  const res = await doFetch(jar, path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, json: text ? JSON.parse(text) : null }; }
  catch { return { status: res.status, json: text }; }
}

async function htmlGet(jar: CookieJar, path: string) {
  const res = await doFetch(jar, path);
  const text = await res.text();
  return { status: res.status, html: text };
}

async function main() {
  // ─── Setup ─────────────────────────────────────────────────────────────
  step('Setup — fixture users + a session where Faculty IS the host');
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
      title: `${PREFIX}-Faculty-as-Host Session`,
      sessionType: 'CASE_CONFERENCE',
      hostId: faculty.id,           // ← Faculty IS the host
      proposedBy: pd.id,
      approvedBy: pd.id,
      approvedAt: new Date(),
      approvalStatus: 'APPROVED',
      visibility: 'OPEN_TO_ALL',
      status: 'SCHEDULED',
      scheduledStart: start,
      scheduledEnd: end,
      maxParticipants: 50,
      recordingEnabled: true,
      consentRequired: false,
      programId: TEST_PROGRAM_ID,
    },
    select: { id: true },
  });
  const sessionId = sess.id;
  expect(true, `session ${sessionId} created with Faculty as host`);

  const facultyJar = new CookieJar();
  await login(facultyJar, users.facultyEmail, PASSWORD);
  expect(true, 'Faculty logged in');

  // ─── 1. Can Faculty schedule a NEW session via the UI/API? ──────────────
  step('FACULTY → POST /api/classroom/sessions (schedule new) — does the API allow it?');
  const newSessPayload = {
    title: `${PREFIX}-Faculty-Initiated`,
    sessionType: 'LECTURE',
    hostId: faculty.id,
    scheduledStart: new Date(Date.now() + 4 * 24 * 3600_000).toISOString(),
    scheduledEnd: new Date(Date.now() + 4 * 24 * 3600_000 + 60 * 60_000).toISOString(),
    visibility: 'OPEN_TO_ALL',
    tags: [],
    maxParticipants: 50,
    recordingEnabled: true,
    consentRequired: true,
    objectives: [{ text: 'Faculty wants to set this objective', blooms: 2 }],
  };
  const create = await jsonPost(facultyJar, '/api/classroom/sessions', newSessPayload);
  expect(
    create.status === 403,
    `${create.status} — Faculty BLOCKED from scheduling (gap if they should be allowed): ${create.json?.error?.message ?? ''}`
  );

  // ─── 2. Can Faculty even reach the schedule form? ───────────────────────
  step('FACULTY → GET /calendar/new — does the schedule form render?');
  const formPage = await htmlGet(facultyJar, '/calendar/new');
  const formAccessible = formPage.status === 200 && formPage.html.includes('Schedule a Live Class');
  // Check the actual gate behaviour at the page level too.
  expect(true, `status=${formPage.status} formAccessible=${formAccessible}`);

  // ─── 3. Faculty as HOST — can they edit objectives on their own session?
  step('FACULTY → PATCH /api/classroom/sessions/[id] objectives (host of session)');
  const patchObj = await jsonPatch(facultyJar, `/api/classroom/sessions/${sessionId}`, {
    objectives: [
      { text: 'Identify the four hallmark slit-lamp findings', blooms: 1 },
      { text: 'Plan EDTA chelation with appropriate dose', blooms: 6 },
    ],
  });
  expect(
    patchObj.status === 200,
    `${patchObj.status} — Faculty (host) can edit objectives via API: ${patchObj.json?.error?.message ?? ''}`
  );

  // ─── 4. Is there a UI surface to edit objectives on an existing session?
  step('FACULTY → GET /classroom/[id] — does the page render an objectives EDIT UI?');
  const sessPage = await htmlGet(facultyJar, `/classroom/${sessionId}`);
  const editorPresent = sessPage.html.includes('objectives-editor');
  const chipListPresent = sessPage.html.includes('objectives-chip-list');
  expect(chipListPresent, `chip-list (read-only) renders on session page: ${chipListPresent}`);
  expect(
    editorPresent,
    `EDIT-OBJECTIVES form is reachable from /classroom/[id]: ${editorPresent} (gap if false)`
  );

  // ─── 5. Faculty as host — can they upload material into the study pack?
  step('FACULTY → POST /api/classroom/sessions/[id]/study-pack/documents — attach a doc');
  // First need to know if there's a doc to attach. Try creating one via the
  // documents API (the supported flow per study-pack-curator code comment).
  step('FACULTY → POST /api/documents — direct upload metadata path?');
  const upload = await jsonPost(facultyJar, '/api/documents', {
    title: `${PREFIX}-Doc`,
    kind: 'PDF',
    s3Key: `documents/raw/${faculty.id}/${PREFIX}-fixture.pdf`,
    sizeBytes: 1234,
    mimeType: 'application/pdf',
    description: 'Faculty pre-class reading',
  });
  expect(
    upload.status === 200 || upload.status === 201,
    `${upload.status} — Faculty doc upload (gap if 4xx): ${JSON.stringify(upload.json?.error ?? upload.json?.ok)}`
  );

  // ─── 6. Pre-questions — who's allowed to submit?
  step('FACULTY → POST /pre-questions — should faculty be able to ask questions?');
  const facultyAsk = await jsonPost(facultyJar, `/api/classroom/sessions/${sessionId}/pre-questions`, {
    content: 'A test pre-question from a Faculty user',
    urgency: 'NORMAL',
  });
  expect(
    [200, 201].includes(facultyAsk.status),
    `${facultyAsk.status} — Faculty can submit pre-questions: ${facultyAsk.json?.error?.message ?? facultyAsk.json?.ok}`
  );

  // Resident path is the canonical one — verify it works.
  const residentJar = new CookieJar();
  await login(residentJar, users.residentEmail, PASSWORD);
  step('RESIDENT → POST /pre-questions (canonical resident path)');
  const residentAsk = await jsonPost(residentJar, `/api/classroom/sessions/${sessionId}/pre-questions`, {
    content: `${PREFIX}-Resident question`,
    urgency: 'NORMAL',
  });
  expect(
    [200, 201].includes(residentAsk.status),
    `${residentAsk.status} — Resident can submit pre-questions: ${residentAsk.json?.error?.message ?? residentAsk.json?.ok}`
  );

  // ─── 7. Prerequisites — is there a typed/structured field anywhere?
  step('Schema check — is there a `prerequisites` field on TeachingSession?');
  const fields = await db.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'teaching_sessions' AND table_schema = 'public'
  `;
  const hasPrereqColumn = fields.some((f) => /prereq/i.test(f.column_name));
  expect(
    hasPrereqColumn,
    `dedicated prerequisites column on teaching_sessions: ${hasPrereqColumn} (false = gap; today prereqs are implicit via pre-readings + pre-cases)`
  );

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  step('Cleanup');
  await db.preSessionQuestion.deleteMany({ where: { sessionId } }).catch(() => {});
  await db.sessionObjectiveAchievement.deleteMany({ where: { sessionId } }).catch(() => {});
  await db.teachingSession.delete({ where: { id: sessionId } });
  await db.$disconnect();
  summarize('Faculty workflow audit');
}

main().catch(async (err) => {
  fail(`unexpected: ${(err as Error).message}\n${(err as Error).stack ?? ''}`);
  await db.$disconnect().catch(() => {});
  summarize('Faculty workflow audit');
});
