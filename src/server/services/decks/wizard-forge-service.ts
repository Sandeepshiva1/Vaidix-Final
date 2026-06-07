// ════════════════════════════════════════════════════════════════════════════
// Wizard Forge Service — Phase 1A deck-forge redesign
// ════════════════════════════════════════════════════════════════════════════
// Two-step pipeline distinct from the legacy `forgeDeck()`:
//
//   1. EXTRACT (Gemini multimodal) — reads every attached Document and
//      returns a clean structured extraction (topics, claims, citations).
//   2. DRAFT  (Opus)               — reads the extraction + briefing +
//      faculty intent and authors the slide JSON, ALSO flags initial
//      enhancement suggestions in the same call.
//
// The wizard at /teacher/decks/new is the only caller. The legacy single-
// source forge (/api/decks/forge) keeps using forgeDeck() unchanged — the
// two flows coexist per the "two parallel intakes, one shared studio"
// architectural choice.

import { db } from '@/lib/db';
import { s3, BUCKET } from '@/lib/storage';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  DeckForgeStatus,
  DeckForgeSource,
  DeckForgeIntent,
  DeckForgeInputRole,
  DocumentKind,
  SlideLayout,
  type Prisma,
} from '@prisma/client';
import {
  aiExtractFromSourceJson,
  aiEnhanceContentJson,
  aiGenerateImageForSlide,
  AiUnavailableError,
  AiUnparseableError,
} from '@/server/services/ai/router';
import { PptxDocument, PptxParseError } from '@/server/services/pptx/pptx-document';
import { classifySource } from './source-classifier';
import { importVerbatimDeck } from './verbatim-import-service';
import { loadPrompt } from '@/server/prompts/loader';
import { getFacultyHistoryContext } from './faculty-analytics-history';
import {
  getFacultyStyleProfile,
  REBUILD_AFTER_N_NEW_SIGNALS,
  rebuildFacultyStyleProfile,
} from './faculty-style-profile';
import { persistDeckAsDocument } from './deck-pptx-renderer';

// ─── Public types ──────────────────────────────────────────────────────────

export interface WizardForgeBriefing {
  audience: string; // e.g. "PG-2 ophthalmology resident"
  sessionType: 'LECTURE' | 'CASE_CONFERENCE' | 'JOURNAL_CLUB' | 'TUTORIAL';
  durationMin: number; // 30 / 45 / 60 / 90
  objectives: string; // 1–3 sentences — what learners take away
  localContext?: string; // LVPEI patient mix, adherence, follow-up gaps, etc.
}

export interface WizardForgeInputDoc {
  documentId: string;
  role: DeckForgeInputRole;
}

export interface WizardForgeInput {
  intent: DeckForgeIntent;
  briefing: WizardForgeBriefing;
  inputs: WizardForgeInputDoc[];
  requestedById: string;
  inputTitle?: string;
}

export interface WizardForgeOutcome {
  jobId: string;
  deckTitle: string;
  slideCount: number;
}

export class WizardForgeError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION'
      | 'AI_UNAVAILABLE'
      | 'SOURCE_TOO_LARGE'
      | 'SOURCE_NOT_FOUND'
      | 'EMPTY_DECK'
      | 'FORGE_FAILED',
    message: string,
  ) {
    super(message);
  }
}

// ─── Input validation ──────────────────────────────────────────────────────

function validateInputShape(input: WizardForgeInput): void {
  if (!input.inputs.length) {
    throw new WizardForgeError('VALIDATION', 'At least one input document is required');
  }
  const primaryCount = input.inputs.filter((i) => i.role === 'PRIMARY_PPTX').length;
  if (input.intent === 'ENHANCE_EXISTING') {
    if (primaryCount !== 1) {
      throw new WizardForgeError(
        'VALIDATION',
        'Enhance-existing requires exactly one PRIMARY_PPTX input',
      );
    }
  } else {
    if (primaryCount > 0) {
      throw new WizardForgeError(
        'VALIDATION',
        'Draft-from-scratch does not accept a PRIMARY_PPTX input',
      );
    }
  }
  if (input.briefing.durationMin < 10 || input.briefing.durationMin > 240) {
    throw new WizardForgeError('VALIDATION', 'Duration must be between 10 and 240 minutes');
  }
  if (!input.briefing.objectives.trim()) {
    throw new WizardForgeError('VALIDATION', 'Briefing objectives are required');
  }
}

// ─── Source loaders ────────────────────────────────────────────────────────

interface LoadedDoc {
  documentId: string;
  title: string;
  description: string | null;
  kind: DocumentKind;
  mimeType: string;
  s3Key: string;
  pageCount: number | null;
  role: DeckForgeInputRole;
}

async function loadDocs(inputs: WizardForgeInputDoc[]): Promise<LoadedDoc[]> {
  const docs = await db.document.findMany({
    where: { id: { in: inputs.map((i) => i.documentId) }, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      kind: true,
      mimeType: true,
      s3Key: true,
      pageCount: true,
    },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const i of inputs) {
    if (!byId.has(i.documentId)) {
      throw new WizardForgeError('SOURCE_NOT_FOUND', `Document ${i.documentId} not found`);
    }
  }
  return inputs.map((i) => {
    const d = byId.get(i.documentId)!;
    return {
      documentId: d.id,
      title: d.title,
      description: d.description,
      kind: d.kind,
      mimeType: d.mimeType,
      s3Key: d.s3Key,
      pageCount: d.pageCount,
      role: i.role,
    };
  });
}

// Mimes Gemini can ingest directly as `inlineData` (multimodal). PPTX is
// handled separately by PptxDocument — we extract text deterministically
// and pass it as a `text` part instead of trying to inline the .pptx binary
// (which Gemini does not parse natively).
const GEMINI_INLINE_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  // images for IMAGE-kind documents
  'image/png',
  'image/jpeg',
  'image/webp',
]);

// PPTX mime types we route through PptxDocument for deterministic extraction.
// The old .ppt OLE binary is intentionally NOT in this set — PptxDocument is
// .pptx (ZIP) only, and the placeholder fallback below handles .ppt cleanly.
const PPTX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

// Apple Keynote (.key) is accepted but not text-extractable yet (iWork iwa
// proto-binary archive needs a dedicated parser). Recognised so we can emit
// a helpful "export to .pptx for full ingestion" hint to Gemini + the
// faculty, instead of the generic "cannot be inlined" placeholder.
const KEYNOTE_MIME_TYPES = new Set([
  'application/vnd.apple.keynote',
  'application/x-iwork-keynote-sffkey',
]);

// Aggregate inline-blob cap per forge job. Gemini's hard limit is much
// higher but we stay safe by capping the total at 20 MB.
const TOTAL_INLINE_CAP_BYTES = 20 * 1024 * 1024;

// Per-PPTX extracted-text cap to keep the Gemini context bounded on
// pathological 200-slide decks. Bytes well within Gemini's window but
// generous enough that a 22-slide LVPEI faculty deck round-trips intact.
const PPTX_TEXT_CAP_PER_DOC = 200 * 1024;

async function fetchBytes(s3Key: string): Promise<{ buffer: Buffer; mimeType: string; byteLength: number }> {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  const stream = out.Body as AsyncIterable<Uint8Array> | undefined;
  if (!stream) throw new WizardForgeError('SOURCE_NOT_FOUND', `Empty S3 body for ${s3Key}`);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  const buf = Buffer.concat(chunks);
  return {
    buffer: buf,
    mimeType: out.ContentType ?? 'application/octet-stream',
    byteLength: buf.byteLength,
  };
}

export interface PptxExtraction {
  slideCount: number;
  /** Deterministic outline keyed to slide order — used to anchor ENHANCE_EXISTING. */
  outline: Array<{ slideIndex: number; title: string; summary: string }>;
  /** Human-readable per-slide block we feed to Gemini as a `text` part. */
  text: string;
  /** True when at least one slide carried speaker-notes content. */
  hasSpeakerNotes: boolean;
}

/**
 * Parse a .pptx buffer with the in-tree PptxDocument and turn it into:
 *   (a) a `text` representation Gemini reads as part of the extraction call,
 *       including titles, body text and (Mac/Win) Keynote/PowerPoint speaker
 *       notes when present,
 *   (b) a deterministic `outline` array used to overwrite Gemini's
 *       primaryDeckOutline so the ENHANCE branch of the Opus draft prompt
 *       gets the exact original slide order/titles (LLM drift on titles
 *       defeats the enhance contract).
 *
 * Returns null on parse failure — caller falls back to the metadata-only
 * placeholder so a malformed .pptx never blocks the forge.
 *
 * Exported so suggest-objectives (and any future PPTX-consuming AI flow) can
 * reuse the same extraction contract — keep the PPTX-to-AI surface in one
 * place to avoid drift.
 */
export function extractPptxContent(buf: Buffer, label: string): PptxExtraction | null {
  let doc: PptxDocument;
  try {
    doc = PptxDocument.fromBuffer(buf);
  } catch (e) {
    console.warn('[wizard-forge] PPTX parse failed', {
      label,
      error: e instanceof PptxParseError ? e.message : String(e),
    });
    return null;
  }
  const slides = doc.slides();
  const outline: PptxExtraction['outline'] = [];
  const lines: string[] = [
    `[Begin file: ${label} — ${slides.length} slide${slides.length === 1 ? '' : 's'}, extracted via PptxDocument (titles + body + speaker notes)]`,
  ];
  let chars = lines[0].length;
  let hasSpeakerNotes = false;

  for (const slide of slides) {
    const titleShape = slide.shapes.find((s) => s.isTitle && s.text.trim());
    const bodyShapes = slide.shapes.filter(
      (s) => (!titleShape || s.slotId !== titleShape.slotId) && s.text.trim(),
    );
    // Fallback: if no <p:ph type="title"/> placeholder, treat the first
    // text-bearing shape as the title (real-world decks built without
    // layout placeholders — pptxgenjs-generated, some institutional templates).
    const titleText = (
      titleShape?.text ?? bodyShapes.shift()?.text ?? `Slide ${slide.index}`
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 200);

    const bodyJoined = bodyShapes
      .map((s) => s.text.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join(' / ');

    // Speaker notes survive the round-trip across Mac Keynote → .pptx export
    // and Windows PowerPoint — both write into ppt/notesSlides/notesSlideN.xml.
    const notes = doc.notes(slide.index);
    if (notes) hasSpeakerNotes = true;

    outline.push({
      slideIndex: slide.index,
      title: titleText,
      summary: bodyJoined.slice(0, 300),
    });

    const notesBlock = notes
      ? `\nNOTES: ${notes.replace(/\s+/g, ' ').slice(0, 800)}`
      : '';

    const slideBlock =
      `\n=== Slide ${slide.index} ===\n` +
      `TITLE: ${titleText}\n` +
      bodyShapes.map((s) => `TEXT: ${s.text.trim()}`).join('\n') +
      notesBlock +
      (slide.imageCount > 0 ? `\n[images on slide: ${slide.imageCount}]` : '');

    if (chars + slideBlock.length > PPTX_TEXT_CAP_PER_DOC) {
      lines.push(
        `\n[…truncated at ${PPTX_TEXT_CAP_PER_DOC / 1024} KB; ${slides.length - slide.index + 1} slide(s) omitted from Gemini context. Outline still complete.]`,
      );
      break;
    }
    lines.push(slideBlock);
    chars += slideBlock.length;
  }

  lines.push(`\n[End file: ${label}]`);
  return {
    slideCount: slides.length,
    outline,
    text: lines.join(''),
    hasSpeakerNotes,
  };
}

/** Mime set + per-doc cap exported for cross-service reuse (e.g. suggest-objectives). */
export { PPTX_MIME_TYPES };

// ─── Extract step ──────────────────────────────────────────────────────────
//
// The EXTRACT and DRAFT system prompts are loaded from the central prompt
// registry at runtime — see src/server/prompts/_base/op-deck-extract.md and
// op-deck-draft.md. Editing prompt language happens in those markdown files
// only; this service stays prompt-text-free so future domains (cardiology,
// dentistry) work with a single config change in _domains/.

interface ExtractionResult {
  topics: Array<{ topic: string; summary: string; sourceRefs?: string[] }>;
  keyFacts?: Array<{ fact: string; sourceRef?: string; tier?: 'core' | 'advanced' }>;
  definitions?: Array<{ term: string; definition: string }>;
  imagesAvailable?: Array<{ description: string; sourceRef?: string }>;
  openQuestions?: string[];
  // Must-not-miss / sight-threatening points the source stresses; the draft
  // step turns these into the pitfalls slide + safety callouts.
  redFlags?: Array<{ redFlag: string; sourceRef?: string }>;
  // Honest gaps: source ambiguity, contradiction, unreadable figures, possibly
  // dated guidance. Surfaced to faculty as CLINICAL suggestions, never guessed.
  uncertainties?: string[];
  primaryDeckOutline?: Array<{ slideIndex: number; title: string; summary: string }>;
}

async function extractFromSources(loaded: LoadedDoc[]): Promise<ExtractionResult> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  parts.push({
    text:
      `Inputs (${loaded.length} file${loaded.length > 1 ? 's' : ''}):\n` +
      loaded
        .map(
          (d, i) =>
            `[${i + 1}] role=${d.role} kind=${d.kind} mime=${d.mimeType} title="${d.title}"` +
            (d.description ? `\n    description: ${d.description.slice(0, 400)}` : ''),
        )
        .join('\n'),
  });

  // Track the PRIMARY_PPTX's deterministic outline. After Gemini returns,
  // we overwrite extraction.primaryDeckOutline with this — Gemini can drift
  // on slide titles and the ENHANCE branch of the Opus draft prompt
  // (DRAFT_SYSTEM_PROMPT, "Keep the original slide order and titles") needs
  // an exact verbatim anchor or it silently falls through to free-form draft.
  let primaryOutline: PptxExtraction['outline'] | null = null;
  let totalBytes = 0;

  for (const d of loaded) {
    const label = `${d.role} | ${d.title}`;

    // ─── PPTX path: deterministic text + outline extraction via PptxDocument
    if (PPTX_MIME_TYPES.has(d.mimeType)) {
      const blob = await fetchBytes(d.s3Key);
      totalBytes += blob.byteLength;
      if (totalBytes > TOTAL_INLINE_CAP_BYTES) {
        throw new WizardForgeError(
          'SOURCE_TOO_LARGE',
          `Combined source bytes exceed ${TOTAL_INLINE_CAP_BYTES / 1024 / 1024} MB inline cap`,
        );
      }
      const extracted = extractPptxContent(blob.buffer, label);
      if (extracted) {
        parts.push({ text: extracted.text });
        if (d.role === 'PRIMARY_PPTX') {
          primaryOutline = extracted.outline;
        }
      } else {
        // Parse failure — keep going with a metadata-only signal so the deck
        // still gets drafted rather than failing the whole forge.
        parts.push({
          text:
            `[${label}] PPTX parse failed; using metadata only. ` +
            `Treat as an outline-only signal.`,
        });
      }
      continue;
    }

    // ─── Gemini-inline path: PDF / image / plain text / markdown
    if (GEMINI_INLINE_MIMES.has(d.mimeType)) {
      const blob = await fetchBytes(d.s3Key);
      totalBytes += blob.byteLength;
      if (totalBytes > TOTAL_INLINE_CAP_BYTES) {
        throw new WizardForgeError(
          'SOURCE_TOO_LARGE',
          `Combined source bytes exceed ${TOTAL_INLINE_CAP_BYTES / 1024 / 1024} MB inline cap`,
        );
      }
      parts.push({ text: `[Begin file: ${label}]` });
      // Prefer the DB-stamped mimeType (set by document-service.ts on upload)
      // over the S3 object's ContentType — the upload route is authoritative
      // and matches what Gemini's inlineData parser expects.
      parts.push({ inlineData: { mimeType: d.mimeType, data: blob.buffer.toString('base64') } });
      parts.push({ text: `[End file: ${d.title}]` });
      continue;
    }

    // ─── Apple Keynote (.key) — accepted but not text-extractable yet.
    //     Emit a clear hint so Gemini (and faculty reading the audit log)
    //     understands the deck exists but its text content didn't make it
    //     into the extraction. Faculty workaround: open in Keynote →
    //     File → Export To → PowerPoint (.pptx), then re-upload.
    if (KEYNOTE_MIME_TYPES.has(d.mimeType)) {
      parts.push({
        text:
          `[${label}] is an Apple Keynote (.key) file — text/notes not parsed in this build. ` +
          `Treat as a title-only signal. Faculty hint surfaces in UI: "Export from Keynote → PowerPoint (.pptx) for full extraction.".`,
      });
      continue;
    }

    // ─── Unhandled binaries (.doc/.docx, .ppt OLE, audio, video) — leave a
    //     metadata-only signal so Gemini knows the file exists. Future fix
    //     can add per-format extractors (e.g. mammoth for .docx) and route
    //     them through the same `text` part contract.
    parts.push({
      text:
        `[${label}] cannot be inlined as ${d.mimeType}; using metadata only. ` +
        `Treat as an outline-only signal.`,
    });
  }

  parts.push({ text: 'Produce the extraction JSON now.' });

  // System prompt is the markdown-source-of-truth at
  // src/server/prompts/_base/op-deck-extract.md, loaded + domain-interpolated
  // at call time. Editing prompt language happens there, not here.
  const extractPrompt = await loadPrompt('op-deck-extract');
  const extraction = await aiExtractFromSourceJson<ExtractionResult>({
    systemPrompt: extractPrompt.text,
    parts,
    temperature: 0.2,
  });

  // Deterministic override — see comment on `primaryOutline` declaration.
  if (primaryOutline) {
    extraction.primaryDeckOutline = primaryOutline;
  }

  return extraction;
}

// ─── Draft step ────────────────────────────────────────────────────────────
//
// System prompt lives at src/server/prompts/_base/op-deck-draft.md — load
// at call time, edit there. The schema below (DraftedSlide / DraftResult)
// is the contract between Opus's JSON output and the persistence step.

interface DraftedSlide {
  layout?: string;
  title?: unknown;
  bullets?: unknown;
  speakerNotes?: unknown;
  citation?: unknown;
  /**
   * Per-slide dynamic visualization brief Opus writes. Drives the image
   * generation step downstream — Gemini Flash converts this into an
   * image-render prompt, Gemini 2.5 Flash Image renders the bytes.
   * When set on a non-IMAGE_FOCUS slide, the generator still produces an
   * image; the renderer paints it where a slot is available.
   */
  imageBrief?: unknown;
}

interface DraftResult {
  deckTitle?: unknown;
  slides?: DraftedSlide[];
  initialSuggestions?: Array<{
    kind?: string;
    slideIndex?: number;
    severity?: string;
    message?: string;
    rationale?: string;
  }>;
}

const ALLOWED_LAYOUTS: SlideLayout[] = [
  'TITLE_ONLY',
  'TITLE_BULLETS',
  'TWO_COLUMN',
  'IMAGE_FOCUS',
  'QUOTE',
  'INTERACTION',
  'CLOSING',
];

// Upper bound on persisted slide count. Generous — coverage > count is the
// op-deck-draft.md rule, so we don't truncate a 30-slide deck the prompt
// authored because supplementary PDFs added topics. Pure safety belt for
// degenerate LLM output.
const MAX_SLIDES_PER_DECK = 80;

function normalize(draft: DraftResult): {
  deckTitle: string;
  slides: Array<{
    layout: SlideLayout;
    title: string;
    bullets: string[];
    speakerNotes: string;
    citation: string | null;
    imageBrief: string | null;
  }>;
  initialSuggestions: Array<{
    kind: string;
    slideIndex: number;
    severity: 'HIGH' | 'MED' | 'LOW';
    message: string;
    rationale: string;
  }>;
} {
  const deckTitle =
    typeof draft.deckTitle === 'string' && draft.deckTitle.trim()
      ? draft.deckTitle.trim().slice(0, 120)
      : 'Untitled Deck';
  const raw = Array.isArray(draft.slides) ? draft.slides : [];
  const slides = raw
    .slice(0, MAX_SLIDES_PER_DECK)
    .map((s) => ({
      layout: (ALLOWED_LAYOUTS.includes(s.layout as SlideLayout)
        ? s.layout
        : 'TITLE_BULLETS') as SlideLayout,
      title: typeof s.title === 'string' ? s.title.slice(0, 200) : 'Untitled slide',
      bullets: Array.isArray(s.bullets)
        ? (s.bullets as unknown[])
            .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
            // Allow up to 8 bullets per slide (op-deck-draft.md schema bumped
            // from 6 → 8; coverage-first decks benefit from a couple more).
            .slice(0, 8)
            .map((b) => b.trim().slice(0, 200))
        : [],
      speakerNotes: typeof s.speakerNotes === 'string' ? s.speakerNotes.slice(0, 1500) : '',
      citation:
        typeof s.citation === 'string' && s.citation.trim() ? s.citation.trim().slice(0, 200) : null,
      imageBrief:
        typeof s.imageBrief === 'string' && s.imageBrief.trim()
          ? s.imageBrief.trim().slice(0, 400)
          : null,
    }))
    .filter((s) => s.title.trim().length > 0);

  const initialSuggestions = (draft.initialSuggestions ?? [])
    // op-deck-draft.md cap raised from 8 → 12 to surface ENHANCE-mode
    // proposed-rename / proposed-merge notes that the HARD CONTRACT rejects
    // silently. Faculty sees them in the Studio.
    .slice(0, 12)
    .filter(
      (r): r is { kind: string; slideIndex: number; severity: string; message: string; rationale: string } =>
        typeof r.kind === 'string' &&
        typeof r.slideIndex === 'number' &&
        typeof r.message === 'string',
    )
    .map((r): {
      kind: string;
      slideIndex: number;
      severity: 'HIGH' | 'MED' | 'LOW';
      message: string;
      rationale: string;
    } => ({
      kind: r.kind.slice(0, 32),
      slideIndex: Math.max(0, Math.min(slides.length - 1, Math.floor(r.slideIndex))),
      severity:
        r.severity === 'HIGH' || r.severity === 'LOW' ? r.severity : 'MED',
      message: r.message.slice(0, 300),
      rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 500) : '',
    }));

  return { deckTitle, slides, initialSuggestions };
}

async function draftFromExtraction(args: {
  intent: DeckForgeIntent;
  briefing: WizardForgeBriefing;
  extraction: ExtractionResult;
  /** Optional faculty-history prompt block — null when faculty has no prior
   *  sessions in the lookback window. Skipped from the prompt when null. */
  historyContext: string | null;
  /** Optional faculty STYLE-profile prompt block — null when faculty has
   *  aiMemoryOptIn=false, no profile yet, or no rules whose scope tags
   *  overlap the current briefing. */
  styleContext: string | null;
}): Promise<DraftResult> {
  const historyBlock = args.historyContext ? `\n${args.historyContext}\n` : '';
  const styleBlock = args.styleContext ? `\n${args.styleContext}\n` : '';
  const userMessage =
    `Intent: ${args.intent}\n\n` +
    `BRIEFING\n` +
    `  audience: ${args.briefing.audience}\n` +
    `  sessionType: ${args.briefing.sessionType}\n` +
    `  durationMin: ${args.briefing.durationMin}\n` +
    `  objectives: ${args.briefing.objectives}\n` +
    (args.briefing.localContext ? `  localContext: ${args.briefing.localContext}\n` : '') +
    historyBlock +
    styleBlock +
    `\nEXTRACTION (from upstream extractor)\n${JSON.stringify(args.extraction, null, 2)}\n\n` +
    `Author the deck JSON now.`;
  const draftPrompt = await loadPrompt('op-deck-draft');
  return aiEnhanceContentJson<DraftResult>({
    systemPrompt: draftPrompt.text,
    userMessage,
    jsonOutput: true,
    temperature: 0.35,
    // 8000 was tuned for the legacy hardcoded prompt; op-deck-draft.md is
    // larger (HARD ENHANCE contract + coverage-first phrasing) and authors
    // longer decks when source coverage demands it. Loosen so coverage isn't
    // truncated mid-slide.
    maxTokens: 16000,
  });
}

/**
 * Derive a topic tag from the briefing/inputTitle for scoped style-profile
 * retrieval. Same heuristic the capture sites use: first content word of
 * the deck title (or first objective word if title is missing), lowercase,
 * length > 2. Cheap and deterministic.
 */
function deriveTopicTagForForge(inputTitle: string | null | undefined, objectives: string): string | null {
  const source = inputTitle && inputTitle.trim().length > 0 ? inputTitle : objectives;
  const cleaned = source.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
  const first = cleaned.split(/\s+/).find((w) => w.length > 2);
  return first ?? null;
}

// Image generation runs concurrently across IMAGE_FOCUS slides — keep small
// to respect Gemini Image RPS limits and avoid hammering a single forge.
const IMAGE_GEN_CONCURRENCY = 3;

/**
 * Slide shape generateSlideImages expects — the normalized DraftResult.slides
 * plus the Slide.id we resolve post-persist. The rich imageBrief is what
 * makes per-slide prompts content-aware instead of generic.
 */
interface SlideForImageGen {
  id: string;
  order: number;
  layout: SlideLayout;
  title: string;
  bullets: string[];
  speakerNotes: string | null;
  /** Opus's per-slide visualization brief; null when no image desired. */
  imageBrief: string | null;
}

/**
 * Generate clinical-illustration images for every slide where one helps —
 * IMAGE_FOCUS layouts AND any slide where Opus set imageBrief (e.g. a
 * TITLE_BULLETS slide describing anatomy that wins with a side diagram).
 *
 * Pipeline per slide: aiGenerateImageForSlide → Gemini Flash writes the
 * image prompt from {title, bullets, imageBrief, speakerNotes} → Gemini
 * 2.5 Flash Image (Nano Banana) renders bytes → S3 upload →
 * Slide.imageS3Key + imagePrompt persisted.
 *
 * Best-effort: a slide that fails to generate keeps imageS3Key = null and
 * the renderer falls back to its placeholder. Per-slide and aggregate
 * failures are logged for triage but never block the forge.
 */
async function generateSlideImages(opts: {
  jobId: string;
  requestedById: string;
  slides: SlideForImageGen[];
}): Promise<{ generated: number; failed: number; skipped: number }> {
  // A slide is a candidate when it has an explicit imageBrief OR it's
  // IMAGE_FOCUS (legacy belt-and-braces — Opus is meant to always set
  // imageBrief on IMAGE_FOCUS, but if it forgets, the layout signal still
  // triggers generation).
  const candidates = opts.slides.filter(
    (s) => (s.imageBrief && s.imageBrief.trim().length > 0) || s.layout === SlideLayout.IMAGE_FOCUS,
  );
  if (candidates.length === 0) {
    return { generated: 0, failed: 0, skipped: opts.slides.length };
  }

  let generated = 0;
  let failed = 0;

  // Sequential batching with a small concurrency window. Promise.all on the
  // whole list risks Gemini-side rate-limits on faculty decks with many
  // image slides; chunks of IMAGE_GEN_CONCURRENCY keep that bounded.
  for (let i = 0; i < candidates.length; i += IMAGE_GEN_CONCURRENCY) {
    const batch = candidates.slice(i, i + IMAGE_GEN_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (slide) => {
        const result = await aiGenerateImageForSlide({
          title: slide.title,
          bullets: slide.bullets,
          imageBrief: slide.imageBrief ?? undefined,
          speakerNotes: slide.speakerNotes ?? undefined,
        });
        const imageBytes = Buffer.from(result.image.data, 'base64');
        // Use .png extension regardless of mime — pptxgenjs's addImage with a
        // data URL is the canonical path and accepts mime in the prefix.
        const s3Key = `documents/deck-forge/${opts.requestedById}/${opts.jobId}/slide-${slide.order}.png`;
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: s3Key,
            Body: imageBytes,
            ContentType: result.image.mimeType || 'image/png',
          }),
        );
        await db.slide.update({
          where: { id: slide.id },
          data: { imageS3Key: s3Key, imagePrompt: result.prompt },
        });
        return slide.order;
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') generated++;
      else {
        failed++;
        console.warn('[wizard-forge] image gen failed for slide', {
          jobId: opts.jobId,
          reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }
  return { generated, failed, skipped: opts.slides.length - candidates.length };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

export async function wizardForgeDeck(input: WizardForgeInput): Promise<WizardForgeOutcome> {
  validateInputShape(input);

  const loaded = await loadDocs(input.inputs);
  const sourceKind: DeckForgeSource = 'DOCUMENT'; // wizard always doc-driven for v1

  // 1. Create job + input rows in one transaction so the studio can resume
  //    if the AI step crashes.
  const created = await db.$transaction(async (tx) => {
    const job = await tx.deckForgeJob.create({
      data: {
        intent: input.intent,
        briefing: input.briefing as unknown as Prisma.InputJsonValue,
        requestedById: input.requestedById,
        status: DeckForgeStatus.EXTRACTING,
        sourceKind,
        inputTitle: input.inputTitle ?? loaded[0]?.title ?? 'Forged Deck',
      },
      select: { id: true },
    });
    await tx.deckForgeJobInput.createMany({
      data: loaded.map((d) => ({ jobId: job.id, documentId: d.documentId, role: d.role })),
    });
    return job;
  });

  try {
    // ── Verbatim short-circuit ───────────────────────────────────────────────
    // If the deck's primary source already IS a slide deck, import it as-is
    // (1:1 editable copy + rasterised "Original") instead of EXTRACT→DRAFT.
    // Candidate = the PRIMARY_PPTX (ENHANCE) or, when there's a single input,
    // that lone doc. AI suggestions remain available on demand in the studio.
    const verbatimCandidate =
      loaded.find((d) => d.role === 'PRIMARY_PPTX') ?? (loaded.length === 1 ? loaded[0] : null);
    if (verbatimCandidate) {
      const blob = await fetchBytes(verbatimCandidate.s3Key);
      // The DB-stamped mimeType is authoritative (S3 ContentType can be octet).
      const verdict = await classifySource({
        mimeType: verbatimCandidate.mimeType,
        buffer: blob.buffer,
      });
      if (verdict.mode === 'VERBATIM') {
        const { slideCount } = await importVerbatimDeck({
          jobId: created.id,
          requestedById: input.requestedById,
          buffer: blob.buffer,
          mimeType: verbatimCandidate.mimeType,
        });
        return { jobId: created.id, deckTitle: verbatimCandidate.title, slideCount };
      }
    }

    // 2. EXTRACT — Gemini multimodal
    const extraction = await extractFromSources(loaded);

    await db.deckForgeJob.update({
      where: { id: created.id },
      data: {
        status: DeckForgeStatus.GENERATING_SLIDES,
        extractedPearls: extraction as unknown as Prisma.InputJsonValue,
      },
    });

    // 3. DRAFT — Opus authors + flags initial suggestions.
    // Two parallel context fetches:
    //   - history: engagement signals from this faculty's past sessions
    //   - style:   distilled rules from this faculty's past slide edits
    // Both return null when not enough signal — caller skips the prompt block.
    //
    // Style retrieval is SCOPED by the active briefing's topic/audience/
    // sessionType so a "drop dosage tables for glaucoma" rule never bleeds
    // into a uveitis deck (Mem0 structured-metadata pattern, 2026).
    //
    // Cross-user isolation: getFacultyStyleProfile(input.requestedById) is
    // called with the authenticated forge requester. There is no parameter
    // path here for another user's id to enter — the contract is enforced
    // at the call site by passing `input.requestedById` and only that.
    const styleScope = {
      topicTag: deriveTopicTagForForge(input.inputTitle, input.briefing.objectives),
      audienceTag: input.briefing.audience,
      sessionType: input.briefing.sessionType,
    };
    const [history, style] = await Promise.all([
      getFacultyHistoryContext(input.requestedById).catch(() => null),
      getFacultyStyleProfile(input.requestedById, styleScope).catch(() => null),
    ]);

    const draft = await draftFromExtraction({
      intent: input.intent,
      briefing: input.briefing,
      extraction,
      historyContext: history?.promptContext ?? null,
      styleContext: style?.promptContext ?? null,
    });
    const result = normalize(draft);

    if (result.slides.length === 0) {
      throw new WizardForgeError('EMPTY_DECK', 'AI returned no usable slides');
    }

    // 4. Persist slides + seed the analysisResult with initial suggestions so
    //    the studio can render them on first load without calling /analyze.
    const slideRows: Prisma.SlideCreateManyInput[] = result.slides.map((s, i) => ({
      deckForgeJobId: created.id,
      order: i,
      layout: s.layout,
      title: s.title,
      bullets: s.bullets,
      speakerNotes: s.speakerNotes || null,
      sourceCitations: s.citation
        ? [{ note: s.citation, documentId: loaded[0]?.documentId ?? null, recordingId: null }]
        : undefined,
    }));

    await db.$transaction(async (tx) => {
      await tx.slide.createMany({ data: slideRows });
      await tx.deckForgeJob.update({
        where: { id: created.id },
        data: {
          status: DeckForgeStatus.REVIEW_PENDING,
          slideCount: result.slides.length,
          inputTitle: result.deckTitle,
          // analysisResult intentionally left null — the legacy DeckAiCoach
          // expects the post-/analyze DeckAnalysisResult shape (scores +
          // passes + DeckSuggestion[]) and crashes on partial shapes. The
          // wizard's initialSuggestions will live in Phase 1C's Studio under
          // its own UI; for now, faculty clicks "Analyze" in the editor and
          // gets a real analysisResult written.
        },
      });
    });

    // Generate clinical-illustration images for every slide where Opus set
    // imageBrief OR for IMAGE_FOCUS layouts. Best-effort — a failure here
    // never blocks the forge; the renderer falls back to a placeholder for
    // slides without an imageS3Key. Runs before persistDeckAsDocument so
    // the persisted .pptx already carries images.
    //
    // We re-query the persisted slides to pair our in-memory normalized
    // result.slides[i] (which carries imageBrief) with the DB row's id
    // (needed to write back imageS3Key + imagePrompt). createMany doesn't
    // return ids in Postgres-Prisma, so this round-trip is unavoidable.
    try {
      const persistedSlides = await db.slide.findMany({
        where: { deckForgeJobId: created.id },
        orderBy: { order: 'asc' },
        select: { id: true, order: true },
      });
      const slidesForImageGen: SlideForImageGen[] = result.slides.map((s, i) => ({
        id: persistedSlides[i]?.id ?? '',
        order: i,
        layout: s.layout,
        title: s.title,
        bullets: s.bullets,
        speakerNotes: s.speakerNotes || null,
        imageBrief: s.imageBrief,
      })).filter((s) => s.id.length > 0);

      const imageStats = await generateSlideImages({
        jobId: created.id,
        requestedById: input.requestedById,
        slides: slidesForImageGen,
      });
      console.info('[wizard-forge] image generation', {
        jobId: created.id,
        ...imageStats,
      });
    } catch (e) {
      console.warn('[wizard-forge] image generation step crashed', {
        jobId: created.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Surface the forged deck in the faculty's documents library. Best-effort.
    await persistDeckAsDocument({ jobId: created.id });

    // Auto-trigger style-profile rebuild when enough new signals have
    // accumulated since the last build. Runs in the background — must not
    // block the forge response. A failure here is a non-event; faculty can
    // also kick it manually from the settings page.
    void maybeRebuildStyleProfile(input.requestedById).catch(() => {});

    return {
      jobId: created.id,
      deckTitle: result.deckTitle,
      slideCount: result.slides.length,
    };
  } catch (err) {
    const code =
      err instanceof WizardForgeError
        ? err.code
        : err instanceof AiUnavailableError
          ? 'AI_UNAVAILABLE'
          : 'FORGE_FAILED';
    // `err.message` from AI provider errors is already a user-safe generic
    // string ("The AI assistant is temporarily unavailable…"). Server logs
    // get the rich `.detail` via the error object's own enumerable props.
    if (err instanceof AiUnavailableError || err instanceof AiUnparseableError) {
      console.error('[wizard-forge] AI provider failure', err);
    }
    const message =
      err instanceof Error ? err.message : 'We couldn’t complete this just now — please try again.';
    await db.deckForgeJob.update({
      where: { id: created.id },
      data: { status: DeckForgeStatus.FAILED, errorMessage: message.slice(0, 1000) },
    });
    throw err instanceof WizardForgeError ? err : new WizardForgeError(code, message);
  }
}

/**
 * Best-effort: if the faculty has accumulated REBUILD_AFTER_N_NEW_SIGNALS
 * un-processed signals since the last build (or has none AND has crossed
 * the first-build threshold), kick a Gemini distillation. Called after a
 * successful forge but its outcome is invisible to that forge — fresh rules
 * land in time for the NEXT forge, not this one.
 */
async function maybeRebuildStyleProfile(facultyId: string): Promise<void> {
  const [existing, unprocessed] = await Promise.all([
    db.facultyStyleProfile.findUnique({
      where: { facultyId },
      select: { signalCountAtBuild: true },
    }),
    db.facultyEditSignal.count({ where: { facultyId, processedAt: null } }),
  ]);
  if (unprocessed < REBUILD_AFTER_N_NEW_SIGNALS) return;
  if (existing && unprocessed < REBUILD_AFTER_N_NEW_SIGNALS) return;
  await rebuildFacultyStyleProfile(facultyId);
}
