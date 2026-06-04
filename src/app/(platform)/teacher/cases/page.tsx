// ════════════════════════════════════════════════════════════════════════════
// /teacher/cases — Faculty's authored cases (drafts + published + archived)
// ════════════════════════════════════════════════════════════════════════════
// Faculty-side launchpad: every case the user has forged or hand-authored.
// Drafts only the owner sees; published cases are also in the resident bank
// (filtered server-side by listCaseTemplates).

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Role } from '@prisma/client';
import { listMyCases } from '@/server/services/cases/case-forge-service';
import { FacultyCasesClient } from './cases-client';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function FacultyCasesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/teacher/cases');
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const cases = await listMyCases(session.user.id);

  return (
    <FacultyCasesClient
      cases={cases.map((c) => ({
        id: c.id,
        title: c.title,
        condition: c.condition,
        status: c.status,
        difficulty: c.difficulty,
        bloomsLevel: c.bloomsLevel,
        estimatedMinutes: c.estimatedMinutes,
        forgedAt: c.forgedAt?.toISOString() ?? null,
        publishedAt: c.publishedAt?.toISOString() ?? null,
        sourceDocumentId: c.sourceDocumentId,
        isEmergency: c.isEmergency,
        tags: c.tags,
      }))}
    />
  );
}
