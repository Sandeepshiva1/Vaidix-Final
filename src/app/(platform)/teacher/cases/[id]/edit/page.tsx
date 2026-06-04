// ════════════════════════════════════════════════════════════════════════════
// /teacher/cases/[id]/edit — refine an AI-forged case before publishing
// ════════════════════════════════════════════════════════════════════════════
// Owner-only. PATCH-back via /api/cases/[caseTemplateId]; publish via the
// dedicated /publish endpoint (DRAFT → PUBLISHED makes the case visible to
// program residents). Stage guidance from the forge is shown read-only in
// this phase — direct stage-by-stage editing arrives with the case AI Coach.

import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { CaseEditorClient } from './case-editor-client';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function CaseEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=/teacher/cases/${id}/edit`);
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const tpl = await db.caseTemplate.findUnique({
    where: { id },
    include: {
      sourceDocument: { select: { id: true, title: true, kind: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  if (!tpl) notFound();
  // Only the owner (or admin) edits drafts. Other faculty can read via the
  // resident-facing API once published, not this editor.
  if (tpl.ownerId !== session.user.id && session.user.role !== Role.ADMIN) {
    redirect('/teacher/cases');
  }

  // Sessions this case is already linked to + sessions available to link.
  const linkedPreCases = await db.sessionPreCase.findMany({
    where: { caseTemplateId: tpl.id },
    select: {
      sessionId: true,
      required: true,
      rank: true,
      session: {
        select: { id: true, title: true, scheduledStart: true, status: true },
      },
    },
  });

  const availableSessions = await db.teachingSession.findMany({
    where: {
      programId: tpl.programId,
      deletedAt: null,
    },
    select: { id: true, title: true, scheduledStart: true },
    orderBy: { scheduledStart: 'desc' },
    take: 50,
  });

  return (
    <CaseEditorClient
      template={{
        id: tpl.id,
        title: tpl.title,
        condition: tpl.condition,
        specialty: tpl.specialty,
        description: tpl.description,
        difficulty: tpl.difficulty,
        bloomsLevel: tpl.bloomsLevel,
        estimatedMinutes: tpl.estimatedMinutes,
        patientName: tpl.patientName,
        patientAgeYears: tpl.patientAgeYears,
        patientSex: tpl.patientSex,
        patientPresentingComplaint: tpl.patientPresentingComplaint,
        oslerianPrinciples: tpl.oslerianPrinciples,
        tags: tpl.tags,
        isEmergency: tpl.isEmergency,
        imageCount: tpl.imageCount,
        status: tpl.status,
        forgedAt: tpl.forgedAt?.toISOString() ?? null,
        publishedAt: tpl.publishedAt?.toISOString() ?? null,
        stageGuidance: tpl.stageGuidance as unknown,
        sourceDocument: tpl.sourceDocument,
      }}
      linkedSessions={linkedPreCases
        .filter((p) => p.session)
        .map((p) => ({
          sessionId: p.sessionId,
          title: p.session.title,
          scheduledStart: p.session.scheduledStart?.toISOString() ?? null,
          status: p.session.status,
          required: p.required,
        }))}
      availableSessions={availableSessions.map((s) => ({
        id: s.id,
        title: s.title,
        scheduledStart: s.scheduledStart?.toISOString() ?? null,
      }))}
    />
  );
}
