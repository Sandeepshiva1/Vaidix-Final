// ════════════════════════════════════════════════════════════════════════════
// SessionTranscript service — append + finalize + read
// ════════════════════════════════════════════════════════════════════════════
// Pairs with the live captions producer (Deepgram in Phase 1). Each finalized
// utterance arriving from the producer's WebSocket gets POSTed to /publish,
// which forwards to `appendSegment` here for durable storage in addition to
// publishing on Redis pub/sub for the live SSE overlay.
//
// Why a service layer (instead of inlining in the route handler): the same
// append path will be called by the Phase-2 Sarvam producer, and a future
// "manual edit" path on the post-session transcript editor — keeping the
// merge/cap/concat logic in one place.

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

/** Segment shape persisted into `SessionTranscript.segments`. */
export interface PersistedTranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** Vaidix user.id of the speaker, when known (host's local participant). */
  speakerId?: string | null;
  /** Display name cached so the export endpoint doesn't have to re-join. */
  speakerName?: string | null;
  /** Deepgram confidence 0..1, if the producer reported one. */
  confidence?: number | null;
}

/// Hard ceiling — a 60-min lecture at ~5 utterances/sec would only hit ~18k.
/// 50k is generous headroom; once exceeded we stop appending to protect DB
/// row size. The producer's rate-limit (CAPTIONS_PUBLISH) is the soft cap.
const LIVE_TRANSCRIPT_MAX_SEGMENTS = 50_000;
/// Match `SessionTranscript.contentText` cap. db.Text on Postgres is unbounded
/// but we still want a sane ceiling so a stuck producer can't fill the disk.
const LIVE_TRANSCRIPT_MAX_TEXT_BYTES = 4 * 1024 * 1024;

export interface AppendResult {
  /** Total segment count after the append. */
  segmentCount: number;
  /** True when the row was created on this call. */
  created: boolean;
  /** True when the cap was hit and the segment was dropped. */
  capped: boolean;
}

/**
 * Append a finalized caption segment to the SessionTranscript for
 * (sessionId, language). Creates the row on first call. Idempotent:
 * accidental duplicate POSTs of the same segment are deduped by exact
 * `(startMs, endMs, text)` match against the last 10 entries.
 */
export async function appendSegment(args: {
  sessionId: string;
  language: string;
  source: 'deepgram' | 'sarvam' | 'manual';
  segment: PersistedTranscriptSegment;
}): Promise<AppendResult> {
  const { sessionId, language, source, segment } = args;

  // We can't do a single jsonb_insert atomically through Prisma's typed
  // client without a raw query, but the producer is single-writer per
  // session (only the host's browser publishes), so a read-modify-write
  // inside a transaction is contention-free.
  return db.$transaction(async (tx) => {
    const existing = await tx.sessionTranscript.findUnique({
      where: { sessionId_language: { sessionId, language } },
      select: { id: true, segments: true, contentText: true, finalized: true },
    });

    if (!existing) {
      await tx.sessionTranscript.create({
        data: {
          sessionId,
          language,
          source,
          segments: [segment] as unknown as Prisma.InputJsonValue,
          contentText: segment.text,
        },
      });
      return { segmentCount: 1, created: true, capped: false };
    }

    if (existing.finalized) {
      // Lock — finalized rows are read-only.
      return { segmentCount: (existing.segments as unknown as unknown[]).length, created: false, capped: true };
    }

    const segments = (existing.segments as unknown as PersistedTranscriptSegment[]) ?? [];
    if (segments.length >= LIVE_TRANSCRIPT_MAX_SEGMENTS) {
      return { segmentCount: segments.length, created: false, capped: true };
    }

    // Dedupe: producer may retry on transient network blips. Compare against
    // the last 10 entries to avoid an O(n) scan on 50k-entry arrays.
    const tail = segments.slice(-10);
    const dup = tail.some(
      (s) => s.startMs === segment.startMs && s.endMs === segment.endMs && s.text === segment.text,
    );
    if (dup) {
      return { segmentCount: segments.length, created: false, capped: false };
    }

    const nextSegments = [...segments, segment];
    const sep = existing.contentText.length > 0 ? ' ' : '';
    const nextText = (existing.contentText + sep + segment.text).slice(0, LIVE_TRANSCRIPT_MAX_TEXT_BYTES);

    await tx.sessionTranscript.update({
      where: { id: existing.id },
      data: {
        segments: nextSegments as unknown as Prisma.InputJsonValue,
        contentText: nextText,
      },
    });
    return { segmentCount: nextSegments.length, created: false, capped: false };
  });
}

/**
 * Mark a transcript finalized (row becomes read-only). Called when the host
 * leaves the session or the recording's transcribe-worker takes over.
 */
export async function finalizeTranscript(args: {
  sessionId: string;
  language: string;
}): Promise<{ finalized: boolean }> {
  const updated = await db.sessionTranscript.updateMany({
    where: { sessionId: args.sessionId, language: args.language, finalized: false },
    data: { finalized: true, finalizedAt: new Date() },
  });
  return { finalized: updated.count > 0 };
}

export interface SessionTranscriptRead {
  id: string;
  sessionId: string;
  language: string;
  source: string;
  segments: PersistedTranscriptSegment[];
  contentText: string;
  finalized: boolean;
  startedAt: Date;
  finalizedAt: Date | null;
}

/**
 * Read all transcripts for a session (one per language) — used by the
 * post-session export endpoint. Caller is expected to gate access first
 * (host / cohort member / admin etc.).
 */
export async function listTranscriptsForSession(
  sessionId: string,
): Promise<SessionTranscriptRead[]> {
  const rows = await db.sessionTranscript.findMany({
    where: { sessionId },
    orderBy: { startedAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    language: r.language,
    source: r.source,
    segments: (r.segments as unknown as PersistedTranscriptSegment[]) ?? [],
    contentText: r.contentText,
    finalized: r.finalized,
    startedAt: r.startedAt,
    finalizedAt: r.finalizedAt,
  }));
}
