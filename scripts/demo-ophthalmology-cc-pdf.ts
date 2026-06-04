// ════════════════════════════════════════════════════════════════════════════
// Demo: Ophthalmology CC + PDF export
// Run: tsx --env-file=.env.local --env-file=.env scripts/demo-ophthalmology-cc-pdf.ts
//
// What it does:
//   1) Seeds an APPROVED session with the demo prefix (real ophthalmology
//      lecture content — glaucoma + cataract + retina).
//   2) Seeds a finalized SessionTranscript with realistic 15-segment script.
//   3) Logs in as faculty, downloads the transcript PDF, saves it to disk,
//      and asserts %PDF magic-bytes + size > 1 KB so you know it's valid.
//   4) Simulates the CC live-stream by POSTing the same segments through
//      /live-captions/ingest (bearer-authed, agent path) so anyone who has
//      the session open in a browser sees the captions appear in the overlay.
//
// The session ID + browser URL is printed at the start so you can open it
// in a browser and watch the captions flow as the script runs.
// ════════════════════════════════════════════════════════════════════════════

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  db,
  ensureUsers,
  cleanupTestSessions,
  login,
  doFetch,
  CookieJar,
  step,
  expect,
  summarize,
  BASE,
  TEST_PROGRAM_ID,
  ensureTestProgram,
} from './e2e-w4-helpers';

const PREFIX = 'demo.cc';
const PASSWORD = 'E2eTest@2026!';
// Host the demo session as the user actually browsing the UI so it appears in
// their Classroom listing. OPEN_TO_ALL sessions only auto-populate the list
// for the host / proposer / cohort members — see visibility.ts:50-51. Override
// via HOST_EMAIL env to host as a different user.
const HOST_EMAIL = process.env.HOST_EMAIL ?? 'meera.krishnan@vaidix.local';
const OUT_DIR = process.env.OUT_DIR ?? 'e:\\tmp\\vaidix-ophthalmology-reference';
const PDF_OUT = join(OUT_DIR, 'transcript.pdf');
const VTT_OUT = join(OUT_DIR, 'captions.vtt');
const SRT_OUT = join(OUT_DIR, 'captions.srt');
const TXT_OUT = join(OUT_DIR, 'transcript.txt');
const JSON_OUT = join(OUT_DIR, 'segments.json');
const README_OUT = join(OUT_DIR, 'README.txt');

// Real ophthalmology lecture script — every segment lands at a 4–6 second clip
// with realistic timing offsets so the live overlay paces itself naturally.
const LECTURE_SEGMENTS: Array<{ startMs: number; durationMs: number; text: string }> = [
  { startMs:    0, durationMs: 5000, text: 'Welcome everyone — today we are covering the management of primary open-angle glaucoma in the Indian population.' },
  { startMs: 5500, durationMs: 5000, text: 'Glaucoma is the second leading cause of irreversible blindness globally, and in India over 12 million people are affected.' },
  { startMs:11000, durationMs: 4500, text: 'The hallmark is progressive optic neuropathy with characteristic visual field loss.' },
  { startMs:16000, durationMs: 5500, text: 'Intraocular pressure above 21 millimeters of mercury is the major modifiable risk factor.' },
  { startMs:22000, durationMs: 5000, text: 'However, normal-tension glaucoma can occur with IOP below this threshold, particularly in Asian populations.' },
  { startMs:27500, durationMs: 4500, text: 'Goldmann applanation tonometry remains the gold standard for accurate IOP measurement.' },
  { startMs:32500, durationMs: 5000, text: 'A cup-to-disc ratio greater than 0.7, or marked asymmetry between the two eyes, warrants further evaluation.' },
  { startMs:38000, durationMs: 5000, text: 'OCT of the retinal nerve fiber layer detects structural damage before visual field loss becomes apparent.' },
  { startMs:43500, durationMs: 5000, text: 'Humphrey visual field testing reveals arcuate scotomas and nasal step defects in early disease.' },
  { startMs:49000, durationMs: 5500, text: 'First-line pharmacotherapy is a prostaglandin analogue — latanoprost 0.005% once nightly reduces IOP by 25 to 35 percent.' },
  { startMs:55000, durationMs: 5000, text: 'For patients with adherence concerns, selective laser trabeculoplasty offers a durable alternative.' },
  { startMs:60500, durationMs: 5000, text: 'Trabeculectomy with mitomycin C is reserved for medically uncontrolled progression.' },
  { startMs:66000, durationMs: 5500, text: 'Post-operative complications include hypotony, choroidal detachment, and bleb-related endophthalmitis.' },
  { startMs:72000, durationMs: 5000, text: 'Lifelong follow-up with optic disc photography and OCT every six months is essential.' },
  { startMs:77500, durationMs: 6000, text: 'Case discussion: a 48-year-old presents with IOP 26 bilaterally, CDR 0.8, and arcuate field defect — what is your next step?' },
];

const FULL_TRANSCRIPT_TEXT = LECTURE_SEGMENTS.map((s) => s.text).join(' ');

function fmtVttTime(ms: number): string {
  const total = Math.floor(ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const f = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

function fmtSrtTime(ms: number): string {
  return fmtVttTime(ms).replace('.', ',');
}

function buildVtt(segs: Array<{ startMs: number; durationMs: number; text: string }>): string {
  const lines = ['WEBVTT', ''];
  segs.forEach((s, i) => {
    lines.push(String(i + 1));
    lines.push(`${fmtVttTime(s.startMs)} --> ${fmtVttTime(s.startMs + s.durationMs)}`);
    lines.push(s.text);
    lines.push('');
  });
  return lines.join('\n');
}

function buildSrt(segs: Array<{ startMs: number; durationMs: number; text: string }>): string {
  const lines: string[] = [];
  segs.forEach((s, i) => {
    lines.push(String(i + 1));
    lines.push(`${fmtSrtTime(s.startMs)} --> ${fmtSrtTime(s.startMs + s.durationMs)}`);
    lines.push(s.text);
    lines.push('');
  });
  return lines.join('\n');
}

async function bootstrapCsrf(jar: CookieJar) {
  await doFetch(jar, '/api/csrf');
}

async function run() {
  await ensureTestProgram();
  const users = await ensureUsers(PREFIX, PASSWORD);
  await cleanupTestSessions(PREFIX);

  // Use the user actually browsing the UI as host so the session shows up
  // in their Classroom listing. Fall back to the demo faculty if HOST_EMAIL
  // can't be resolved.
  const host = await db.user.findUnique({
    where: { email: HOST_EMAIL },
    select: { id: true, email: true, name: true, activeProgramId: true },
  });
  if (!host) {
    throw new Error(
      `Host user ${HOST_EMAIL} not found. Override with HOST_EMAIL=<email> ` +
      `or seed that user first.`,
    );
  }
  const proposer = await db.user.findUnique({
    where: { email: users.pdEmail },
    select: { id: true },
  });
  if (!proposer) throw new Error('PD fixture user missing');
  const programId = host.activeProgramId ?? TEST_PROGRAM_ID;

  const facultyJar = new CookieJar();
  await login(facultyJar, users.facultyEmail, PASSWORD);
  await bootstrapCsrf(facultyJar);

  step(`Creating LIVE session hosted by ${host.name ?? host.email}`);
  const start = new Date(Date.now() - 5 * 60_000);
  const end = new Date(start.getTime() + 90 * 60_000);
  const created = await db.teachingSession.create({
    data: {
      title: `${PREFIX} Glaucoma Management Lecture`,
      sessionType: 'LECTURE',
      hostId: host.id,
      proposedBy: proposer.id,
      approvedBy: proposer.id,
      approvedAt: new Date(),
      approvalStatus: 'APPROVED',
      visibility: 'OPEN_TO_ALL',
      status: 'LIVE',
      scheduledStart: start,
      scheduledEnd: end,
      actualStart: start,
      maxParticipants: 50,
      recordingEnabled: true,
      consentRequired: false,
      programId,
      metadata: { captionsProfile: 'english-only' },
    },
    select: { id: true },
  });
  const sessionId = created.id;
  process.stdout.write(`     session id: ${sessionId}\n`);
  process.stdout.write(`     host:       ${host.name} <${host.email}>\n`);
  process.stdout.write(`     program:    ${programId}\n`);
  process.stdout.write(`     open in your browser (logged in as ${host.email}):\n`);
  process.stdout.write(`         ${BASE}/classroom/${sessionId}\n`);
  process.stdout.write(`     it will also appear under Classroom → Live tab.\n\n`);

  step('Seeding finalized SessionTranscript with the lecture segments');
  const segments = LECTURE_SEGMENTS.map((s) => ({
    startMs: s.startMs,
    endMs: s.startMs + s.durationMs,
    text: s.text,
    lang: 'en',
    speakerName: 'Faculty',
    confidence: 0.95,
  }));
  const tx = await db.sessionTranscript.upsert({
    where: { sessionId_language: { sessionId, language: 'en' } },
    create: {
      sessionId,
      language: 'en',
      source: 'deepgram',
      segments: segments as object,
      contentText: FULL_TRANSCRIPT_TEXT,
      finalized: true,
      finalizedAt: new Date(),
    },
    update: {
      segments: segments as object,
      contentText: FULL_TRANSCRIPT_TEXT,
      finalized: true,
      finalizedAt: new Date(),
    },
    select: { id: true },
  });
  expect(!!tx.id, `transcript seeded (id=${tx.id})`);

  step('Downloading transcript PDF');
  const pdfRes = await doFetch(facultyJar, `/api/classroom/sessions/${sessionId}/captions/transcript/export-pdf`);
  expect(pdfRes.status === 200, `PDF endpoint returned 200 (got ${pdfRes.status})`);
  const ct = pdfRes.headers.get('content-type') ?? '';
  expect(ct.includes('application/pdf'), `content-type is application/pdf (got "${ct}")`);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  expect(pdfBuf.byteLength > 1000, `PDF size > 1 KB (got ${pdfBuf.byteLength} bytes)`);
  expect(pdfBuf.subarray(0, 4).toString('utf8') === '%PDF', 'PDF magic bytes "%PDF" present');

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(PDF_OUT, pdfBuf);
  process.stdout.write(`     ✓ PDF saved to: ${PDF_OUT}\n`);

  step('Saving CC reference package (VTT + SRT + TXT + JSON) for future reference');
  await writeFile(VTT_OUT, buildVtt(LECTURE_SEGMENTS), 'utf8');
  await writeFile(SRT_OUT, buildSrt(LECTURE_SEGMENTS), 'utf8');
  await writeFile(TXT_OUT, FULL_TRANSCRIPT_TEXT, 'utf8');
  await writeFile(JSON_OUT, JSON.stringify({ sessionId, segments: LECTURE_SEGMENTS }, null, 2), 'utf8');
  const readme = [
    'VAIDIX — Sample Ophthalmology Lecture (Glaucoma Management)',
    '═══════════════════════════════════════════════════════════',
    '',
    `Session ID: ${sessionId}`,
    `Browser:    ${BASE}/classroom/${sessionId}`,
    `Login:      ${users.facultyEmail} / ${PASSWORD}`,
    '',
    'Files in this folder:',
    '  • transcript.pdf  — formatted A4 PDF with timestamps + LVPEI header',
    '                      (generated by /api/.../captions/transcript/export-pdf)',
    '  • captions.vtt    — WebVTT subtitle file (drop into <video> as <track>)',
    '  • captions.srt    — SubRip subtitle file (compatible with VLC, mpv, etc.)',
    '  • transcript.txt  — plain text transcript (no timestamps)',
    '  • segments.json   — raw segment data with startMs/durationMs/text',
    '',
    'How to attach these to a real recorded video later:',
    '  • The VTT file pairs with any HTML5 <video> element:',
    '       <video src="lecture.mp4">',
    '         <track default kind="captions" src="captions.vtt" srclang="en">',
    '       </video>',
    '  • VLC: drag the .srt file onto the playing video, or use Subtitle > Add.',
    '  • Final Cut / Premiere: import the .srt as a captions track.',
    '',
    'Generated on: ' + new Date().toISOString(),
  ].join('\n');
  await writeFile(README_OUT, readme, 'utf8');
  process.stdout.write(`     ✓ VTT  saved: ${VTT_OUT}\n`);
  process.stdout.write(`     ✓ SRT  saved: ${SRT_OUT}\n`);
  process.stdout.write(`     ✓ TXT  saved: ${TXT_OUT}\n`);
  process.stdout.write(`     ✓ JSON saved: ${JSON_OUT}\n`);
  process.stdout.write(`     ✓ README:    ${README_OUT}\n`);

  step('Live captions broadcast (skipped — requires LiveKit Agent + Deepgram key)');
  process.stdout.write(`     Live captions are produced out-of-process by vaidix-captions-agent\n`);
  process.stdout.write(`     (Python LiveKit Agent — joins each LIVE room hidden, streams audio to\n`);
  process.stdout.write(`     Deepgram, POSTs finalized utterances to /live-captions/ingest).\n`);
  process.stdout.write(`     To see CC live in your browser:\n`);
  process.stdout.write(`       1. Set DEEPGRAM_API_KEY + LIVE_CAPTIONS_INGEST_SECRET in .env.local\n`);
  process.stdout.write(`       2. docker compose -f docker-compose.dev.yml up -d vaidix-captions-agent\n`);
  process.stdout.write(`       3. Open the session URL above and join from any role — captions appear\n`);
  process.stdout.write(`          for ANY speaker (not just the host) as soon as they unmute.\n\n`);

  process.stdout.write(`     Session ID for manual exploration: ${sessionId}\n`);
  process.stdout.write(`     Browser URL: ${BASE}/classroom/${sessionId}\n`);
  process.stdout.write(`     Direct PDF URL: ${BASE}/api/classroom/sessions/${sessionId}/captions/transcript/export-pdf\n\n`);

  await db.$disconnect();
  summarize('demo: ophthalmology CC + PDF');
}

run().catch(async (err) => {
  process.stderr.write(`\nFATAL: ${(err as Error).stack ?? String(err)}\n`);
  await db.$disconnect();
  process.exit(1);
});
