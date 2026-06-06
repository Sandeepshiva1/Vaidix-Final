// ════════════════════════════════════════════════════════════════════════════
// Deck Forge Service — Phase A
// ════════════════════════════════════════════════════════════════════════════
// Turns a source (uploaded PDF/DOC/PPT/notes Document, or a recording's
// Transcript, or both) into a structured set of `Slide` rows hanging off a
// `DeckForgeJob`. Slides are first-class — editable, reorderable, the source
// of truth for both the in-app presenter and the .pptx export.
//
// Gemini is the AI provider ; Phase B swaps in Vaidix Core SLM
// behind the same interface. PDFs are sent as inline multimodal data so we
// don't need a separate PDF-parser dependency.

import { db } from '@/lib/db';
import { s3, BUCKET, isLocalStorageBackend, localUploadPath } from '@/lib/storage';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { promises as fs } from 'node:fs';
import {
  DeckForgeStatus,
  DeckForgeSource,
  SlideLayout,
  DocumentKind,
  type Prisma,
} from '@prisma/client';
import {
  geminiGenerate,
  GeminiUnavailableError,
  GeminiUnparseableError,
  tryParseJson,
} from '@/server/services/ai/gemini';
import { claudeGenerate } from '@/server/services/ai/claude';
import { env } from '@/lib/env';
import { persistDeckAsDocument } from './deck-pptx-renderer';
import { extractOfficeText, isExtractableOffice } from './document-text-extract';
import { convertOfficeToPdf, isConvertibleToPdf } from './office-to-pdf';
import { classifySource } from './source-classifier';
import { importVerbatimDeck } from './verbatim-import-service';

const SYSTEM_PROMPT = `You are an ophthalmology medical educator + instructional designer at LV Prasad Eye Institute.
You convert source teaching material into a clean, lecture-ready slide outline for a 60-minute live session.

OUTPUT — strict JSON, no prose, no markdown fences:
{
  "deckTitle": string,
  "slides": [
    {
      "layout": "TITLE_ONLY" | "TITLE_BULLETS" | "TWO_COLUMN" | "IMAGE_FOCUS" | "QUOTE" | "INTERACTION" | "CLOSING",
      "title": string,            // <= 90 chars
      "bullets": string[],        // 0-6 items, each <= 140 chars; empty for TITLE_ONLY/CLOSING
      "speakerNotes": string,     // 1-3 sentences for the presenter; <= 400 chars
      "citation": string | null   // short ref to where in source this came from (e.g. "Section 2", "Transcript 12:30-14:00")
    }
  ]
}

STRUCTURE RULES
- 14-22 slides total for a 1-hour lecture. Open with TITLE_ONLY hero, close with CLOSING.
- Bullets are crisp phrases, not full sentences. No trailing periods on bullets.
- CLOSING is "Thank you" or "Q&A". Title slides use the deck title.
- Order matters — slides render in array order.

PEDAGOGY RULES (VARK multimodal — ophthalmology residency)
- Tailor depth to the stated learner level. Interns/PGY-1 need anatomy-first, classification-heavy.
  Senior residents/fellows need decision-points, evidence, and edge cases.
- Include AT LEAST ONE IMAGE_FOCUS slide for visual learning (slit-lamp / fundus / OCT / FFA / ICGA /
  USG / surgical-step image placeholders). Title states what the image shows; bullet[0] is the caption
  / interpretation key.
- Include AT LEAST ONE INTERACTION slide every 6-8 slides (poll, T/F, key-feature question, clinical
  dilemma). Each option is a separate bullet, written as a discrete answer choice.
- Include AT LEAST ONE INTERACTION slide formatted as a competency-check question testing the most
  diagnostic discriminator for this topic (e.g. AAC vs PAC, NPDR severity, masquerade syndromes).
- Include EXACTLY ONE slide near the end titled "Common pitfalls" or "Learner errors" with 4-6 bullets
  capturing where residents most often go wrong on this topic.
- Speaker notes carry the *why* — the reasoning a presenter would say aloud. Bullets carry the *what*.

CONTENT RULES
- Anchor every clinical claim to the source. Never invent dosages, drug names, classification cutoffs,
  or procedural steps that aren't in the source. If the source is sparse, output fewer slides.
- Ophthalmology-specific vocabulary throughout — slit-lamp, fundoscopy, OCT, FFA, ICGA, ultrasonography,
  laser, wet-lab, microsurgery, slit-lamp findings, intraocular landmarks. No generic "the patient
  presents…" pablum.
- Where source mentions an imaging modality, prefer IMAGE_FOCUS for that slide.
- Where source mentions a classification system (e.g. ETDRS, Shaffer, Spaeth, AAO PPP), put the
  classification on a TWO_COLUMN slide so it scans cleanly.

TALK ARCHITECTURE — learner-centered presentation principles
- Slide 2 (right after the TITLE_ONLY hero) is an EMPOWERMENT PROMISE: title "By the end you will…"
  with ≤3 measurable verb-led bullets (diagnose, classify, choose, manage). Skip a separate "Objectives"
  slide if this covers them.
- Identify ONE CORE MESSAGE for the deck. Echo it in (a) the hero subtitle/notes, (b) at least one
  mid-deck slide title, (c) CLOSING bullet[0]. This is the single sentence the learner must walk out with.
- Plant up to 4 ATTENTION HOOKS spread across the deck (around slide 2-3, mid-deck, just before the
  pitfalls slide, last content slide). Each hook is one of: thought-provoking question / striking statistic
  / 1-line clinical vignette / bold statement / brief quote. Mark each with a "HOOK:" prefix in speakerNotes
  so the presenter spots it.
- The first slide of each major section starts with a TRANSITION bullet phrased "From X → to Y" so the
  deck flows like a story, not a stack.
- CLOSING bullet[0] is an ACTIONABLE TAKE-HOME — the one clinically implementable thing the resident
  will change in clinic on Monday. Not "Thank you" alone.

SPEAKER NOTES STYLE — voice + body
- Use CAPS for words to emphasize, "/" for a pause, "..." for a slow-down moment.
  Example: "AAC and PAC LOOK similar / but the cup-to-disc ratio in AAC is NORMAL ... that's the trap."
- Respect prior knowledge. No "this is simple", "everyone knows", or absolute claims unless the source
  justifies them.
- For 3-4 key slides (opening, IMAGE_FOCUS, INTERACTION, CLOSING) append a "STAGE:" line at the end of
  speakerNotes with posture / gesture / eye-contact hint.
  Example: "STAGE: step forward, hold eye contact with the back row, hand on the image."
- For IMAGE_FOCUS, speakerNotes MUST (1) name what to look for first, (2) include "...pause 3s..." for
  the visual scan, and (3) note if a side-by-side comparison would teach better.

TIME BUDGET
- Append "TIME: ~Xm" at the end of speakerNotes on non-trivial slides — TITLE 0.5m, content 2-3m,
  INTERACTION 3-5m, IMAGE_FOCUS 3-4m, CLOSING 1m. The sum should approximate the target session length.`;

interface RawSlide {
  layout?: string;
  title?: unknown;
  bullets?: unknown;
  speakerNotes?: unknown;
  citation?: unknown;
}

interface ForgeResult {
  deckTitle: string;
  slides: Array<{
    layout: SlideLayout;
    title: string;
    bullets: string[];
    speakerNotes: string;
    citation: string | null;
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

function normalizeSlides(parsed: { deckTitle?: unknown; slides?: unknown }): ForgeResult {
  const deckTitle =
    typeof parsed.deckTitle === 'string' && parsed.deckTitle.trim()
      ? parsed.deckTitle.trim().slice(0, 120)
      : 'Untitled Deck';

  const raw: RawSlide[] = Array.isArray(parsed.slides) ? (parsed.slides as RawSlide[]) : [];
  const slides = raw
    .slice(0, 30) // hard ceiling — refuse decks that drift to filler
    .map((s) => {
      const layout = (
        ALLOWED_LAYOUTS.includes(s.layout as SlideLayout) ? s.layout : 'TITLE_BULLETS'
      ) as SlideLayout;
      const title = typeof s.title === 'string' ? s.title.slice(0, 200) : 'Untitled slide';
      const bullets = Array.isArray(s.bullets)
        ? (s.bullets as unknown[])
            .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
            .slice(0, 6)
            .map((b) => b.trim().slice(0, 200))
        : [];
      const speakerNotes =
        typeof s.speakerNotes === 'string' ? s.speakerNotes.slice(0, 1000) : '';
      const citation =
        typeof s.citation === 'string' && s.citation.trim() ? s.citation.trim().slice(0, 200) : null;
      return { layout, title, bullets, speakerNotes, citation };
    })
    .filter((s) => s.title.trim().length > 0);

  return { deckTitle, slides };
}

interface DocumentSource {
  kind: 'document';
  documentId: string;
  title: string;
  description: string | null;
  s3Key: string;
  mimeType: string;
  documentKind: DocumentKind;
  pageCount: number | null;
}

interface TranscriptSource {
  kind: 'transcript';
  recordingId: string;
  language: string;
  content: string;
  sessionTitle: string;
}

async function loadDocumentSource(documentId: string): Promise<DocumentSource | null> {
  const doc = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      description: true,
      s3Key: true,
      mimeType: true,
      kind: true,
      pageCount: true,
      deletedAt: true,
    },
  });
  if (!doc || doc.deletedAt) return null;
  return {
    kind: 'document',
    documentId: doc.id,
    title: doc.title,
    description: doc.description,
    s3Key: doc.s3Key,
    mimeType: doc.mimeType,
    documentKind: doc.kind,
    pageCount: doc.pageCount,
  };
}

async function loadTranscriptSource(recordingId: string): Promise<TranscriptSource | null> {
  const recording = await db.recording.findUnique({
    where: { id: recordingId },
    select: {
      id: true,
      session: { select: { title: true } },
      transcripts: {
        select: { language: true, content: true },
        // Prefer English; fall back to whichever language exists.
        orderBy: { language: 'asc' },
      },
    },
  });
  if (!recording) return null;
  const en = recording.transcripts.find((t) => t.language === 'en');
  const chosen = en ?? recording.transcripts[0];
  if (!chosen) return null;
  return {
    kind: 'transcript',
    recordingId: recording.id,
    language: chosen.language,
    content: chosen.content,
    sessionTitle: recording.session.title,
  };
}

async function fetchDocumentBytes(
  source: { s3Key: string; documentId: string; mimeType: string },
): Promise<{ data: string; mimeType: string }> {
  // Local-FS dev backend: bytes live at .local-uploads/<documentId>. The
  // s3Key on these rows is the sentinel "local:<id>" but we don't rely on
  // parsing it — the documentId is authoritative.
  let buf: Buffer;
  let mimeType = source.mimeType ?? 'application/octet-stream';
  if (isLocalStorageBackend()) {
    try {
      buf = await fs.readFile(localUploadPath(source.documentId));
    } catch {
      throw new Error(`Local upload missing for document ${source.documentId}`);
    }
  } else {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: source.s3Key }));
    const stream = out.Body as ReadableStream<Uint8Array> | NodeJS.ReadableStream | undefined;
    if (!stream) throw new Error('Empty S3 body for document');
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    buf = Buffer.concat(chunks);
    if (out.ContentType) mimeType = out.ContentType;
  }
  // Gemini multimodal limit is generous but we cap at 18 MB to stay safe.
  if (buf.byteLength > 18 * 1024 * 1024) {
    throw new Error(`Source too large for inline Gemini (${buf.byteLength} bytes)`);
  }
  return { data: buf.toString('base64'), mimeType };
}

const GEMINI_INLINE_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
]);

function canSendInline(mimeType: string): boolean {
  return GEMINI_INLINE_MIMES.has(mimeType);
}

export interface ForgeInput {
  documentId?: string | null;
  recordingId?: string | null;
  /**
   * Topic-only path: generate a deck purely from a typed topic prompt with no
   * uploaded document and no recording. Mutually exclusive in practice with a
   * document/recording source, but if both are given the source path wins.
   */
  topic?: string | null;
  requestedById: string;
  inputTitle?: string;
  /** e.g. "PGY-1 resident", "senior resident", "vitreoretinal fellow". Defaults to "ophthalmology resident". */
  learnerLevel?: string;
  /** Target number of slides (topic path). Clamped 4–40; defaults to ~12. */
  slideCount?: number;
}

export class DeckForgeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export interface ForgeOutcome {
  jobId: string;
  deckTitle: string;
  slideCount: number;
}

/**
 * Shared generation core: take the assembled Gemini `userParts`, call the
 * model, parse + normalize the result, and persist Slide rows under an
 * already-created DeckForgeJob. Both the document/transcript path and the
 * topic-only path funnel through here so the model-call / parse / persist
 * machinery lives in exactly one place. Citation back-refs (documentId /
 * recordingId) are passed through; the topic path leaves both null.
 */
async function generateAndPersistSlides(args: {
  jobId: string;
  userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  documentId: string | null;
  recordingId: string | null;
  /** Topic-only path: do the FIRST generation on Opus (deeper reasoning), then
   *  fall back to Gemini if Opus is unavailable. Later in-editor enhancement
   *  stays on Gemini. Only honoured when every part is text (no inline files). */
  preferOpus?: boolean;
}): Promise<ForgeOutcome> {
  const { jobId, userParts } = args;

  await db.deckForgeJob.update({
    where: { id: jobId },
    data: { status: DeckForgeStatus.GENERATING_SLIDES },
  });

  const onlyText = userParts.every((p) => 'text' in p);
  let raw: string;
  if (args.preferOpus && onlyText) {
    const userMessage = userParts.map((p) => ('text' in p ? p.text : '')).join('\n\n');
    try {
      raw = await claudeGenerate({
        systemInstruction: SYSTEM_PROMPT,
        userMessage,
        model: env.ANTHROPIC_OPUS_MODEL,
        maxTokens: 8192,
      });
    } catch (err) {
      // Opus down (no key / billing / offline) — don't fail the forge; fall
      // back to Gemini so topic generation still works in this environment.
      console.error('[deck-forge] Opus unavailable for topic deck, using Gemini', err);
      raw = await geminiGenerate({
        systemInstruction: SYSTEM_PROMPT,
        userParts,
        responseMimeType: 'application/json',
        temperature: 0.35,
      });
    }
  } else {
    raw = await geminiGenerate({
      systemInstruction: SYSTEM_PROMPT,
      userParts,
      responseMimeType: 'application/json',
      temperature: 0.35,
    });
  }
  const parsed = tryParseJson<{ deckTitle?: unknown; slides?: unknown }>(raw);
  const result = normalizeSlides(parsed);

  if (result.slides.length === 0) {
    throw new DeckForgeError('EMPTY_DECK', 'AI returned no usable slides');
  }

  const slideRows: Prisma.SlideCreateManyInput[] = result.slides.map((s, i) => ({
    deckForgeJobId: jobId,
    order: i,
    layout: s.layout,
    title: s.title,
    bullets: s.bullets,
    speakerNotes: s.speakerNotes || null,
    sourceCitations: s.citation
      ? [
          {
            documentId: args.documentId,
            recordingId: args.recordingId,
            note: s.citation,
          },
        ]
      : undefined,
  }));

  await db.$transaction(async (tx) => {
    await tx.slide.createMany({ data: slideRows });
    await tx.deckForgeJob.update({
      where: { id: jobId },
      data: {
        status: DeckForgeStatus.REVIEW_PENDING,
        slideCount: result.slides.length,
        inputTitle: result.deckTitle,
      },
    });
  });

  // Surface the forged deck in the faculty's documents library. Best-effort:
  // we already committed the slides above, so a render/upload failure must
  // not propagate as a forge failure.
  await persistDeckAsDocument({ jobId });

  return { jobId, deckTitle: result.deckTitle, slideCount: result.slides.length };
}

/**
 * Topic-only forge: build a deck purely from a typed topic prompt — no
 * uploaded document, no recording. There is no inline file part; the "source"
 * is the topic text embedded in the prompt. Persistence + model-call + parse
 * all reuse `generateAndPersistSlides`, the same machinery the document path
 * uses. The job is stored with the default DOCUMENT sourceKind (the
 * DeckForgeSource enum has no topic value and we must not add one) and the
 * topic recorded as the inputTitle.
 */
async function forgeDeckFromTopic(
  input: ForgeInput & { topic: string },
): Promise<ForgeOutcome> {
  const learnerLevel = input.learnerLevel ?? 'ophthalmology resident at LVPEI';
  const slideCount = Math.max(4, Math.min(40, Math.round(input.slideCount ?? 12)));

  const job = await db.deckForgeJob.create({
    data: {
      documentId: null,
      recordingId: null,
      sourceKind: DeckForgeSource.DOCUMENT,
      requestedById: input.requestedById,
      status: DeckForgeStatus.EXTRACTING,
      inputTitle: input.inputTitle ?? input.topic.slice(0, 120),
    },
    select: { id: true },
  });

  try {
    const userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    const headerLines: string[] = [
      `Target learner: ${learnerLevel}`,
      `Target session length: 60 minutes`,
      `Produce approximately ${slideCount} slides (including a title slide and a`,
      `summary/key-takeaways slide).`,
      `No source document or recording was provided — generate a complete,`,
      `evidence-minded educational deck ABOUT the topic below from established`,
      `ophthalmology knowledge appropriate to the stated learner level. Anchor`,
      `claims to standard teaching; do not invent dosages, drug names, or`,
      `classification cutoffs. Use citations to name the concept area (e.g.`,
      `"AAO PPP", "ETDRS") rather than a source location.`,
    ];
    userParts.push({ text: headerLines.join('\n') });
    userParts.push({ text: `--- TOPIC ---\n${input.topic.slice(0, 4000)}\n--- END TOPIC ---` });
    userParts.push({ text: 'Produce the slide outline JSON now.' });

    return await generateAndPersistSlides({
      jobId: job.id,
      userParts,
      documentId: null,
      recordingId: null,
      // First generation on Opus (deeper clinical reasoning); enhancement later
      // happens on Gemini in the editor.
      preferOpus: true,
    });
  } catch (err) {
    if (err instanceof GeminiUnavailableError || err instanceof GeminiUnparseableError) {
      console.error('[deck-forge] AI provider failure', err);
    }
    const message =
      err instanceof DeckForgeError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'We couldn’t complete this just now — please try again.';
    await db.deckForgeJob.update({
      where: { id: job.id },
      data: { status: DeckForgeStatus.FAILED, errorMessage: message.slice(0, 1000) },
    });
    throw err instanceof DeckForgeError ? err : new DeckForgeError('FORGE_FAILED', message);
  }
}

/**
 * Orchestrates a forge: load source(s), call Gemini, persist Slide rows under
 * a new DeckForgeJob. Synchronous  — runs inside the request because
 * Gemini-text returns in seconds. Phase B will move to a BullMQ worker.
 */
export async function forgeDeck(input: ForgeInput): Promise<ForgeOutcome> {
  const topic = input.topic?.trim() || null;
  if (!input.documentId && !input.recordingId && !topic) {
    throw new DeckForgeError('NO_SOURCE', 'A documentId, recordingId, or topic is required');
  }
  if (!env.GEMINI_API_KEY) {
    throw new DeckForgeError('AI_UNAVAILABLE', 'GEMINI_API_KEY is not set');
  }

  // Topic-only path: no uploaded document, no recording. The "source" is the
  // typed topic string embedded in the prompt. Only taken when neither a
  // document nor a recording was supplied — a real source always wins.
  if (!input.documentId && !input.recordingId && topic) {
    return forgeDeckFromTopic({ ...input, topic });
  }

  const documentSource = input.documentId ? await loadDocumentSource(input.documentId) : null;
  const transcriptSource = input.recordingId ? await loadTranscriptSource(input.recordingId) : null;

  if (input.documentId && !documentSource) {
    throw new DeckForgeError('SOURCE_NOT_FOUND', 'Document not found or deleted');
  }
  if (input.recordingId && !transcriptSource) {
    throw new DeckForgeError('SOURCE_NOT_FOUND', 'Transcript not available for this recording');
  }

  const sourceKind: DeckForgeSource =
    documentSource && transcriptSource ? 'HYBRID' : transcriptSource ? 'TRANSCRIPT' : 'DOCUMENT';

  const job = await db.deckForgeJob.create({
    data: {
      documentId: documentSource?.documentId ?? null,
      recordingId: transcriptSource?.recordingId ?? null,
      sourceKind,
      requestedById: input.requestedById,
      status: DeckForgeStatus.EXTRACTING,
      inputTitle:
        input.inputTitle ?? documentSource?.title ?? transcriptSource?.sessionTitle ?? 'Forged Deck',
    },
    select: { id: true },
  });

  try {
    // ── Verbatim import ──────────────────────────────────────────────────────
    // If the uploaded document ALREADY is a slide deck (PPTX/Keynote, or a PDF
    // whose pages look like slides) we show it as-is — a 1:1 editable copy plus
    // a rasterised "Original" view — instead of re-authoring it with the model.
    // Only for a pure document source: a transcript/hybrid always needs the AI
    // to synthesise. AI suggestions stay available on demand in the editor.
    if (documentSource && !transcriptSource) {
      const { data, mimeType } = await fetchDocumentBytes({
        s3Key: documentSource.s3Key,
        documentId: documentSource.documentId,
        mimeType: documentSource.mimeType,
      });
      const buffer = Buffer.from(data, 'base64');
      const verdict = await classifySource({ mimeType, buffer });
      if (verdict.mode === 'VERBATIM') {
        const { slideCount } = await importVerbatimDeck({
          jobId: job.id,
          requestedById: input.requestedById,
          buffer,
          mimeType,
        });
        return { jobId: job.id, deckTitle: documentSource.title, slideCount };
      }
    }

    // Build the multimodal Gemini prompt.
    const userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    const headerLines: string[] = [
      `Target learner: ${input.learnerLevel ?? 'ophthalmology resident at LVPEI'}`,
      `Target session length: 60 minutes`,
    ];
    if (documentSource) {
      headerLines.push(`Source title: ${documentSource.title}`);
      if (documentSource.description) headerLines.push(`Source description: ${documentSource.description}`);
      headerLines.push(`Source kind: ${documentSource.documentKind}`);
      if (documentSource.pageCount) headerLines.push(`Source pages: ${documentSource.pageCount}`);
    }
    if (transcriptSource) {
      headerLines.push(`Session: ${transcriptSource.sessionTitle}`);
      headerLines.push(`Transcript language: ${transcriptSource.language}`);
    }
    userParts.push({ text: headerLines.join('\n') });

    if (documentSource && canSendInline(documentSource.mimeType)) {
      await db.deckForgeJob.update({
        where: { id: job.id },
        data: { status: DeckForgeStatus.EXTRACTING },
      });
      const { data, mimeType } = await fetchDocumentBytes({
        s3Key: documentSource.s3Key,
        documentId: documentSource.documentId,
        mimeType: documentSource.mimeType,
      });
      userParts.push({ inlineData: { mimeType, data } });
    } else if (documentSource) {
      // PPTX/DOCX/PPT/DOC/Keynote aren't natively read by Gemini inline. Two
      // ways to get their content to the model, best-fidelity first:
      //   (B) Convert to PDF via LibreOffice → inline the PDF (full layout +
      //       images; the only path that handles Keynote).
      //   (A) Otherwise extract plain text locally (pptx/docx) and send that.
      //   Fallback: metadata-only note so we still produce a usable outline.
      await db.deckForgeJob.update({
        where: { id: job.id },
        data: { status: DeckForgeStatus.EXTRACTING },
      });
      const { data } = await fetchDocumentBytes({
        s3Key: documentSource.s3Key,
        documentId: documentSource.documentId,
        mimeType: documentSource.mimeType,
      });
      const srcBuf = Buffer.from(data, 'base64');

      let handled = false;
      if (isConvertibleToPdf(documentSource.mimeType)) {
        const pdf = await convertOfficeToPdf(srcBuf, documentSource.mimeType);
        if (pdf && pdf.byteLength > 0) {
          userParts.push({ inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } });
          handled = true;
        }
      }
      if (!handled && isExtractableOffice(documentSource.mimeType)) {
        const text = await extractOfficeText(srcBuf, documentSource.mimeType);
        if (text.trim()) {
          userParts.push({ text: `--- DOCUMENT CONTENT (extracted) ---\n${text}\n--- END DOCUMENT ---` });
          handled = true;
        }
      }
      if (!handled) {
        userParts.push({
          text: `[Note: source binary type ${documentSource.mimeType} could not be extracted; outlining from title and description only.]`,
        });
      }
    }

    if (transcriptSource) {
      // Cap transcript to keep token budget sane (~15k chars ≈ 1-hour lecture).
      const trimmed = transcriptSource.content.slice(0, 15000);
      userParts.push({
        text: `--- TRANSCRIPT START ---\n${trimmed}\n--- TRANSCRIPT END ---`,
      });
    }

    userParts.push({ text: 'Produce the slide outline JSON now.' });

    return await generateAndPersistSlides({
      jobId: job.id,
      userParts,
      documentId: documentSource?.documentId ?? null,
      recordingId: transcriptSource?.recordingId ?? null,
    });
  } catch (err) {
    // `err.message` from provider errors is already a user-safe generic
    // string. Rich upstream payload lives on `err.detail` for server logs.
    if (err instanceof GeminiUnavailableError || err instanceof GeminiUnparseableError) {
      console.error('[deck-forge] AI provider failure', err);
    }
    const message =
      err instanceof DeckForgeError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'We couldn’t complete this just now — please try again.';
    await db.deckForgeJob.update({
      where: { id: job.id },
      data: { status: DeckForgeStatus.FAILED, errorMessage: message.slice(0, 1000) },
    });
    throw err instanceof DeckForgeError ? err : new DeckForgeError('FORGE_FAILED', message);
  }
}
