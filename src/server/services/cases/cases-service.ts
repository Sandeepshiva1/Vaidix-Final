// ════════════════════════════════════════════════════════════════════════════
// Cases Service — W6 Phase 2
// ════════════════════════════════════════════════════════════════════════════
// DB-backed replacement for the W6 mock-data flow:
//   - List CaseTemplate (the library) with the same filters the old mock UI had
//   - Start a case → creates a Case (resident attempt) + Conversation +
//     opening patient Message from the template
//   - Send message → persists the resident's message and produces the next
//     AI/patient message via mentor-response.ts (Gemini in Phase A; falls back
//     to a stage-aware default when Gemini is unavailable)
//   - List past conversations on a template (for "Review Previous Attempt")
//
// Stage progression: stage advances on every resident message until COMPLETED.
// W13 will swap the deterministic stage walker for a model-graded transition
// (verdict='advance' from /api/grade-style scoring).

import { db } from '@/lib/db';
import {
  CaseDifficulty,
  CaseStage,
  CaseStatus,
  ConversationStatus,
  Role,
  type Prisma,
} from '@prisma/client';
import {
  generateMentorResponse,
  type ConversationMessage,
} from './mentor-response';

export class CasesError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID' | 'FORBIDDEN' | 'CONVERSATION_CLOSED',
    message: string
  ) {
    super(message);
  }
}

export interface CasesActor {
  userId: string;
  role: Role;
}

// ─── Library listing ─────────────────────────────────────────────────────────
export interface CaseTemplateView {
  id: string;
  legacyId: string | null;
  title: string;
  condition: string;
  specialty: string;
  topicSlug: string | null;
  bloomsLevel: number;
  difficulty: CaseDifficulty;
  estimatedMinutes: number;
  description: string;
  patientName: string;
  patientAgeYears: number;
  patientSex: string;
  oslerianPrinciples: string[];
  tags: string[];
  imageCount: number;
  isEmergency: boolean;
  /** Number of completed Case rows pointing at this template (denormalized at read). */
  completions: number;
}

export interface ListTemplatesOptions {
  /** W6.11: required — case bank is per-program. */
  programId: string;
  search?: string;
  difficulty?: CaseDifficulty;
  bloomsLevel?: number;
  specialty?: string;
  topicSlug?: string;
}

export async function listCaseTemplates(opts: ListTemplatesOptions): Promise<CaseTemplateView[]> {
  // Resident-facing list only sees PUBLISHED templates. DRAFT (in-progress
  // forges) and ARCHIVED (faculty-removed) are hidden — those surface in
  // /teacher/cases for the case owner only.
  const where: Prisma.CaseTemplateWhereInput = {
    programId: opts.programId,
    status: 'PUBLISHED',
  };
  if (opts.difficulty) where.difficulty = opts.difficulty;
  if (typeof opts.bloomsLevel === 'number') where.bloomsLevel = opts.bloomsLevel;
  if (opts.specialty) where.specialty = opts.specialty;
  if (opts.topicSlug) where.topic = { slug: opts.topicSlug };
  if (opts.search) {
    const q = opts.search;
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { condition: { contains: q, mode: 'insensitive' } },
      { patientName: { contains: q, mode: 'insensitive' } },
    ];
  }
  const rows = await db.caseTemplate.findMany({
    where,
    orderBy: [{ bloomsLevel: 'asc' }, { title: 'asc' }],
    include: {
      topic: { select: { slug: true } },
      _count: { select: { cases: { where: { status: CaseStatus.COMPLETED } } } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    legacyId: t.legacyId,
    title: t.title,
    condition: t.condition,
    specialty: t.specialty,
    topicSlug: t.topic?.slug ?? null,
    bloomsLevel: t.bloomsLevel,
    difficulty: t.difficulty,
    estimatedMinutes: t.estimatedMinutes,
    description: t.description,
    patientName: t.patientName,
    patientAgeYears: t.patientAgeYears,
    patientSex: t.patientSex,
    oslerianPrinciples: t.oslerianPrinciples,
    tags: t.tags,
    imageCount: t.imageCount,
    isEmergency: t.isEmergency,
    completions: t._count.cases,
  }));
}

export async function getCaseTemplate(idOrLegacyId: string, programId: string): Promise<CaseTemplateView> {
  // W6.11 — scope by program so an MS Ophth user can never read a Cornea
  // Fellowship template by guessing its id.
  const t = await db.caseTemplate.findFirst({
    where: {
      programId,
      status: 'PUBLISHED',
      OR: [{ id: idOrLegacyId }, { legacyId: idOrLegacyId }],
    },
    include: {
      topic: { select: { slug: true } },
      _count: { select: { cases: { where: { status: CaseStatus.COMPLETED } } } },
    },
  });
  if (!t) throw new CasesError('NOT_FOUND', 'Case template not found');
  return {
    id: t.id,
    legacyId: t.legacyId,
    title: t.title,
    condition: t.condition,
    specialty: t.specialty,
    topicSlug: t.topic?.slug ?? null,
    bloomsLevel: t.bloomsLevel,
    difficulty: t.difficulty,
    estimatedMinutes: t.estimatedMinutes,
    description: t.description,
    patientName: t.patientName,
    patientAgeYears: t.patientAgeYears,
    patientSex: t.patientSex,
    oslerianPrinciples: t.oslerianPrinciples,
    tags: t.tags,
    imageCount: t.imageCount,
    isEmergency: t.isEmergency,
    completions: t._count.cases,
  };
}

// ─── Conversation lifecycle ──────────────────────────────────────────────────
export interface ConversationView {
  id: string;
  caseId: string;
  templateId: string;
  status: ConversationStatus;
  stage: CaseStage;
  startedAt: string;
  updatedAt: string;
  messages: MessageView[];
}

export interface MessageView {
  id: string;
  senderRole: 'PATIENT' | 'AI' | 'RESIDENT' | 'FACULTY';
  content: string;
  createdAt: string;
  stage: CaseStage | null;
}

const STAGE_ORDER: CaseStage[] = [
  CaseStage.PATIENT_STORY,
  CaseStage.OBSERVATION,
  CaseStage.HYPOTHESIS,
  CaseStage.INVESTIGATION,
  CaseStage.REFLECTION,
  CaseStage.COMPLETED,
];

function nextStage(current: CaseStage): CaseStage {
  const i = STAGE_ORDER.indexOf(current);
  if (i < 0 || i >= STAGE_ORDER.length - 1) return CaseStage.COMPLETED;
  return STAGE_ORDER[i + 1];
}

export async function startCase(
  actor: CasesActor,
  templateIdOrLegacy: string,
  programId: string,
): Promise<{ caseId: string; conversationId: string }> {
  // W6.11 — case bank is per-program; never start a case from another tenant.
  const template = await db.caseTemplate.findFirst({
    where: {
      programId,
      OR: [{ id: templateIdOrLegacy }, { legacyId: templateIdOrLegacy }],
    },
    select: {
      id: true,
      title: true,
      patientName: true,
      patientAgeYears: true,
      patientSex: true,
      patientPresentingComplaint: true,
      condition: true,
      topicId: true,
    },
  });
  if (!template) throw new CasesError('NOT_FOUND', 'Case template not found');

  return await db.$transaction(async (tx) => {
    const c = await tx.case.create({
      data: {
        residentId: actor.userId,
        templateId: template.id,
        topicId: template.topicId,
        title: template.title,
        patientAgeYears: template.patientAgeYears,
        patientSex: template.patientSex,
        presentingComplaint: template.condition,
        currentStage: CaseStage.PATIENT_STORY,
        status: CaseStatus.ACTIVE,
      },
      select: { id: true },
    });
    const conv = await tx.conversation.create({
      data: {
        caseId: c.id,
        userId: actor.userId,
        stage: CaseStage.PATIENT_STORY,
        status: ConversationStatus.ACTIVE,
      },
      select: { id: true },
    });
    // Opening message from the patient — stored with senderRole='PATIENT'.
    await tx.message.create({
      data: {
        conversationId: conv.id,
        senderRole: 'PATIENT',
        content: template.patientPresentingComplaint,
        metadata: { stage: CaseStage.PATIENT_STORY, openingMessage: true },
      },
    });
    return { caseId: c.id, conversationId: conv.id };
  });
}

export async function listConversationsForTemplate(
  actor: CasesActor,
  templateIdOrLegacy: string
): Promise<Array<{ id: string; caseId: string; status: ConversationStatus; stage: CaseStage; startedAt: string; updatedAt: string }>> {
  const template = await db.caseTemplate.findFirst({
    where: { OR: [{ id: templateIdOrLegacy }, { legacyId: templateIdOrLegacy }] },
    select: { id: true },
  });
  if (!template) return [];
  const rows = await db.conversation.findMany({
    where: { userId: actor.userId, case: { templateId: template.id } },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      caseId: true,
      status: true,
      stage: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    caseId: r.caseId,
    status: r.status,
    stage: r.stage,
    startedAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getConversation(
  actor: CasesActor,
  conversationId: string
): Promise<ConversationView> {
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      case: { select: { templateId: true, residentId: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!conv) throw new CasesError('NOT_FOUND', 'Conversation not found');
  // Authorization: residents can only see their own conversations.
  // Faculty / PD / admin can see any (for review / scoring in W8).
  if (
    actor.role === Role.RESIDENT &&
    conv.case.residentId !== actor.userId
  ) {
    throw new CasesError('FORBIDDEN', 'Cannot view another resident\'s conversation');
  }
  return {
    id: conv.id,
    caseId: conv.caseId,
    templateId: conv.case.templateId ?? '',
    status: conv.status,
    stage: conv.stage,
    startedAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    messages: conv.messages.map((m) => ({
      id: m.id,
      senderRole: (m.senderRole as MessageView['senderRole']) ?? 'AI',
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      stage:
        m.metadata && typeof m.metadata === 'object' && !Array.isArray(m.metadata) && 'stage' in m.metadata
          ? (m.metadata as { stage?: CaseStage }).stage ?? null
          : null,
    })),
  };
}

export interface SendMessageResult {
  residentMessage: MessageView;
  mentorMessage: MessageView;
  newStage: CaseStage;
  conversationStatus: ConversationStatus;
}

export async function sendMessage(
  actor: CasesActor,
  conversationId: string,
  content: string
): Promise<SendMessageResult> {
  const text = content.trim();
  if (text.length < 1 || text.length > 4000) {
    throw new CasesError('INVALID', 'Message must be 1–4000 characters');
  }

  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: {
      case: {
        select: {
          residentId: true,
          templateId: true,
          template: {
            select: {
              title: true,
              condition: true,
              patientName: true,
              patientAgeYears: true,
              patientSex: true,
              description: true,
              oslerianPrinciples: true,
              bloomsLevel: true,
            },
          },
        },
      },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!conv) throw new CasesError('NOT_FOUND', 'Conversation not found');
  if (conv.status !== ConversationStatus.ACTIVE) {
    throw new CasesError('CONVERSATION_CLOSED', 'Conversation is no longer accepting messages');
  }
  if (conv.case.residentId !== actor.userId) {
    throw new CasesError('FORBIDDEN', 'Only the conversation owner can send messages');
  }

  const stageBefore = conv.stage;
  const stageAfter = nextStage(stageBefore);

  // Persist the resident message first so it survives even if mentor generation fails.
  const residentMsg = await db.message.create({
    data: {
      conversationId,
      userId: actor.userId,
      senderRole: 'RESIDENT',
      content: text,
      metadata: { stage: stageBefore },
    },
  });

  const history: ConversationMessage[] = conv.messages.map((m) => ({
    role: (m.senderRole as ConversationMessage['role']) ?? 'AI',
    content: m.content,
  }));
  history.push({ role: 'RESIDENT', content: text });

  let mentor: { role: 'AI' | 'PATIENT'; content: string };
  try {
    mentor = await generateMentorResponse({
      template: conv.case.template ?? null,
      stageBefore,
      stageAfter,
      history,
    });
  } catch (err) {
    // Fallback to a stage-default if Gemini is unavailable. Surfaces in the
    // UI as a normal mentor message; the audit / e2e harness can detect this
    // by inspecting the metadata.fallback flag below.
    console.warn('[cases] mentor generation fallback:', err);
    mentor = {
      role: 'AI',
      content: stageDefaultPrompt(stageAfter),
    };
  }

  const mentorMsg = await db.message.create({
    data: {
      conversationId,
      senderRole: mentor.role,
      content: mentor.content,
      aiModelVersion: 'gemini-phase-a',
      metadata: { stage: stageAfter },
    },
  });

  const newStatus =
    stageAfter === CaseStage.COMPLETED ? ConversationStatus.COMPLETED : ConversationStatus.ACTIVE;

  await db.$transaction([
    db.conversation.update({
      where: { id: conversationId },
      data: { stage: stageAfter, status: newStatus, updatedAt: new Date() },
    }),
    db.case.update({
      where: { id: conv.caseId },
      data: {
        currentStage: stageAfter,
        status: newStatus === ConversationStatus.COMPLETED ? CaseStatus.COMPLETED : CaseStatus.ACTIVE,
      },
    }),
    db.caseStageHistory.create({
      data: {
        caseId: conv.caseId,
        fromStage: stageBefore,
        toStage: stageAfter,
        reason: 'resident_message',
      },
    }),
  ]);

  return {
    residentMessage: {
      id: residentMsg.id,
      senderRole: 'RESIDENT',
      content: residentMsg.content,
      createdAt: residentMsg.createdAt.toISOString(),
      stage: stageBefore,
    },
    mentorMessage: {
      id: mentorMsg.id,
      senderRole: mentor.role,
      content: mentorMsg.content,
      createdAt: mentorMsg.createdAt.toISOString(),
      stage: stageAfter,
    },
    newStage: stageAfter,
    conversationStatus: newStatus,
  };
}

function stageDefaultPrompt(stage: CaseStage): string {
  switch (stage) {
    case CaseStage.OBSERVATION:
      return 'Good. Now examine the relevant findings — what do you observe?';
    case CaseStage.HYPOTHESIS:
      return 'Based on the history and your observations, what is your differential diagnosis, and what is your leading hypothesis?';
    case CaseStage.INVESTIGATION:
      return 'A reasonable differential. What investigations would you order to confirm — and why those, in this order?';
    case CaseStage.REFLECTION:
      return 'Step back from the clinical detail for a moment. What did this case teach you that you would carry into your next patient encounter?';
    case CaseStage.COMPLETED:
      return 'Thank you. The case is complete — review your reasoning above; faculty can leave structured feedback.';
    default:
      return 'Continue — tell me what you are noticing.';
  }
}
