// ════════════════════════════════════════════════════════════════════════════
// /teacher/decks/new — Deck-forge wizard (Phase 1B)
// ════════════════════════════════════════════════════════════════════════════
// Four-step wizard that drives POST /api/decks/wizard/forge:
//   Step 1 — Intent          (ENHANCE_EXISTING vs DRAFT_FROM_SCRATCH)
//   Step 2 — Sources         (upload new OR pick from existing library)
//   Step 3 — Briefing        (audience, sessionType, durationMin, objectives, localContext)
//   Step 4 — Confirm + Forge (review + Generate → redirect to studio)
//
// The legacy "Forge presentation" button on /teacher/documents/[id] still
// points at the simpler /api/decks/forge — that flow stays untouched per the
// "two parallel intakes, one shared studio" architectural choice.

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { DeckWizardClient, type ExistingDoc } from './wizard-client';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function DeckWizardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/teacher/decks/new');
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  // Load the faculty's recent documents so the wizard can offer "pick from
  // library" instead of forcing a re-upload. Cap at 30 — anything older is
  // available via the documents library page.
  const docs = await db.document.findMany({
    where: {
      uploadedById: session.user.id,
      deletedAt: null,
      expungedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      title: true,
      kind: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });

  const existingDocs: ExistingDoc[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    mimeType: d.mimeType,
    sizeBytes: Number(d.sizeBytes),
    createdAt: d.createdAt.toISOString(),
  }));

  return <DeckWizardClient existingDocs={existingDocs} />;
}
