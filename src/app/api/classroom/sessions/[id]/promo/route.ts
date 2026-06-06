// ════════════════════════════════════════════════════════════════════════════
// Promo assets — Invitations & Teasers step (real wiring)
// ════════════════════════════════════════════════════════════════════════════
// GET    → current promo state: the saved select/approve/sent flags from
//          TeachingSession.metadata.promoAssets PLUS the real generated assets
//          (PROMO_ASSET Documents linked to this session, with short-lived
//          presigned SVG URLs so the client renders the actual artwork).
// POST   → generate / regenerate. Delegates to the REAL generatePromoAssets
//          service (SVG templates + Gemini-or-heuristic copy → MinIO + Document
//          rows). If object storage / the AI backend is unreachable (this is a
//          network-blocked env), returns 503 so the client degrades to an
//          honest "AI generator offline" state instead of faking artwork.
// PATCH  → persist select/approve/sent flags to metadata.promoAssets. Used by
//          the per-asset toggles and the "send / finish" action.
//
// Auth: requireAuth + host-or-FACULTY_LIKE gate (mirrors the page). Mutations
// require CSRF. No Prisma migration — state rides in the JSON metadata column.

import { z } from 'zod';
import { Prisma, Role, DocumentRoute } from '@prisma/client';
import { db } from '@/lib/db';
import { presignDownload } from '@/lib/storage';
import {
  handleUnexpected,
  jsonError,
  jsonOk,
  parseBody,
  requireAuth,
  requireCsrf,
} from '@/server/services/api-helpers';
import {
  generatePromoAssets,
  PromoAccessError,
  type PromoTemplate,
} from '@/server/services/promo/promo-service';
import {
  requestTeaserVideo,
  TeaserVideoAccessError,
} from '@/server/services/promo/teaser-video-service';
import { materializeSessionAudience } from '@/server/services/session-service';
import { listSessionLearners } from '@/server/services/sessions/visibility';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const TEMPLATES = ['flyer', 'whatsapp_banner', 'instagram_card'] as const;
const templateEnum = z.enum(TEMPLATES);

// Promo VIDEO formats. Both the demo "teaser" and "reel" map to the single
// PROMO_TEASER_VIDEO pipeline (a 1080×1920 vertical MP4); they share one render
// path and surface as the same Document kind. We keep both ids so the client's
// picker can offer them distinctly while reusing one Document per session.
const VIDEO_FORMATS = ['teaser', 'reel'] as const;
type VideoFormat = (typeof VIDEO_FORMATS)[number];
const videoFormatEnum = z.enum(VIDEO_FORMATS);

// Status of the async teaser render, derived from the Document the worker
// updates (it has no dedicated status column for this — see promo-teaser-worker):
//   sizeBytes > 0                          → READY (MP4 uploaded)
//   rejectionReason starts with "[teaser]" → FAILED
//   otherwise (freshly enqueued)           → RENDERING
type TeaserStatus = 'RENDERING' | 'READY' | 'FAILED';

// Shape persisted under metadata.promoAssets — no schema migration needed.
interface PromoMeta {
  selected: PromoTemplate[];
  approved: PromoTemplate[];
  sent: boolean;
  updatedAt: string;
}

function readPromoMeta(metadata: Prisma.JsonValue | null): PromoMeta {
  const empty: PromoMeta = { selected: [], approved: [], sent: false, updatedAt: '' };
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return empty;
  const raw = (metadata as Record<string, unknown>).promoAssets;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const r = raw as Record<string, unknown>;
  const asTemplates = (v: unknown): PromoTemplate[] =>
    Array.isArray(v)
      ? (v.filter((x): x is PromoTemplate => (TEMPLATES as readonly string[]).includes(x as string)))
      : [];
  return {
    selected: asTemplates(r.selected),
    approved: asTemplates(r.approved),
    sent: r.sent === true,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  };
}

function templateOfTitle(title: string): PromoTemplate | null {
  const lower = title.toLowerCase();
  if (lower.includes('flyer')) return 'flyer';
  if (lower.includes('whatsapp')) return 'whatsapp_banner';
  if (lower.includes('instagram')) return 'instagram_card';
  return null;
}

/** Returns null when the actor may not touch this session's promo. */
async function gateSession(actor: { userId: string; role: Role }, sessionId: string) {
  const session = await db.teachingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true, hostId: true, proposedBy: true, metadata: true },
  });
  if (!session) return { ok: false as const, code: 'NOT_FOUND' as const };
  const isHost = session.hostId === actor.userId || session.proposedBy === actor.userId;
  if (!isHost && !FACULTY_LIKE.includes(actor.role)) {
    return { ok: false as const, code: 'FORBIDDEN' as const };
  }
  return { ok: true as const, session };
}

/** Real generated assets for this session: most-recent SVG per template with a
 *  short-lived presigned URL the browser can render. */
async function loadAssets(sessionId: string) {
  const docs = await db.document.findMany({
    where: {
      route: DocumentRoute.PROMO_ASSET,
      deletedAt: null,
      sessionLinks: { some: { sessionId } },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, s3Key: true, createdAt: true },
  });
  const latest = new Map<PromoTemplate, (typeof docs)[number]>();
  for (const d of docs) {
    const t = templateOfTitle(d.title);
    if (t && !latest.has(t)) latest.set(t, d);
  }
  const assets: Array<{
    template: PromoTemplate;
    documentId: string;
    title: string;
    svgUrl: string;
    createdAt: string;
  }> = [];
  for (const template of TEMPLATES) {
    const d = latest.get(template);
    if (!d) continue;
    // Presigned via the public S3 client so the browser can fetch the SVG.
    const svgUrl = await presignDownload(d.s3Key, 60 * 30);
    assets.push({
      template,
      documentId: d.id,
      title: d.title,
      svgUrl,
      createdAt: d.createdAt.toISOString(),
    });
  }
  return assets;
}

export interface TeaserVideoAsset {
  format: VideoFormat;
  documentId: string;
  title: string;
  status: TeaserStatus;
  /** Presigned MP4 URL — only set once status === 'READY'. */
  videoUrl: string | null;
  failureReason: string | null;
  createdAt: string;
}

/** Most-recent PROMO_TEASER_VIDEO Document for this session, with its derived
 *  render status. Returns null when no teaser has ever been requested. The
 *  single Document backs both video formats (teaser + reel) in the picker. */
async function loadTeaserVideo(sessionId: string): Promise<TeaserVideoAsset | null> {
  const doc = await db.document.findFirst({
    where: {
      route: DocumentRoute.PROMO_TEASER_VIDEO,
      deletedAt: null,
      sessionLinks: { some: { sessionId } },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, s3Key: true, sizeBytes: true, rejectionReason: true, createdAt: true },
  });
  if (!doc) return null;

  const failed = (doc.rejectionReason ?? '').startsWith('[teaser]');
  const ready = doc.sizeBytes > BigInt(0);
  const status: TeaserStatus = failed ? 'FAILED' : ready ? 'READY' : 'RENDERING';

  let videoUrl: string | null = null;
  if (status === 'READY') {
    // Presigned so the browser can stream/download the rendered MP4 directly.
    videoUrl = await presignDownload(doc.s3Key, 60 * 30);
  }

  return {
    format: 'teaser',
    documentId: doc.id,
    title: doc.title,
    status,
    videoUrl,
    failureReason: failed ? (doc.rejectionReason ?? '').replace(/^\[teaser\]\s*/, '') : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

// ── GET ─────────────────────────────────────────────────────────────────────
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const gate = await gateSession({ userId: auth.user.id, role: auth.user.role }, id);
  if (!gate.ok) {
    return jsonError(gate.code, gate.code === 'NOT_FOUND' ? 'Session not found' : 'Forbidden', gate.code === 'NOT_FOUND' ? 404 : 403);
  }

  try {
    const meta = readPromoMeta(gate.session.metadata);
    // Real expected-audience size so the UI can show "will go to N learners"
    // instead of a hardcoded figure. Same roster the dashboard/readiness panel
    // read, so the promo count and the dashboard never disagree.
    const audienceCount = (await listSessionLearners(id)).length;
    const assets = await loadAssets(id);
    // The teaser Document is loaded separately (its READY presign can fail
    // independently of the image presigns) so an offline storage backend for
    // the MP4 doesn't blank the image assets, and vice-versa.
    let teaserVideo: TeaserVideoAsset | null = null;
    try {
      teaserVideo = await loadTeaserVideo(id);
    } catch (err) {
      // Document row exists but presigning the MP4 failed (storage offline):
      // surface it as RENDERING rather than dropping it entirely.
      if (!isStorageUnreachable(err)) throw err;
    }
    return jsonOk({ meta, assets, teaserVideo, audienceCount });
  } catch (err) {
    // Storage unreachable (network-blocked env) → still return the saved meta so
    // the UI can render its select/approve state; assets degrade to empty. The
    // audience size is independent of object storage, so still surface it.
    if (isStorageUnreachable(err)) {
      let audienceCount = 0;
      try {
        audienceCount = (await listSessionLearners(id)).length;
      } catch {
        // Roster query failed too — fall back to 0; UI shows the zero-audience guard.
      }
      return jsonOk({ meta: readPromoMeta(gate.session.metadata), assets: [], teaserVideo: null, storageOffline: true, audienceCount });
    }
    return handleUnexpected(err);
  }
}

// ── POST (generate / regenerate) ─────────────────────────────────────────────
// Two shapes share this endpoint:
//   { templates?: [...] } → render IMAGE promos via generatePromoAssets (sync)
//   { video: 'teaser' | 'reel' } → enqueue the async PROMO_TEASER_VIDEO render
//     via requestTeaserVideo; the client then polls GET for the Document status.
const postSchema = z.object({
  // Omit ⇒ generate the full default set (all three templates).
  templates: z.array(templateEnum).min(1).optional(),
  video: videoFormatEnum.optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const { id } = await ctx.params;

  const gate = await gateSession({ userId: auth.user.id, role: auth.user.role }, id);
  if (!gate.ok) {
    return jsonError(gate.code, gate.code === 'NOT_FOUND' ? 'Session not found' : 'Forbidden', gate.code === 'NOT_FOUND' ? 404 : 403);
  }

  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  // ── VIDEO path: enqueue the async teaser render (teaser + reel share it) ────
  if (body.data.video) {
    try {
      const result = await requestTeaserVideo({
        sessionId: id,
        actor: { userId: auth.user.id, role: auth.user.role },
      });
      // Freshly enqueued → always RENDERING. The client polls GET for READY.
      const teaserVideo: TeaserVideoAsset = {
        format: body.data.video,
        documentId: result.documentId,
        title: '',
        status: 'RENDERING',
        videoUrl: null,
        failureReason: null,
        createdAt: new Date().toISOString(),
      };
      return jsonOk({ teaserVideo }, { status: 202 });
    } catch (err) {
      if (err instanceof TeaserVideoAccessError) {
        // INVALID / NOT_FOUND / FORBIDDEN map to the same status codes the image
        // path uses for PromoAccessError, keeping the client's handling uniform.
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
        return jsonError(err.code, err.message, status);
      }
      // The render queue (Redis/BullMQ) or AI backend is unreachable in this
      // env → honest offline state, never a fabricated video.
      if (isGeneratorOffline(err)) {
        return jsonError(
          'GENERATOR_OFFLINE',
          'The promo video generator (render queue / AI) is unreachable right now. Try again once it is online.',
          503,
        );
      }
      return handleUnexpected(err);
    }
  }

  // ── IMAGE path: synchronous SVG template generation ─────────────────────────
  try {
    await generatePromoAssets({
      sessionId: id,
      templates: body.data.templates ?? [...TEMPLATES],
      actor: { userId: auth.user.id, role: auth.user.role },
    });
    const assets = await loadAssets(id);
    return jsonOk({ assets }, { status: 201 });
  } catch (err) {
    if (err instanceof PromoAccessError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
      return jsonError(err.code, err.message, status);
    }
    // The AI / object-storage backend is unreachable in this environment. Tell
    // the client honestly so it can show "AI generator offline" — never fabricate
    // a finished asset.
    if (isStorageUnreachable(err)) {
      return jsonError(
        'GENERATOR_OFFLINE',
        'The promo generator backend (AI / object storage) is unreachable right now. Try again once it is online.',
        503,
      );
    }
    return handleUnexpected(err);
  }
}

// ── PATCH (persist select / approve / sent) ──────────────────────────────────
const patchSchema = z.object({
  selected: z.array(templateEnum).optional(),
  approved: z.array(templateEnum).optional(),
  sent: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const csrf = await requireCsrf(req);
  if (!csrf.ok) return csrf.response;
  const { id } = await ctx.params;

  const gate = await gateSession({ userId: auth.user.id, role: auth.user.role }, id);
  if (!gate.ok) {
    return jsonError(gate.code, gate.code === 'NOT_FOUND' ? 'Session not found' : 'Forbidden', gate.code === 'NOT_FOUND' ? 404 : 403);
  }

  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const prev = readPromoMeta(gate.session.metadata);
  const dedupe = (v: PromoTemplate[]) => [...new Set(v)];
  const next: PromoMeta = {
    selected: body.data.selected ? dedupe(body.data.selected) : prev.selected,
    approved: body.data.approved ? dedupe(body.data.approved) : prev.approved,
    sent: body.data.sent ?? prev.sent,
    updatedAt: new Date().toISOString(),
  };

  // ── "Send to learners" — the actual delivery side-effect ────────────────────
  // Clicking Send is what turns the promo's configured audience into real
  // SessionInvite rows. Until this existed, Send only flipped the `sent` flag in
  // metadata, so no invites were created and the learners dashboard stayed empty
  // even though the host believed the flyer had gone out. We materialise BEFORE
  // persisting `sent` so we never report "sent" on a send that actually failed.
  // Only fires on the false→true transition so repeat PATCHes (toggling
  // approvals after sending) don't re-run the roster write — and even if one did,
  // materialiseSessionAudience is idempotent (skipDuplicates).
  const justSent = body.data.sent === true && !prev.sent;
  let invited: number | undefined;
  let audienceCount: number | undefined;
  if (justSent) {
    try {
      const res = await materializeSessionAudience(id, auth.user.id, auth.user.role);
      invited = res.invited;
      audienceCount = res.audienceSize;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'NOT_AUTHORIZED') return jsonError('FORBIDDEN', 'Not allowed to send this promo', 403);
      if (msg === 'SESSION_NOT_FOUND') return jsonError('NOT_FOUND', 'Session not found', 404);
      return handleUnexpected(err);
    }
  }

  // Merge into the existing metadata object so we don't clobber sibling keys
  // (prereqItems, etc.) written by other steps.
  const baseMeta =
    gate.session.metadata && typeof gate.session.metadata === 'object' && !Array.isArray(gate.session.metadata)
      ? (gate.session.metadata as Record<string, unknown>)
      : {};

  await db.teachingSession.update({
    where: { id },
    data: { metadata: { ...baseMeta, promoAssets: next } as unknown as Prisma.InputJsonValue },
  });

  return jsonOk({ meta: next, ...(justSent ? { invited, audienceCount } : {}) });
}

// ── helpers ──────────────────────────────────────────────────────────────────
/** Best-effort detection of "object storage / network unreachable" so we can
 *  surface a 503 instead of a generic 500. Covers AWS SDK connection errors and
 *  the usual Node socket error codes seen when MinIO/S3 is offline. */
function isStorageUnreachable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; message?: string; $metadata?: unknown };
  const name = e.name ?? '';
  const code = e.code ?? '';
  const msg = e.message ?? '';
  const NET = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH/;
  if (NET.test(code) || NET.test(msg)) return true;
  if (/TimeoutError|NetworkingError|UnknownEndpoint/.test(name)) return true;
  // Generic SDK fetch failure ("fetch failed") when the endpoint is down.
  if (/fetch failed|Failed to fetch/i.test(msg)) return true;
  return false;
}

/** Broader offline check for the VIDEO path: the teaser render is enqueued onto
 *  the BullMQ/Redis-backed PROMO queue and copy comes from the AI backend, so on
 *  top of storage we also treat queue-connection and Gemini-unavailable errors
 *  as "generator offline" (503) instead of a 500. */
function isGeneratorOffline(err: unknown): boolean {
  if (isStorageUnreachable(err)) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  const name = e.name ?? '';
  const msg = e.message ?? '';
  // BullMQ / ioredis connection failures + the AI router's typed unavailable.
  if (/GeminiUnavailableError/.test(name)) return true;
  if (/Redis|ioredis|maxRetriesPerRequest|Connection is closed|ECONNREFUSED/i.test(msg)) return true;
  return false;
}
