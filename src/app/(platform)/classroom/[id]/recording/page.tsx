// ════════════════════════════════════════════════════════════════════════════
// /classroom/[id]/recording — YouTube-style HLS playback page
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/auth';
import { RecordingViewer } from '@/components/recording/recording-viewer';
import type { SessionPearl } from '@/components/recording/session-pearls-tab';
import {
  listSessionRecordings,
  RecordingAccessError,
} from '@/server/services/recordings/recording-service';
import { getBookmarkState, getPearlLikeState } from '@/server/services/engagement-service';
import { db } from '@/lib/db';
import { RecordingStatus, Role } from '@prisma/client';
import pearlsData from '@/mock-data/pearls.json';
import type { ChecklistObjective } from '@/components/classroom/objectives-checklist';

interface StoredObjective { id: string; text: string; blooms: number }

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface MockPearl {
  id: string; question: string; answer: string; mechanism: string;
  condition: string; subspecialty: string; category: string;
  citation: { authors: string; title: string; journal: string; year: number; doi: string };
  bloomsLevel: number; tags: string[]; difficulty: string;
}

// States where the recording pipeline is still running AND no HLS is ready.
// If hlsUrl is set, we always show the player regardless of status (captions
// may still be processing). Only show the spinner for these when hlsUrl = null.
const PROCESSING_STATES = new Set<RecordingStatus>([
  RecordingStatus.RECORDING,
  RecordingStatus.RECORDING_PARTIAL,
  RecordingStatus.TRANSCODING,
]);

const FAILED_STATES = new Set<RecordingStatus>([
  RecordingStatus.RECORDING_FAILED,
  RecordingStatus.TRANSCODING_FAILED,
  RecordingStatus.TRANSCRIBING_FAILED,
  RecordingStatus.AI_PROCESSING_FAILED,
]);

export default async function ClassroomRecordingPage({ params }: PageProps) {
  const [{ id: sessionId }, session] = await Promise.all([params, auth()]);
  if (!session?.user) redirect(`/login?next=/classroom/${sessionId}/recording`);

  const recordings = await listSessionRecordings(
    { userId: session.user.id, role: session.user.role },
    sessionId
  ).catch((err) => {
    if (err instanceof RecordingAccessError && err.code === 'FORBIDDEN') return null;
    throw err;
  });

  if (recordings === null) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <h1 className="text-2xl font-bold">Access denied</h1>
        <p className="mt-2 text-muted-foreground">You do not have permission to view this session.</p>
      </div>
    );
  }
  // No recording artifact, but a transcript may exist. Synthesize a recording
  // shape so the same RecordingViewer chrome renders — viewer shows a "no video"
  // placeholder in the player frame and keeps tabs / sidebar / discussion intact.
  let rec: typeof recordings[number] | {
    id: string
    hlsUrl: string | null
    thumbnailUrl: string | null
    durationSec: number | null
    status: RecordingStatus
    failureReason: string | null
    transcripts: { language: string; source: string; vttUrl: string | null }[]
  };
  if (recordings.length === 0) {
    const transcript = await db.sessionTranscript.findUnique({
      where: { sessionId_language: { sessionId, language: 'en' } },
      select: { id: true },
    });
    if (!transcript) notFound();
    rec = {
      id: `transcript:${transcript.id}`,
      hlsUrl: null,
      thumbnailUrl: null,
      durationSec: null,
      status: RecordingStatus.READY,
      failureReason: null,
      transcripts: [{
        language: 'en',
        // Provider-neutral label — never expose the upstream ASR vendor name.
        source: 'asr',
        vttUrl: `/api/classroom/sessions/${sessionId}/captions/transcript?format=vtt`,
      }],
    };
  } else {
    rec = recordings[0];
  }

  const sessionMeta = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      title: true, description: true, scheduledStart: true, scheduledEnd: true,
      hostId: true, tags: true, objectives: true,
      host: { select: { name: true } },
    },
  });

  // Authority checks (server-computed; never trust the client)
  const canPin =
    session.user.role === Role.ADMIN ||
    session.user.role === Role.PROGRAM_DIRECTOR ||
    sessionMeta?.hostId === session.user.id;

  const canShare = canPin;
  const canAnswer = canPin || session.user.role === Role.FACULTY;

  // ─── Resolve session duration ────────────────────────────────────────────
  const durationSec = rec.durationSec ?? null;

  // ─── Resolve pearls for this session (tag overlap) ────────────────────────
  const sessionTags = (sessionMeta?.tags ?? []).map((t) => t.toLowerCase());
  const allPearls = pearlsData as MockPearl[];

  const relevantPearls = sessionTags.length > 0
    ? allPearls.filter((p) => p.tags.some((t) => sessionTags.includes(t.toLowerCase())))
    : [];

  const [bookmarkSet, pearlLikeState, pearlBookmarkSet] = await Promise.all([
    getBookmarkState({
      userId: session.user.id,
      targetType: 'RECORDING',
      targetIds: [rec.id],
    }),
    relevantPearls.length > 0
      ? getPearlLikeState({ pearlIds: relevantPearls.map((p) => p.id), userId: session.user.id })
      : Promise.resolve({ likeCounts: new Map<string, number>(), likedByMe: new Set<string>() }),
    relevantPearls.length > 0
      ? getBookmarkState({ userId: session.user.id, targetType: 'PEARL', targetIds: relevantPearls.map((p) => p.id) })
      : Promise.resolve(new Set<string>()),
  ]);

  const isBookmarked = bookmarkSet.has(rec.id);

  // ─── Objectives + this user's marks (post-session checklist) ────────────
  const storedObjectives = (sessionMeta?.objectives as unknown as StoredObjective[] | null) ?? [];
  let objectiveChecklist: ChecklistObjective[] = [];
  if (storedObjectives.length > 0) {
    const myObjectiveMarks = await db.sessionObjectiveAchievement.findMany({
      where: { sessionId, userId: session.user.id },
      select: { objectiveId: true, status: true },
    });
    const markByObjId = new Map(myObjectiveMarks.map((m) => [m.objectiveId, m.status]));
    objectiveChecklist = storedObjectives.map((o) => ({
      id: o.id,
      text: o.text,
      blooms: o.blooms,
      myStatus: markByObjId.get(o.id) ?? null,
    }));
  }

  const pearls: SessionPearl[] = relevantPearls.map((p) => ({
    id: p.id,
    question: p.question,
    answer: p.answer,
    mechanism: p.mechanism,
    condition: p.condition,
    subspecialty: p.subspecialty,
    category: p.category,
    citation: p.citation,
    bloomsLevel: p.bloomsLevel,
    tags: p.tags,
    difficulty: p.difficulty,
    likeCount: pearlLikeState.likeCounts.get(p.id) ?? 0,
    likedByMe: pearlLikeState.likedByMe.has(p.id),
    bookmarkedByMe: pearlBookmarkSet.has(p.id),
  }));

  return (
    <div className="mx-auto max-w-350 space-y-5 px-4 py-6">
      <Link
        href="/classroom"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back to sessions
      </Link>

      {/* Always render the RecordingViewer when we have any rec (real or synthetic).
          The viewer renders a "no video" placeholder in the player frame when
          hlsUrl is null, so the chrome (tabs / sidebar / discussion) stays consistent.
          Processing/failed banners only fire for in-flight real recordings. */}
      {!rec.hlsUrl && PROCESSING_STATES.has(rec.status) ? (
        <ProcessingBanner status={rec.status} />
      ) : !rec.hlsUrl && FAILED_STATES.has(rec.status) ? (
        <FailedBanner reason={rec.failureReason} />
      ) : (
        <RecordingViewer
          sessionId={sessionId}
          sessionTitle={sessionMeta?.title ?? 'Recording'}
          hostName={sessionMeta?.host?.name ?? null}
          scheduledStart={sessionMeta?.scheduledStart ?? new Date()}
          durationSec={durationSec}
          hlsUrl={rec.hlsUrl}
          posterUrl={rec.thumbnailUrl}
          tracks={rec.transcripts.map((t) => ({
            language: t.language,
            source: t.source,
            vttUrl: t.vttUrl || null,
          }))}
          currentUser={{ id: session.user.id, role: session.user.role }}
          canPin={canPin}
          canAnswer={canAnswer}
          recordingId={rec.id}
          initialBookmarked={isBookmarked}
          canShare={canShare}
          pearls={pearls}
          objectives={
            (session.user.role === Role.RESIDENT || session.user.role === Role.EXTERNAL_LEARNER)
              ? objectiveChecklist
              : []
          }
        />
      )}
    </div>
  );
}

function ProcessingBanner({ status }: { status: RecordingStatus }) {
  const labelMap: Record<string, string> = {
    RECORDING: 'Recording in progress…',
    RECORDING_PARTIAL: 'Finishing recording…',
    TRANSCODING: 'Transcoding to HLS — usually under 10 minutes.',
    TRANSCRIBING: 'Generating captions — ~60–90 minutes for a 1-hour lecture.',
    AI_PROCESSING: 'Extracting pearls + AI summary — ~2 hours total.',
  };
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
      <div className="flex items-center gap-3">
        <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        <h2 className="text-lg font-bold">Processing</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{labelMap[status] ?? `Status: ${status}`}</p>
    </div>
  );
}

function FailedBanner({ reason }: { reason: string | null }) {
  const noMedia = reason === 'Start signal not received';
  if (noMedia) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
        <h2 className="text-lg font-bold text-amber-700 dark:text-amber-300">No media was captured</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The session ended before any participant published audio or video. The session is logged for
          audit (attendance, chat, Q&amp;A) — only the media file is missing.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <h2 className="text-lg font-bold text-destructive">Recording unavailable</h2>
      <p className="mt-2 text-sm text-muted-foreground">{reason ?? 'Unknown failure.'}</p>
    </div>
  );
}
