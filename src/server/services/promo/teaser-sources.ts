// ════════════════════════════════════════════════════════════════════════════
// Teaser source gathering — what the AI actually sees
// ════════════════════════════════════════════════════════════════════════════
// Before this module, the teaser prompt was just title + description. Faculty
// rightly pointed out that the actual class content (objectives the curator
// set, study material they uploaded, pre-questions residents asked) should
// inform the teaser. This module is the single source of truth for "what
// signals does the AI get" — used by:
//   - the Gemini prompt builder (buildCopy in promo-service.ts)
//   - the curator-facing /api/promo/teaser-video/sources endpoint
//
// Both call the same function so what the curator previews is exactly what
// the AI will use; no drift.

import { db } from '@/lib/db';

export interface TeaserSources {
  sessionId: string;
  title: string;
  description: string | null;
  hostName: string;
  scheduledStart: Date;
  sessionType: string;
  tags: string[];
  /** Objectives, ordered as the curator stored them. */
  objectives: Array<{ text: string; blooms: number }>;
  /** Pre-session readings + pre-cases — what residents are expected to study. */
  studyMaterial: Array<{ kind: 'reading' | 'video' | 'pre-case'; title: string }>;
  /** Top-voted pre-questions from residents — the strongest signal of "what
   *  the audience actually wants covered". Capped at 5 to keep the prompt
   *  compact. */
  topPreQuestions: Array<{ content: string; voteCount: number }>;
  /** Aggregate counts for the curator-facing digest UI. */
  counts: {
    objectives: number;
    studyMaterial: number;
    preQuestions: number;
  };
}

interface StoredObjective { id: string; text: string; blooms: number }

const PRE_QUESTION_TAKE = 5;

/**
 * Pull every signal the teaser AI should know about a session, in one batch.
 * Tolerant of orphaned uploader/host FKs (matches the v1.8 hardening pattern):
 * if the host record has been soft-deleted we still produce a teaser using
 * "Faculty" as a graceful fallback rather than 404'ing the route.
 */
export async function gatherTeaserSources(sessionId: string): Promise<TeaserSources | null> {
  const session = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      description: true,
      sessionType: true,
      tags: true,
      scheduledStart: true,
      hostId: true,
      objectives: true,
    },
  });
  if (!session) return null;

  const [host, prepDocs, preCases, preQuestions] = await Promise.all([
    db.user.findUnique({
      where: { id: session.hostId },
      select: { name: true },
    }),
    db.documentSessionLink.findMany({
      where: { sessionId, isPreSession: true },
      include: {
        document: { select: { title: true, kind: true, deletedAt: true } },
      },
      orderBy: [{ preSessionRank: 'asc' }, { createdAt: 'asc' }],
      take: 20,
    }),
    db.sessionPreCase.findMany({
      where: { sessionId },
      include: { caseTemplate: { select: { title: true } } },
      orderBy: { rank: 'asc' },
      take: 10,
    }),
    db.preSessionQuestion.findMany({
      where: { sessionId },
      orderBy: [{ voteCount: 'desc' }, { createdAt: 'desc' }],
      select: { content: true, voteCount: true },
      take: PRE_QUESTION_TAKE,
    }),
  ]);

  const objectives = (session.objectives as unknown as StoredObjective[] | null) ?? [];

  const studyMaterial: TeaserSources['studyMaterial'] = [
    ...prepDocs
      .filter((p) => !p.document.deletedAt)
      .map((p) => ({
        kind: p.document.kind === 'VIDEO' ? ('video' as const) : ('reading' as const),
        title: p.document.title,
      })),
    ...preCases.map((c) => ({
      kind: 'pre-case' as const,
      title: c.caseTemplate.title,
    })),
  ];

  // For pre-questions, keep the count (so the digest can say "12 cohort questions")
  // even though the prompt only sees the top 5.
  const totalPreQuestions = await db.preSessionQuestion.count({ where: { sessionId } });

  return {
    sessionId,
    title: session.title,
    description: session.description,
    hostName: host?.name ?? 'Faculty',
    scheduledStart: session.scheduledStart,
    sessionType: session.sessionType,
    tags: session.tags,
    objectives: objectives.map((o) => ({ text: o.text, blooms: o.blooms })),
    studyMaterial,
    topPreQuestions: preQuestions.map((q) => ({
      content: q.content,
      voteCount: q.voteCount,
    })),
    counts: {
      objectives: objectives.length,
      studyMaterial: studyMaterial.length,
      preQuestions: totalPreQuestions,
    },
  };
}
