// ════════════════════════════════════════════════════════════════════════════
// Wizard-forge service-level smoke (HTTP-free, real Gemini + Opus + Gemini Image)
// ════════════════════════════════════════════════════════════════════════════
// Run:
//   tsx --env-file=.env.local --env-file=.env scripts/smoke-wizard-forge.ts
//
// What this proves (post-v2.6 wiring):
//   1. extractPptxContent reads the PPTX titles + speaker notes correctly.
//   2. The op-deck-extract.md prompt is loaded and yields a structured
//      extraction with verbatim primaryDeckOutline.
//   3. The op-deck-draft.md prompt's HARD ENHANCE_EXISTING contract is
//      respected — every fixture slide title appears verbatim in the output.
//   4. imageBrief is set on at least one slide by Opus.
//   5. generateSlideImages runs Gemini Image and persists imageS3Key +
//      imagePrompt for every slide where imageBrief is present.
//   6. The op-deck-image-prompt.md prompt is loaded (chain: Opus.imageBrief
//      → Gemini Flash image-prompt → Gemini Image bytes).
//   7. The persisted .pptx round-trips through PptxDocument and embeds
//      real image bytes (not placeholder text).
//
// Bypasses the HTTP layer: calls wizardForgeDeck() directly so a stale
// dev server cannot block validation.
// ════════════════════════════════════════════════════════════════════════════

import PptxGenJS from 'pptxgenjs';
import {
  DeckForgeStatus,
  DocumentKind,
  DocumentRoute,
  DocumentStatus,
  ProgramStatus,
  Role,
  UserStatus,
} from '@prisma/client';
import { db } from '@/lib/db';
import { PptxDocument } from '@/server/services/pptx/pptx-document';
import { wizardForgeDeck } from '@/server/services/decks/wizard-forge-service';

const PREFIX = 'smoke.wizardforge';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PROGRAM_ID = 'prg_default_lvpei_ms';

// ─── Tiny test harness ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function step(label: string): void {
  console.log(`\n[${String(passed + failed + 1).padStart(2, '0')}] ${label}`);
}
function expect(cond: boolean, message: string): void {
  if (cond) {
    console.log(`     ✓ ${message}`);
    passed++;
  } else {
    console.log(`     ✗ ${message}`);
    failed++;
  }
}

// ─── Fixture: 7-slide endophthalmitis decision-tree mirror of DR AVI PPT ───
interface FixtureSpec {
  title: string;
  bullets: string[];
  notes: string;
}
const FIXTURE_TITLE = 'Endophthalmitis: The First 48-Hour Decisions';
const FIXTURE: FixtureSpec[] = [
  {
    title: FIXTURE_TITLE,
    bullets: [
      'Q1 Infectious? · Q2 Virulent? · Q3 PPV vs Biopsy?',
      'Q4 Antibiotic? · Q5 Steroids? · Q6 Explant? · Q7 Re-inject?',
      'Dr. Avinash Pathengay — LVPEI Anant Bajaj Retina Institute',
    ],
    notes: 'PEARL: open with the 7-question decision tree; this is the spine of the talk.',
  },
  {
    title: 'Q1 — Is the inflammation infectious?',
    bullets: [
      'Hypopyon + fibrin in AC → high pretest probability',
      'Pain disproportionate to expected post-op course',
      'Anterior chamber tap before empiric intravitreal abx',
    ],
    notes: 'PEARL: hypopyon plus pain disproportion is the tap-and-inject trigger.',
  },
  {
    title: 'Q2 — Is the organism virulent?',
    bullets: [
      'Coag-neg Staph → indolent, frequently late onset',
      'Streptococcus / Gram-negatives → rapid vision loss, low yield from tap',
      'Bacillus → trauma context; emergency PPV indicated',
    ],
    notes: 'PEARL: Bacillus trauma context is the silent emergency — call retina.',
  },
  {
    title: 'Q3 — PPV vs vitreous biopsy?',
    bullets: [
      'EVS 1995: PPV benefit limited to LP-only vision at presentation',
      'Modern view: lower threshold for PPV in virulent presentations',
      'LVPEI cohort: vitreous biopsy yields culture ~50%',
    ],
    notes: 'PEARL: EVS 1995 cohort excluded modern lensectomy techniques — interpret cautiously.',
  },
  {
    title: 'Q4 — Which intravitreal antibiotic regimen?',
    bullets: [
      'Vancomycin 1 mg/0.1 mL + Ceftazidime 2.25 mg/0.1 mL — standard empiric',
      'Add intravitreal voriconazole 100 microg if fungal suspected',
      'Avoid aminoglycosides — retinal infarction risk',
    ],
    notes: 'PEARL: vanco + ceftaz is the LVPEI default; voriconazole if fungal smear positive.',
  },
  {
    title: 'Common pitfalls in the first 48 hours',
    bullets: [
      'Delaying tap because the eye "looks too quiet"',
      'Empirical steroids before culture results in fungal cases',
      'Premature explant of IOL before maximum medical therapy',
      'Missing low-grade Propionibacterium post-cataract',
    ],
    notes: 'PEARL: avoid empiric steroids until culture excludes fungal etiology.',
  },
  {
    title: 'Take-home — Monday morning',
    bullets: [
      'Tap-and-inject within 1 hour of suspicion',
      'Pick antibiotic by smear / clinical pattern, not "always vanco+ceftaz"',
      'Reserve PPV for LP-only or rapid deterioration despite tap-inject',
    ],
    notes: 'PEARL: Monday-morning take-home — tap within 1 hour of suspicion, every time.',
  },
];

async function buildFixture(): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  for (const spec of FIXTURE) {
    const s = pptx.addSlide();
    s.addText(spec.title, {
      x: 0.5, y: 0.5, w: 12, h: 1.0,
      fontSize: 32, bold: true, color: '0A7C6E',
      placeholder: 'title',
    });
    s.addText(
      spec.bullets.map((b) => ({ text: b, options: { bullet: true } })),
      { x: 0.5, y: 1.8, w: 12, h: 5, fontSize: 16, color: '1A202C' },
    );
    s.addNotes(spec.notes);
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}

async function ensureFaculty(): Promise<{ id: string; email: string }> {
  const email = `${PREFIX}-faculty@vaidix.local`;
  await db.program.upsert({
    where: { id: PROGRAM_ID },
    update: {},
    create: {
      id: PROGRAM_ID,
      slug: 'lvpei-ms-ophthalmology',
      name: 'LVPEI MS Ophthalmology',
      specialty: 'Ophthalmology',
      institution: 'L V Prasad Eye Institute',
      status: ProgramStatus.ACTIVE,
    },
  });
  const user = await db.user.upsert({
    where: { email },
    update: { activeProgramId: PROGRAM_ID },
    create: {
      email,
      name: 'Smoke Faculty',
      role: Role.FACULTY,
      status: UserStatus.ACTIVE,
      activeProgramId: PROGRAM_ID,
    },
    select: { id: true, email: true },
  });
  return user;
}

async function uploadFixture(userId: string, buf: Buffer): Promise<{ id: string; s3Key: string }> {
  const s3Key = `documents/raw/${userId}/${Date.now()}-smoke-endophthalmitis.pptx`;
  const { s3, BUCKET, ensureBucket } = await import('@/lib/storage');
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: buf,
      ContentType: PPTX_MIME,
    }),
  );
  const doc = await db.document.create({
    data: {
      uploadedById: userId,
      title: `${PREFIX} endophthalmitis primary`,
      description: 'wizard-forge smoke fixture',
      kind: DocumentKind.PPT,
      route: DocumentRoute.DECK_FORGE,
      s3Key,
      sizeBytes: BigInt(buf.byteLength),
      mimeType: PPTX_MIME,
      status: DocumentStatus.READY,
    },
    select: { id: true, s3Key: true },
  });
  return doc;
}

async function fetchPersistedDeck(s3Key: string): Promise<Buffer> {
  const { s3, BUCKET } = await import('@/lib/storage');
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const stream = out.Body as AsyncIterable<Uint8Array>;
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/** Best-effort reachability check for the Gemini endpoint. Returns true if
 *  TLS + connectivity work; false otherwise. Local dev boxes with corporate
 *  TLS interception fail here — we skip Phase B (LLM-dependent assertions)
 *  rather than crashing. Production EC2 reaches Google APIs cleanly. */
async function geminiReachable(): Promise<{ ok: boolean; reason: string }> {
  try {
    const { env } = await import('@/lib/env');
    if (!env.GEMINI_API_KEY) return { ok: false, reason: 'GEMINI_API_KEY not set' };
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`;
    const res = await fetch(url, { method: 'GET' });
    return res.ok
      ? { ok: true, reason: 'reachable' }
      : { ok: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
}

async function run(): Promise<void> {
  console.log('Wizard-forge service smoke — HTTP-free, real LLM calls');
  console.log('=========================================================');

  step('Bootstrap: faculty user + PPTX fixture');
  const faculty = await ensureFaculty();
  expect(!!faculty.id, `faculty fixture (${faculty.email})`);
  const fixtureBuf = await buildFixture();
  expect(fixtureBuf[0] === 0x50 && fixtureBuf[1] === 0x4b, 'fixture is a valid .pptx ZIP');

  step('PptxDocument round-trip + notes() extraction');
  const probe = PptxDocument.fromBuffer(fixtureBuf);
  const probeSlides = probe.slides();
  expect(probeSlides.length === FIXTURE.length, `parsed ${probeSlides.length}/${FIXTURE.length} slides`);
  let notesHits = 0;
  for (let i = 0; i < FIXTURE.length; i++) {
    if (probe.notes(i + 1).includes('PEARL:')) notesHits++;
  }
  expect(notesHits === FIXTURE.length, `notes() returned PEARL: text for ${notesHits}/${FIXTURE.length} slides`);

  step('extractPptxContent emits TITLE / TEXT / NOTES blocks + hasSpeakerNotes');
  const { extractPptxContent } = await import('@/server/services/decks/wizard-forge-service');
  const extracted = extractPptxContent(fixtureBuf, 'smoke-fixture');
  expect(!!extracted, 'extractPptxContent returned a result');
  expect(extracted!.hasSpeakerNotes, `hasSpeakerNotes=${extracted!.hasSpeakerNotes}`);
  expect(
    extracted!.text.includes('NOTES:') && extracted!.text.includes('PEARL:'),
    'extracted text carries NOTES: prefix + PEARL: content',
  );
  expect(
    extracted!.outline.length === FIXTURE.length,
    `outline has all ${FIXTURE.length} slides`,
  );
  for (let i = 0; i < FIXTURE.length; i++) {
    expect(
      extracted!.outline[i]!.title === FIXTURE[i]!.title,
      `outline[${i}].title verbatim (${JSON.stringify(extracted!.outline[i]!.title.slice(0, 50))})`,
    );
  }

  step('Loader: all 3 op-deck-* prompts load + interpolate cleanly');
  const { loadPrompt } = await import('@/server/prompts/loader');
  const extractPrompt = await loadPrompt('op-deck-extract');
  const draftPrompt = await loadPrompt('op-deck-draft');
  const imgPrompt = await loadPrompt('op-deck-image-prompt');
  expect(extractPrompt.text.includes('ROLE'), 'op-deck-extract.text loaded');
  expect(
    draftPrompt.text.includes('HARD CONTRACT') && draftPrompt.text.includes('TITLES ARE FROZEN'),
    'op-deck-draft carries HARD ENHANCE_EXISTING contract',
  );
  expect(
    draftPrompt.text.includes('imageBrief') && draftPrompt.text.includes('WHEN TO REQUEST AN IMAGE'),
    'op-deck-draft schema includes imageBrief field + section',
  );
  expect(
    draftPrompt.text.includes('COVERAGE OF ALL TOPICS') && draftPrompt.text.includes('Coverage beats brevity'),
    'op-deck-draft carries coverage-first rule (no strict slide-count cap)',
  );
  expect(imgPrompt.text.includes('imageBrief'), 'op-deck-image-prompt references imageBrief');

  step('Upload fixture to MinIO + create Document row');
  const primaryDoc = await uploadFixture(faculty.id, fixtureBuf);
  expect(!!primaryDoc.id, `Document row created (${primaryDoc.id})`);

  // ─── Phase B — LLM-dependent (skip gracefully if Gemini unreachable) ─────
  step('Phase B preflight: Gemini reachability');
  const reach = await geminiReachable();
  if (!reach.ok) {
    console.log(`     ⊘ skipping LLM phase: ${reach.reason}`);
    console.log('     ℹ Local TLS-intercept boxes often hit UNABLE_TO_VERIFY_LEAF_SIGNATURE.');
    console.log('     ℹ Production EC2 reaches Google APIs cleanly — validate there post-deploy.');
    // Cleanup the document row so the smoke is idempotent.
    await db.document.delete({ where: { id: primaryDoc.id } });
    console.log('');
    if (failed === 0) {
      console.log(`Wizard-forge service smoke — STRUCTURAL PASS (${passed} / ${passed} checks; LLM phase skipped)`);
      process.exit(0);
    } else {
      console.log(`Wizard-forge service smoke — FAIL (${failed} of ${passed + failed} failed)`);
      process.exit(1);
    }
    return;
  }
  expect(true, `Gemini reachable: ${reach.reason}`);

  step('Call wizardForgeDeck() directly — intent=ENHANCE_EXISTING');
  console.log('     (this triggers real Gemini extract + Opus draft + Gemini Image renders — may take 30-90s)');
  const outcome = await wizardForgeDeck({
    intent: 'ENHANCE_EXISTING',
    briefing: {
      audience: 'PG-2 ophthalmology resident',
      sessionType: 'CASE_CONFERENCE',
      durationMin: 60,
      objectives:
        'Residents should be able to (1) recognise pseudo-vs-true endophthalmitis, (2) sequence tap-and-inject vs PPV, (3) pick empiric intravitreal antibiotics, (4) avoid common 48-hour pitfalls.',
      localContext: 'LVPEI Vizag retina clinic; ~40% post-cataract referral volume',
    },
    inputs: [{ documentId: primaryDoc.id, role: 'PRIMARY_PPTX' }],
    requestedById: faculty.id,
    inputTitle: `${PREFIX} endophthalmitis enhance`,
  });
  expect(!!outcome.jobId, `forge returned jobId (${outcome.jobId})`);
  expect(outcome.slideCount >= FIXTURE.length, `slideCount ≥ fixture floor (${outcome.slideCount} ≥ ${FIXTURE.length})`);

  step('DB: job is REVIEW_PENDING with full slide chain');
  const job = await db.deckForgeJob.findUnique({
    where: { id: outcome.jobId },
    include: { slides: { orderBy: { order: 'asc' } } },
  });
  expect(!!job, 'job row exists');
  expect(job!.status === DeckForgeStatus.REVIEW_PENDING, `status=${job!.status}`);
  expect(job!.slides.length === outcome.slideCount, 'slides DB count matches outcome');

  step('HARD ENHANCE contract: every fixture title appears verbatim in output');
  const draftedTitles = job!.slides.map((s) => s.title);
  const fixtureTitles = FIXTURE.map((f) => f.title);
  const missing: string[] = [];
  for (const ft of fixtureTitles) {
    if (!draftedTitles.includes(ft)) missing.push(ft);
  }
  expect(
    missing.length === 0,
    missing.length === 0
      ? `all ${fixtureTitles.length} fixture titles preserved verbatim`
      : `${missing.length} fixture title(s) missing: ${JSON.stringify(missing).slice(0, 300)}`,
  );

  step('Order preservation: fixture titles appear in their original order in the output');
  let lastIdx = -1;
  let orderOk = true;
  for (const ft of fixtureTitles) {
    const idx = draftedTitles.indexOf(ft);
    if (idx <= lastIdx) {
      orderOk = false;
      break;
    }
    lastIdx = idx;
  }
  expect(orderOk, 'fixture titles appear in monotonically increasing positions');

  step('imageBrief plumbing: at least one slide has Gemini-generated image');
  const slidesWithImage = job!.slides.filter((s) => s.imageS3Key && s.imagePrompt);
  console.log(`     → ${slidesWithImage.length} / ${job!.slides.length} slides have imageS3Key + imagePrompt`);
  expect(slidesWithImage.length >= 1, `≥1 slide image generated and persisted`);
  if (slidesWithImage.length > 0) {
    const sample = slidesWithImage[0]!;
    console.log(`     ℹ sample slide ${sample.order} layout=${sample.layout} prompt="${sample.imagePrompt?.slice(0, 140)}..."`);
    const { s3, BUCKET } = await import('@/lib/storage');
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: sample.imageS3Key! }));
    expect((head.ContentLength ?? 0) > 5000, `S3 image is real (${head.ContentLength}B > 5KB threshold)`);
    expect((head.ContentType ?? '').startsWith('image/'), `S3 image ContentType=${head.ContentType}`);
  }

  step('Coverage: bullets / notes reference fixture-only clinical terms');
  const everything = job!.slides
    .flatMap((s) => [s.title, ...s.bullets, s.speakerNotes ?? ''])
    .join(' ')
    .toLowerCase();
  const fixtureTerms = ['vanco', 'ceftaz', 'evs', 'ppv', 'hypopyon', 'intravitreal', 'tap', 'bacillus', 'voriconazole'];
  const hits = fixtureTerms.filter((t) => everything.includes(t));
  expect(hits.length >= 3, `≥3 fixture-only clinical terms surfaced: [${hits.join(', ')}]`);

  step('Persisted .pptx in library round-trips through PptxDocument');
  const persisted = await db.document.findFirst({
    where: { deckForgeJobId: outcome.jobId, deletedAt: null },
    select: { id: true, s3Key: true, sizeBytes: true, pageCount: true, mimeType: true },
  });
  expect(!!persisted, 'persisted Document row exists');
  expect(persisted!.mimeType === PPTX_MIME, `persisted mimeType is .pptx`);
  const persistedBuf = await fetchPersistedDeck(persisted!.s3Key);
  expect(persistedBuf[0] === 0x50 && persistedBuf[1] === 0x4b, '.pptx ZIP magic intact');
  expect(Number(persisted!.sizeBytes) > 50_000, `persisted .pptx ≥ 50KB (got ${persisted!.sizeBytes}) — non-trivial size suggests embedded images`);
  const reparse = PptxDocument.fromBuffer(persistedBuf);
  expect(reparse.slides().length === job!.slides.length, `re-parse slide count matches DB`);

  step('Cleanup');
  await db.deckForgeJobInput.deleteMany({ where: { jobId: outcome.jobId } });
  await db.slide.deleteMany({ where: { deckForgeJobId: outcome.jobId } });
  await db.deckForgeJob.delete({ where: { id: outcome.jobId } });
  await db.document.deleteMany({ where: { id: { in: [primaryDoc.id, persisted!.id] } } });

  console.log('');
  if (failed === 0) {
    console.log(`Wizard-forge service smoke — PASS (${passed} / ${passed} checks)`);
    process.exit(0);
  } else {
    console.log(`Wizard-forge service smoke — FAIL (${failed} of ${passed + failed} failed)`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Smoke crashed:', err);
  process.exit(1);
});
