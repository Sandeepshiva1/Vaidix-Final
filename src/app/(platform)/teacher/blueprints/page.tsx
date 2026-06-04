// ════════════════════════════════════════════════════════════════════════════
// /teacher/blueprints — Curriculum Blueprint generator + library
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Role } from '@prisma/client';
import { listBlueprintsForUser } from '@/server/services/blueprints/blueprint-service';
import { BlueprintsClient } from './blueprints-client';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function FacultyBlueprintsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/teacher/blueprints');
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const blueprints = await listBlueprintsForUser(session.user.id);

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Curriculum Blueprints</h1>
        <p className="text-sm text-muted-foreground">
          Generate a Precision Education Blueprint for a topic — learner profile, VARK adaptation,
          learning theory, instructional tactics, feedback loop, and OSCE/DOPS assessment.
          Distinct from slide forge: this is the *plan*, not the slides.
        </p>
      </header>
      <BlueprintsClient
        initial={blueprints.map((b) => ({
          id: b.id,
          topic: b.topic,
          learnerLevel: b.learnerLevel,
          createdAt: b.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
