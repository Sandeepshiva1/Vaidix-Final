// ════════════════════════════════════════════════════════════════════════════
// AI Promo Teaser Video Service — W6.8 (Feeddback #1, video form)
// ════════════════════════════════════════════════════════════════════════════
// Faculty triggers POST /api/promo/teaser-video → service queues a render job.
// The worker (`promo-teaser-render` in reel-render-worker.ts) generates 3
// SVG cards (title / hook / CTA), rasterizes each via @resvg/resvg-js, then
// FFmpeg concatenates them into a 15-sec silent vertical 1080×1920 MP4.
//
// Output is stored as a `Document` row with route=PROMO_TEASER_VIDEO and
// kind=VIDEO. The MinIO key follows the same `documents/raw/<userId>/...`
// convention as other promo assets so the existing document library / signed
// URL endpoints work unchanged.
//
// Why async (queue) and not sync:
//   - Render is FFmpeg-bound (~5–8 sec wall-time on dev hardware)
//   - Mirrors how reels work today (reel-render-worker.ts)
//   - Keeps the HTTP request snappy + lets the client poll Document.s3Key
//
// Why silent (no audio bed):
//   - Confirmed scope: silent MP4 keeps licensing concerns + TTS infra out
//   - Faculty can dub later in any tool
//
// Why @resvg/resvg-js for rasterization:
//   - Pure WASM/Rust, ~2 MB, no native deps, works on Linux + Windows + macOS
//   - Crisp text rendering with proper Unicode (drawtext on Windows is brittle)
//   - Reuses the existing renderSvg() palette from promo-service.ts so the
//     teaser visually matches the SVG flyer / banner / IG card

import { db } from '@/lib/db';
import {
  Role,
  DocumentKind,
  DocumentRoute,
  DocumentStatus,
} from '@prisma/client';
import { getQueue, QUEUES } from '@/lib/queue';
import {
  buildCopy,
  PALETTE,
  escapeXml,
  type PromoCopy,
} from './promo-service';
import { gatherTeaserSources, type TeaserSources } from './teaser-sources';

export class TeaserVideoAccessError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID',
    message: string
  ) {
    super(message);
  }
}

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export const TEASER_DIMENSIONS = { w: 1080, h: 1920 } as const;
/** 5 sec per frame × 3 frames = 15 sec total. */
export const TEASER_FRAME_SECONDS = 5;
export const TEASER_FRAME_COUNT = 3;
export const TEASER_DURATION_SECONDS = TEASER_FRAME_SECONDS * TEASER_FRAME_COUNT;

export interface RequestTeaserInput {
  sessionId: string;
  actor: { userId: string; role: Role };
}

export interface RequestTeaserResult {
  documentId: string;
  jobId: string;
  s3Key: string;
}

/**
 * Create a placeholder Document row + enqueue a render job. Returns the
 * documentId so the client can poll Document.s3Key (becomes non-null when
 * the worker finishes uploading the MP4).
 */
export async function requestTeaserVideo(
  input: RequestTeaserInput
): Promise<RequestTeaserResult> {
  if (!FACULTY_LIKE.includes(input.actor.role)) {
    throw new TeaserVideoAccessError(
      'FORBIDDEN',
      'Only faculty / PD / admin can generate promo teaser videos'
    );
  }

  const session = await db.teachingSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, title: true, scheduledStart: true, hostId: true },
  });
  if (!session) {
    throw new TeaserVideoAccessError('NOT_FOUND', 'Session not found');
  }
  // Faculty can only generate teasers for sessions they host. PD/Admin can
  // do it for anyone.
  if (
    input.actor.role === Role.FACULTY &&
    session.hostId !== input.actor.userId
  ) {
    throw new TeaserVideoAccessError(
      'FORBIDDEN',
      'Only the session host can generate a teaser video for this session'
    );
  }

  // Pre-allocate the future MinIO key so the Document row carries it from the
  // start; the worker uploads to this exact key. We use a placeholder s3Key
  // value and flip it to the real key on success — clients polling Document
  // wait for `s3Key` AND for `metadata.teaserStatus === 'READY'` which only
  // the worker sets on completion.
  const ts = Date.now();
  const s3Key = `documents/raw/${input.actor.userId}/promo-teaser-${input.sessionId}-${ts}.mp4`;

  const doc = await db.document.create({
    data: {
      uploadedById: input.actor.userId,
      title: `${session.title} — teaser video`,
      description: `Auto-generated 15-sec teaser video for session "${session.title}".`,
      kind: DocumentKind.VIDEO,
      route: DocumentRoute.PROMO_TEASER_VIDEO,
      s3Key,
      sizeBytes: BigInt(0), // updated by worker on upload
      mimeType: 'video/mp4',
      status: DocumentStatus.PRIVATE_FACULTY,
      visibility: DocumentStatus.PRIVATE_FACULTY,
      sessionLinks: {
        create: {
          sessionId: input.sessionId,
          linkedById: input.actor.userId,
        },
      },
    },
    select: { id: true, s3Key: true },
  });

  const jobId = `promo-teaser-render-${doc.id}`;
  await getQueue(QUEUES.PROMO).add(
    'promo-teaser-render',
    { documentId: doc.id, sessionId: input.sessionId, actorUserId: input.actor.userId },
    { jobId }
  );

  return { documentId: doc.id, jobId, s3Key: doc.s3Key };
}

// ─── SVG card composition (used by the worker) ──────────────────────────────
//
// 3 frames: TITLE → HOOK → CTA. Background gradient + accent stripe match the
// existing promo SVG renderer so a teaser video sits visually next to a flyer.

interface FrameInput {
  title: string;
  subtitle: string;
  hook: string;
  hostName: string;
  whenLine: string;
}

function wrap(text: string, max: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

export function renderTitleFrameSvg(input: FrameInput): string {
  const { w, h } = TEASER_DIMENSIONS;
  const titleLines = wrap(input.title, 18, 4);
  const titleSize = 78;
  const padding = 100;
  let titleTspans = '';
  titleLines.forEach((line, i) => {
    const dy = i === 0 ? 0 : titleSize + 14;
    titleTspans += `<tspan x="${padding}" dy="${dy}">${escapeXml(line)}</tspan>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.bg}"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect x="${padding}" y="${padding}" width="160" height="8" fill="${PALETTE.accent}"/>
  <text x="${padding}" y="${padding + 70}" fill="${PALETTE.muted}" font-family="Inter, system-ui, sans-serif" font-size="34" font-weight="500" letter-spacing="4">VAIDIX · LVPEI</text>
  <text x="${padding}" y="${padding + 280}" fill="${PALETTE.text}" font-family="Inter, system-ui, sans-serif" font-size="${titleSize}" font-weight="700">${titleTspans}</text>
  <text x="${padding}" y="${h - 200}" fill="${PALETTE.muted}" font-family="Inter, system-ui, sans-serif" font-size="36">${escapeXml(input.subtitle)}</text>
</svg>`;
}

export function renderHookFrameSvg(input: FrameInput): string {
  const { w, h } = TEASER_DIMENSIONS;
  const hookLines = wrap(input.hook, 22, 5);
  const hookSize = 64;
  const padding = 100;
  let hookTspans = '';
  hookLines.forEach((line, i) => {
    const dy = i === 0 ? 0 : hookSize + 18;
    hookTspans += `<tspan x="${padding}" dy="${dy}">${escapeXml(line)}</tspan>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.bg}"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect x="${padding}" y="${padding + 90}" width="100" height="6" fill="${PALETTE.highlight}"/>
  <text x="${padding}" y="${padding + 60}" fill="${PALETTE.muted}" font-family="Inter, system-ui, sans-serif" font-size="34" font-weight="500" letter-spacing="4">WHY ATTEND</text>
  <text x="${padding}" y="${padding + 360}" fill="${PALETTE.highlight}" font-family="Inter, system-ui, sans-serif" font-size="${hookSize}" font-weight="600" font-style="italic">${hookTspans}</text>
</svg>`;
}

export function renderCtaFrameSvg(input: FrameInput): string {
  const { w, h } = TEASER_DIMENSIONS;
  const padding = 100;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.bg}"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect x="${padding}" y="${padding}" width="160" height="8" fill="${PALETTE.accent}"/>
  <text x="${padding}" y="${padding + 70}" fill="${PALETTE.muted}" font-family="Inter, system-ui, sans-serif" font-size="34" font-weight="500" letter-spacing="4">JOIN US</text>
  <text x="${padding}" y="${h / 2 - 80}" fill="${PALETTE.text}" font-family="Inter, system-ui, sans-serif" font-size="56" font-weight="700">${escapeXml(input.hostName)}</text>
  <text x="${padding}" y="${h / 2 - 10}" fill="${PALETTE.text}" font-family="Inter, system-ui, sans-serif" font-size="44" font-weight="500">${escapeXml(input.whenLine)}</text>
  <line x1="${padding}" y1="${h / 2 + 40}" x2="${padding + 220}" y2="${h / 2 + 40}" stroke="${PALETTE.accent}" stroke-width="4"/>
  <text x="${padding}" y="${h - 220}" fill="${PALETTE.accent}" font-family="Inter, system-ui, sans-serif" font-size="38" font-weight="600">vaidix.lvpei.org</text>
</svg>`;
}

/** Worker-callable: build the full 3-frame copy block for a session.
 *  Enriches the AI prompt with objectives, study material, top pre-questions,
 *  and tags — see teaser-sources.ts for what's gathered. The same digest is
 *  exposed at GET /api/promo/teaser-video/sources so curators can preview the
 *  inputs before render. */
export async function buildTeaserCopy(sessionId: string): Promise<{
  copy: PromoCopy;
  sessionTitle: string;
  scheduledStart: Date;
  sources: TeaserSources;
}> {
  const sources = await gatherTeaserSources(sessionId);
  if (!sources) {
    throw new TeaserVideoAccessError('NOT_FOUND', 'Session not found');
  }
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
  return {
    copy,
    sessionTitle: sources.title,
    scheduledStart: sources.scheduledStart,
    sources,
  };
}
