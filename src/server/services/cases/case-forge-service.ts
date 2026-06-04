// ════════════════════════════════════════════════════════════════════════════
// Case Forge Service — turns a Document into a Socratic 5-stage CaseTemplate
// ════════════════════════════════════════════════════════════════════════════
// Mirrors deck-forge but produces a CaseTemplate (DRAFT status, owned by the
// requesting faculty). Two stages:
//
//   1. GENERATION (Gemini Flash, multimodal) — reads the source document
//      inline and outputs the case skeleton: condition, patient profile,
//      presenting complaint, 5-stage mentor guidance, oslerian principles,
//      tags, blooms level.
//
//   2. CLINICAL REVIEW (Opus 4.7) — auto-runs after generation. Clinical
//      accuracy + missing-content audit. Persists to analysisResult so the
//      case editor's AI Coach renders suggestions on first open.
//
// The AI Coach itself (apply / dismiss / refine) is shared infra in router-
// v2. Future: extract the Coach UI/API into a generic component used by both
// decks and cases. Out of scope for this phase.
//
// Pedagogy invariants (5 stages):
//   PATIENT_STORY  → mentor introduces the case in the patient's voice
//   OBSERVATION    → resident gathers history + exam findings
//   HYPOTHESIS     → resident proposes differentials
//   INVESTIGATION  → workup + interpretation
//   REFLECTION     → teaching points + pearls

import { db } from '@/lib/db';
import { s3, BUCKET } from '@/lib/storage';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  CaseDifficulty,
  CaseTemplateStatus,
  type Prisma,
} from '@prisma/client';
import {
  geminiGenerate,
  GeminiUnavailableError,
  GeminiUnparseableError,
  tryParseJson,
} from '@/server/services/ai/gemini';
import { env } from '@/lib/env';

// ─── Types ─────────────────────────────────────────────────────────────────

export class CaseForgeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export interface ForgeCaseInput {
  documentId: string;
  ownerId: string;
  programId: string;
  /** "PGY-1 resident" / "senior resident" / "vitreoretinal fellow". */
  learnerLevel?: string;
}

export interface ForgeCaseOutcome {
  caseTemplateId: string;
  title: string;
  condition: string;
}

export interface StageGuidance {
  patientStory: { mentorIntro: string; expectedQuestions: string[]; keyFacts: string[] };
  observation: { mentorPrompt: string; expectedFindings: string[] };
  hypothesis: { differentials: string[]; rationale: string };
  investigation: { workups: string[]; rationale: string };
  reflection: { teachingPoints: string[]; pearls: string[] };
}

interface RawForgeResult {
  title?: unknown;
  condition?: unknown;
  specialty?: unknown;
  bloomsLevel?: unknown;
  difficulty?: unknown;
  estimatedMinutes?: unknown;
  description?: unknown;
  patient?: { name?: unknown; ageYears?: unknown; sex?: unknown; presentingComplaint?: unknown };
  oslerianPrinciples?: unknown;
  tags?: unknown;
  isEmergency?: unknown;
  imageCount?: unknown;
  stageGuidance?: unknown;
}

// ─── Prompt ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an ophthalmology medical educator at LV Prasad Eye Institute drafting a Socratic teaching case from a source document.

The case follows the William Osler 5-stage dialogue:
  PATIENT_STORY  → patient introduces themselves, presenting complaint
  OBSERVATION    → resident gathers history + slit-lamp / fundus findings
  HYPOTHESIS     → resident proposes differentials, justifies
  INVESTIGATION  → workup (OCT / FFA / USG / labs) + interpretation
  REFLECTION     → teaching points + clinical pearls

OUTPUT — strict JSON, no prose, no markdown fences:
{
  "title": string,                       // <= 90 chars, condition-led ("Acute Anterior Uveitis in a Young Adult")
  "condition": string,                   // canonical diagnosis name (e.g. "Anterior Uveitis")
  "specialty": string,                   // ophthalmology subspecialty (e.g. "Uvea", "Retina")
  "bloomsLevel": number,                 // 1-6 — most cases fit 3-5 (Apply, Analyze, Evaluate)
  "difficulty": "BEGINNER" | "INTERMEDIATE" | "ADVANCED",
  "estimatedMinutes": number,            // typical 20-40
  "description": string,                 // 1-2 sentence learner-facing teaser, <= 280 chars
  "patient": {
    "name": string,                      // realistic Indian first + last name (LVPEI context)
    "ageYears": number,
    "sex": "M" | "F",
    "presentingComplaint": string        // first-person, conversational, <= 240 chars; this becomes the OPENING MESSAGE the resident sees
  },
  "oslerianPrinciples": string[],        // 1-3 from {Listen, Observe, Reason, Test, Reflect}
  "tags": string[],                      // 2-5 ophthalmic keywords (lowercase, hyphen-separated)
  "isEmergency": boolean,                // true if this is a sight-threatening / time-critical case
  "imageCount": number,                  // expected number of supporting images (slit-lamp / fundus / OCT)
  "stageGuidance": {
    "patientStory":  { "mentorIntro": string, "expectedQuestions": string[], "keyFacts": string[] },
    "observation":   { "mentorPrompt": string, "expectedFindings": string[] },
    "hypothesis":    { "differentials": string[], "rationale": string },
    "investigation": { "workups": string[], "rationale": string },
    "reflection":    { "teachingPoints": string[], "pearls": string[] }
  }
}

CONTENT RULES
- Anchor every clinical claim to the source document. NEVER invent dosages, drug names, classification cutoffs, or surgical steps not in the source. If the source is sparse, set imageCount low and keep estimatedMinutes <= 25.
- Use ophthalmic vocabulary throughout — slit-lamp, fundoscopy, OCT, FFA, ICGA, USG, IOP, ETDRS, Shaffer, AAO PPP. No generic "the patient presents…" pablum.
- patient.presentingComplaint must be FIRST PERSON, conversational, the opening message — e.g. "Doctor, my right eye has been red and painful for three days. The light hurts and my vision feels foggy."
- patient.name should reflect Indian cultural context (LVPEI is in Hyderabad).
- Differentials in stageGuidance.hypothesis.differentials should be ordered by likelihood. 3-5 entries.
- expectedFindings should be specific findings the resident is expected to elicit, NOT a checklist of every possible exam item.
- pearls in reflection.pearls are 1-2 sentence high-yield takeaways — what a senior consultant would emphasise.
- isEmergency=true ONLY for time-critical sight-threatening cases (AAC, endophthalmitis, GCA, retinal detachment, chemical injury).
- Do not exceed: title 90 chars, description 280 chars, presentingComplaint 240 chars, each bullet 200 chars.`;

const ALLOWED_DIFFICULTIES: CaseDifficulty[] = [
  CaseDifficulty.BEGINNER,
  CaseDifficulty.INTERMEDIATE,
  CaseDifficulty.ADVANCED,
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function clampInt(n: unknown, min: number, max: number, def: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function safeString(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback;
}

function safeStringArray(v: unknown, max: number, perItem: number): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, max)
    .map((s) => s.trim().slice(0, perItem));
}

function normalizeStageGuidance(raw: unknown): StageGuidance {
  const r = (raw ?? {}) as Record<string, unknown>;
  const stage = (k: string): Record<string, unknown> => (r[k] as Record<string, unknown>) ?? {};
  const ps = stage('patientStory');
  const ob = stage('observation');
  const hy = stage('hypothesis');
  const inv = stage('investigation');
  const ref = stage('reflection');
  return {
    patientStory: {
      mentorIntro: safeString(ps.mentorIntro, 600, 'Hello doctor — please introduce yourself.'),
      expectedQuestions: safeStringArray(ps.expectedQuestions, 6, 200),
      keyFacts: safeStringArray(ps.keyFacts, 8, 200),
    },
    observation: {
      mentorPrompt: safeString(ob.mentorPrompt, 600, 'What examination findings would you focus on first?'),
      expectedFindings: safeStringArray(ob.expectedFindings, 8, 200),
    },
    hypothesis: {
      differentials: safeStringArray(hy.differentials, 5, 200),
      rationale: safeString(hy.rationale, 600, ''),
    },
    investigation: {
      workups: safeStringArray(inv.workups, 8, 200),
      rationale: safeString(inv.rationale, 600, ''),
    },
    reflection: {
      teachingPoints: safeStringArray(ref.teachingPoints, 8, 240),
      pearls: safeStringArray(ref.pearls, 6, 240),
    },
  };
}

interface DocumentSource {
  id: string;
  title: string;
  description: string | null;
  s3Key: string;
  mimeType: string;
  pageCount: number | null;
}

async function loadDocument(documentId: string): Promise<DocumentSource | null> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      description: true,
      s3Key: true,
      mimeType: true,
      pageCount: true,
      deletedAt: true,
    },
  });
  if (!doc || doc.deletedAt) return null;
  return doc;
}

async function fetchInline(s3Key: string): Promise<{ data: string; mimeType: string }> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const stream = out.Body as ReadableStream<Uint8Array> | NodeJS.ReadableStream | undefined;
  if (!stream) throw new CaseForgeError('SOURCE_EMPTY', 'Empty S3 body');
  const chunks: Buffer[] = [];
  for await (const c of stream as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  const buf = Buffer.concat(chunks);
  if (buf.byteLength > 18 * 1024 * 1024) {
    throw new CaseForgeError('SOURCE_TOO_LARGE', `Source ${buf.byteLength} bytes exceeds Gemini inline limit`);
  }
  return { data: buf.toString('base64'), mimeType: out.ContentType ?? 'application/octet-stream' };
}

const INLINE_MIMES = new Set(['application/pdf', 'text/plain', 'text/markdown']);

// ─── Public API ────────────────────────────────────────────────────────────

export async function forgeCase(input: ForgeCaseInput): Promise<ForgeCaseOutcome> {
  if (!env.GEMINI_API_KEY) {
    throw new CaseForgeError('AI_UNAVAILABLE', 'GEMINI_API_KEY is not set');
  }
  const doc = await loadDocument(input.documentId);
  if (!doc) throw new CaseForgeError('SOURCE_NOT_FOUND', 'Document not found or deleted');

  // Build multimodal prompt parts.
  const userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  const headerLines = [
    `Target learner: ${input.learnerLevel ?? 'PGY-2 ophthalmology resident at LVPEI'}`,
    `Source title: ${doc.title}`,
  ];
  if (doc.description) headerLines.push(`Source description: ${doc.description}`);
  if (doc.pageCount) headerLines.push(`Source pages: ${doc.pageCount}`);
  userParts.push({ text: headerLines.join('\n') });

  if (INLINE_MIMES.has(doc.mimeType)) {
    const { data, mimeType } = await fetchInline(doc.s3Key);
    userParts.push({ inlineData: { mimeType, data } });
  } else {
    userParts.push({
      text: `[Note: source binary ${doc.mimeType} cannot be inlined; outline the case from title + description only.]`,
    });
  }
  userParts.push({ text: 'Output the case JSON now.' });

  let raw: string;
  try {
    raw = await geminiGenerate({
      systemInstruction: SYSTEM_PROMPT,
      userParts,
      responseMimeType: 'application/json',
      temperature: 0.45,
    });
  } catch (err) {
    if (err instanceof GeminiUnavailableError || err instanceof GeminiUnparseableError) {
      throw new CaseForgeError('AI_UNAVAILABLE', err.message);
    }
    throw err;
  }

  let parsed: RawForgeResult;
  try {
    parsed = tryParseJson<RawForgeResult>(raw);
  } catch (err) {
    if (err instanceof GeminiUnparseableError) {
      throw new CaseForgeError('AI_UNPARSEABLE', err.message);
    }
    throw err;
  }

  const title = safeString(parsed.title, 200, 'Untitled forged case');
  const condition = safeString(parsed.condition, 120, 'Unspecified condition');
  const specialty = safeString(parsed.specialty, 80, 'Ophthalmology');
  const description = safeString(parsed.description, 600, '');
  const bloomsLevel = clampInt(parsed.bloomsLevel, 1, 6, 3);
  const difficulty: CaseDifficulty = ALLOWED_DIFFICULTIES.includes(parsed.difficulty as CaseDifficulty)
    ? (parsed.difficulty as CaseDifficulty)
    : CaseDifficulty.INTERMEDIATE;
  const estimatedMinutes = clampInt(parsed.estimatedMinutes, 5, 90, 25);
  const isEmergency = parsed.isEmergency === true;
  const imageCount = clampInt(parsed.imageCount, 0, 20, 0);

  const patient = (parsed.patient ?? {}) as RawForgeResult['patient'] & object;
  const patientName = safeString((patient as { name?: unknown }).name, 80, 'A patient');
  const patientAgeYears = clampInt((patient as { ageYears?: unknown }).ageYears, 0, 110, 35);
  const patientSexRaw = safeString((patient as { sex?: unknown }).sex, 8, 'M').toUpperCase();
  const patientSex = patientSexRaw === 'F' || patientSexRaw === 'FEMALE' ? 'F' : 'M';
  const presentingComplaint = safeString(
    (patient as { presentingComplaint?: unknown }).presentingComplaint,
    600,
    'Doctor, I have an eye complaint.',
  );

  const oslerianPrinciples = safeStringArray(parsed.oslerianPrinciples, 3, 60);
  const tags = safeStringArray(parsed.tags, 5, 40);
  const stageGuidance = normalizeStageGuidance(parsed.stageGuidance);

  if (!description || stageGuidance.hypothesis.differentials.length === 0) {
    throw new CaseForgeError('EMPTY_OUTPUT', 'Forge produced an empty case skeleton');
  }

  // Persist as DRAFT — faculty has to review + publish.
  const created = await db.caseTemplate.create({
    data: {
      title,
      condition,
      specialty,
      programId: input.programId,
      bloomsLevel,
      difficulty,
      estimatedMinutes,
      description,
      patientName,
      patientAgeYears,
      patientSex,
      patientPresentingComplaint: presentingComplaint,
      oslerianPrinciples,
      tags,
      imageCount,
      isEmergency,
      ownerId: input.ownerId,
      status: CaseTemplateStatus.DRAFT,
      sourceDocumentId: input.documentId,
      stageGuidance: stageGuidance as unknown as Prisma.InputJsonValue,
      forgedAt: new Date(),
    },
    select: { id: true, title: true, condition: true },
  });

  return { caseTemplateId: created.id, title: created.title, condition: created.condition };
}

// ─── Lifecycle helpers ─────────────────────────────────────────────────────

export async function publishCaseTemplate(caseTemplateId: string, actorId: string): Promise<void> {
  const tpl = await db.caseTemplate.findUnique({
    where: { id: caseTemplateId },
    select: { ownerId: true, status: true },
  });
  if (!tpl) throw new CaseForgeError('NOT_FOUND', 'Case not found');
  if (tpl.ownerId !== actorId) throw new CaseForgeError('FORBIDDEN', 'Not your case');
  if (tpl.status === CaseTemplateStatus.PUBLISHED) return; // idempotent
  await db.caseTemplate.update({
    where: { id: caseTemplateId },
    data: { status: CaseTemplateStatus.PUBLISHED, publishedAt: new Date() },
  });
}

export async function archiveCaseTemplate(caseTemplateId: string, actorId: string): Promise<void> {
  const tpl = await db.caseTemplate.findUnique({
    where: { id: caseTemplateId },
    select: { ownerId: true },
  });
  if (!tpl) throw new CaseForgeError('NOT_FOUND', 'Case not found');
  if (tpl.ownerId !== actorId) throw new CaseForgeError('FORBIDDEN', 'Not your case');
  await db.caseTemplate.update({
    where: { id: caseTemplateId },
    data: { status: CaseTemplateStatus.ARCHIVED },
  });
}

export async function listMyCases(ownerId: string): Promise<
  Array<{
    id: string;
    title: string;
    condition: string;
    status: CaseTemplateStatus;
    difficulty: CaseDifficulty;
    bloomsLevel: number;
    estimatedMinutes: number;
    forgedAt: Date | null;
    publishedAt: Date | null;
    sourceDocumentId: string | null;
    isEmergency: boolean;
    tags: string[];
  }>
> {
  return db.caseTemplate.findMany({
    where: { ownerId },
    orderBy: [{ status: 'asc' }, { forgedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      condition: true,
      status: true,
      difficulty: true,
      bloomsLevel: true,
      estimatedMinutes: true,
      forgedAt: true,
      publishedAt: true,
      sourceDocumentId: true,
      isEmergency: true,
      tags: true,
    },
    take: 100,
  });
}
