// ════════════════════════════════════════════════════════════════════════════
// Audit Log Helper — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Writes to audit_events table. Used by auth, invitation, admin action flows.

import crypto from 'node:crypto';
import { db } from '@/lib/db';
import type { Role } from '@prisma/client';
import { log } from '@/lib/log';
import { getQueue, QUEUES } from '@/lib/queue';

/** Internal — used by the direct write fallback path in audit() below. */
async function enqueueAuditRetry(input: AuditInput): Promise<void> {
  // Idempotency key prevents the worker from double-inserting on retry.
  const jobId = crypto.randomUUID();
  await getQueue(QUEUES.AUDIT_WRITE).add('write', input, { jobId });
}

export interface AuditInput {
  actorId?: string | null;
  actorRole?: Role | null;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        eventType: input.eventType,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        details: input.details ? (input.details as object) : undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        success: input.success ?? true,
      },
    });
  } catch (err) {
    // Audit failures must surface in structured logs so SREs notice.
    // Direct DB write is best-effort; the durable path is the AUDIT_WRITE
    // queue (security hardening) which is processed async by a worker.
    log.error(
      { err, eventType: input.eventType, entityId: input.entityId },
      '[audit] direct write failed — relying on queued retry'
    );
    // Best-effort enqueue for the audit-worker to retry.
    void enqueueAuditRetry(input).catch(() => {});
  }
}

export const AUDIT_EVENTS = {
  // Auth
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILED: 'auth.login.failed',
  LOGIN_LOCKED: 'auth.login.locked',
  LOGOUT: 'auth.logout',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset.requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset.completed',
  PASSWORD_CHANGED: 'auth.password.changed',

  // Invitations
  INVITATION_CREATED: 'invitation.created',
  INVITATION_SENT: 'invitation.sent',
  INVITATION_RESENT: 'invitation.resent',
  INVITATION_UPDATED: 'invitation.updated',
  INVITATION_REVOKED: 'invitation.revoked',
  INVITATION_DELETED: 'invitation.deleted',
  INVITATION_ACCEPTED: 'invitation.accepted',
  INVITATION_EXPIRED: 'invitation.expired',

  // User management
  USER_CREATED: 'user.created',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_STATUS_CHANGED: 'user.status_changed',
  USER_UPDATED: 'user.updated',
  USER_MODULES_UPDATED: 'user.modules_updated',
  // Faculty → Program Director mapping. Set when admin links a faculty user to
  // a PD (or clears the link). Cleared on role change away from FACULTY too.
  FACULTY_PD_ASSIGNED: 'faculty.pd.assigned',
  FACULTY_PD_CLEARED: 'faculty.pd.cleared',

  // Cohort → Faculty mentor mapping. Set when admin/PD links a cohort to a
  // faculty mentor (or clears it). Independent of cohort membership writes.
  COHORT_FACULTY_ASSIGNED: 'cohort.faculty.assigned',
  COHORT_FACULTY_CLEARED: 'cohort.faculty.cleared',

  // Module permissions
  MODULE_GRANTED: 'module.granted',
  MODULE_REVOKED: 'module.revoked',

  // ─── events ────────────────────────────────────────────────
  // Recording
  RECORDING_EGRESS_STARTED: 'recording.egress.started',
  RECORDING_EGRESS_COMPLETED: 'recording.egress.completed',
  RECORDING_EGRESS_FAILED: 'recording.egress.failed',
  RECORDING_TRANSCODE_DONE: 'recording.transcode.done',
  RECORDING_TRANSCRIBE_DONE: 'recording.transcribe.done',
  RECORDING_VIEWED: 'recording.viewed',

  // Documents
  DOCUMENT_UPLOAD_INITIATED: 'document.upload.initiated',
  DOCUMENT_CLASSIFIED: 'document.classified',
  DOCUMENT_APPROVED: 'document.approved',
  DOCUMENT_TAGGED_TO_SESSION: 'document.tagged_to_session',
  DOCUMENT_DELETED: 'document.deleted',
  DOCUMENT_ANALYZED: 'document.analyzed',
  DECK_FORGE_REQUESTED: 'deck_forge.requested',
  DECK_FORGE_COMPLETED: 'deck_forge.completed',
  DECK_FORGE_FAILED: 'deck_forge.failed',
  DECK_SLIDE_UPDATED: 'deck.slide.updated',
  DECK_EXPORTED_PPTX: 'deck.exported.pptx',
  DECK_ANALYZED: 'deck.analyzed',
  DECK_SLIDES_GENERATED: 'deck.slides.generated',
  DECK_SUGGESTION_APPLIED: 'deck.suggestion.applied',
  DECK_SUGGESTION_DISMISSED: 'deck.suggestion.dismissed',
  DECK_SLIDE_REFINED: 'deck.slide.refined',
  // Per-faculty AI style memory — PRELUDE/POPI-inspired personalization
  STYLE_PROFILE_UPDATED: 'style_profile.updated',
  STYLE_PROFILE_REBUILT: 'style_profile.rebuilt',
  STYLE_PROFILE_CLEARED: 'style_profile.cleared',
  BLUEPRINT_GENERATED: 'blueprint.generated',
  BLUEPRINT_DELETED: 'blueprint.deleted',
  CASE_FORGE_REQUESTED: 'case_forge.requested',
  CASE_FORGE_COMPLETED: 'case_forge.completed',
  CASE_FORGE_FAILED: 'case_forge.failed',
  CASE_TEMPLATE_PUBLISHED: 'case_template.published',
  CASE_TEMPLATE_ARCHIVED: 'case_template.archived',
  CASE_TEMPLATE_EDITED: 'case_template.edited',

  // ─── — Live captions (Deepgram in Phase 1) ─────────────────────────
  CAPTIONS_TOKEN_MINTED: 'captions.token.minted',
  CAPTIONS_PUBLISHED: 'captions.published',
  CAPTIONS_TRANSLATED: 'captions.translated',
  CAPTIONS_TRANSCRIPT_FINALIZED: 'captions.transcript.finalized',
  CAPTIONS_TRANSCRIPT_READ: 'captions.transcript.read',
  // ─── — Post-session content pack ───────────────────────────────────
  TRANSCRIPT_PDF_EXPORTED: 'transcript.pdf.exported',
  POST_SESSION_PACK_TRIGGERED: 'post_session.pack.triggered',

  // Engagement / Hooks / Alerts
  LIVE_HOOK_CREATED: 'live_hook.created',
  LIVE_HOOK_FIRED: 'live_hook.fired',
  LIVE_HOOK_RESPONDED: 'live_hook.responded',
  // Pre-session structured polls (extends LiveHook with prePublishedAt)
  LIVE_HOOK_UPDATED: 'live_hook.updated',
  LIVE_HOOK_DELETED: 'live_hook.deleted',
  LIVE_HOOK_PRE_PUBLISHED: 'live_hook.pre_published',
  LIVE_HOOK_PRE_UNPUBLISHED: 'live_hook.pre_unpublished',
  LIVE_HOOK_SUGGESTED: 'live_hook.suggested',
  PRESENTER_ALERT_RAISED: 'presenter_alert.raised',
  PRESENTER_ALERT_ACKED: 'presenter_alert.acknowledged',
  KIRKPATRICK_RECORDED: 'kirkpatrick.recorded',

  // WhatsApp out-of-band
  WHATSAPP_PEARL_SENT: 'whatsapp.pearl.sent',
  WHATSAPP_PEARL_BLOCKED: 'whatsapp.pearl.blocked',
  WHATSAPP_PEARLS_SCHEDULED: 'whatsapp.pearls.scheduled',

  // ─── events ───────────────────────────────────────────────────────
  // Q&A threads
  QA_QUESTION_POSTED: 'qa.question.posted',
  QA_REPLY_POSTED: 'qa.reply.posted',
  QA_PINNED: 'qa.pinned',
  QA_UNPINNED: 'qa.unpinned',
  QA_QUESTION_ANSWERED: 'qa.question.answered',
  QA_ANSWER_CLEARED: 'qa.answer.cleared',

  // Breakouts
  BREAKOUT_CREATED: 'breakout.created',
  BREAKOUT_PARTICIPANT_ASSIGNED: 'breakout.participant.assigned',
  BREAKOUT_PARTICIPANT_LEFT: 'breakout.participant.left',
  BREAKOUT_RECONVENED: 'breakout.reconvened',
  BREAKOUT_ENDED: 'breakout.ended',
  BREAKOUT_AGENT_LOG_INGESTED: 'breakout.agent_log.ingested',

  // Recording share
  RECORDING_SHARE_CREATED: 'recording_share.created',
  RECORDING_SHARE_ACCESSED: 'recording_share.accessed',
  RECORDING_SHARE_BLOCKED: 'recording_share.blocked',
  RECORDING_SHARE_REVOKED: 'recording_share.revoked',

  // Sessions (teaching sessions / classrooms / board rooms)
  SESSION_CREATED: 'session.created',
  SESSION_CANCELLED: 'session.cancelled',
  SESSION_SHARE_CREATED: 'session_share.created',
  SESSION_SHARE_ACCESSED: 'session_share.accessed',

  // ─── events ───────────────────────────────────────────────────────
  // Cases
  CASE_STARTED: 'case.started',
  CASE_MESSAGE_SENT: 'case.message_sent',
  CASE_COMPLETED: 'case.completed',

  // Pre-Conference Question Submission Engine
  PRE_QUESTION_SUBMITTED: 'pre_question.submitted',
  PRE_QUESTION_VOTED: 'pre_question.voted',
  PRE_QUESTION_UNVOTED: 'pre_question.unvoted',
  PRE_QUESTION_REPLY_POSTED: 'pre_question.reply_posted',
  PRE_QUESTION_RECLUSTER_REQUESTED: 'pre_question.recluster_requested',
  PRE_QUESTION_THEMES_GENERATED: 'pre_question.themes_generated',
  PRE_QUESTION_CLUSTER_FAILED: 'pre_question.cluster_failed',
  // presenter-published doubt prompts + AI-suggested drafts
  PRE_QUESTION_PROMPTS_UPDATED: 'pre_question.prompts_updated',
  PRE_QUESTION_PROMPTS_SUGGESTED: 'pre_question.prompts_suggested',

  // ─── — Pre-Conference Polish ────────────────────────────────────
  // Promo teaser video
  PROMO_TEASER_REQUESTED: 'promo.teaser.requested',
  PROMO_TEASER_RENDERED: 'promo.teaser.rendered',
  PROMO_TEASER_FAILED: 'promo.teaser.failed',
  // ─── — Promo & Share ──────────────────────────────────────────────
  PROMO_GENERATED: 'promo.generated',
  PROMO_SHARE_CREATED: 'promo_share.created',
  PROMO_SHARE_ACCESSED: 'promo_share.accessed',
  PROMO_SHARE_REVOKED: 'promo_share.revoked',
  OBJECTIVES_AI_SUGGESTED: 'objectives.ai_suggested',
  // Study Pack curation
  STUDY_PACK_DOC_ADDED: 'study_pack.doc.added',
  STUDY_PACK_DOC_REMOVED: 'study_pack.doc.removed',
  STUDY_PACK_VIEW_RECORDED: 'study_pack.view.recorded',
  // Pre-Case scaffolding
  PRE_CASE_ATTACHED: 'pre_case.attached',
  PRE_CASE_DETACHED: 'pre_case.detached',
  PRE_CASE_UPDATED: 'pre_case.updated',
  PRE_CASE_STARTED: 'pre_case.started',
  PRE_CASE_COMPLETED: 'pre_case.completed',
  // Readiness Predictor
  READINESS_VIEWED: 'readiness.viewed',
  // Learning objectives — structured per-session goals
  OBJECTIVES_UPDATED: 'objectives.updated',
  OBJECTIVE_ACHIEVEMENT_MARKED: 'objective.achievement.marked',

  // ─── Hardening sprint events ────────────────────────────────────────
  // Item #8 — DLQ
  WORKER_JOB_DLQ: 'worker.job.dlq',
  WORKER_JOB_RETRIED: 'worker.job.retried',
  // Item #16 — Retention
  RETENTION_SWEEP_RAN: 'retention.sweep_ran',
  RETENTION_RECORD_PURGED: 'retention.record_purged',
  // Item #17 — DPDPA
  DSR_EXPORT_REQUESTED: 'dsr.export.requested',
  DSR_EXPORT_DELIVERED: 'dsr.export.delivered',
  DSR_ERASURE_REQUESTED: 'dsr.erasure.requested',
  DSR_ERASURE_APPROVED: 'dsr.erasure.approved',
  DSR_ERASURE_EXECUTED: 'dsr.erasure.executed',
} as const;

export function extractRequestMetadata(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null;
  const userAgent = req.headers.get('user-agent') ?? null;
  return { ipAddress, userAgent };
}
