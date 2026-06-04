// ════════════════════════════════════════════════════════════════════════════
// /profile/style — Faculty AI style memory settings
// ════════════════════════════════════════════════════════════════════════════
// Shows the distilled rules the AI uses when forging this faculty's next deck.
// Faculty can edit/delete any rule, manually trigger a rebuild, or clear
// everything. All data is self-scoped through /api/me/style-profile — there
// is no faculty-id parameter in the path.

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';
import { getFacultyStyleProfileForUi } from '@/server/services/decks/faculty-style-profile';
import { StyleProfileClient } from './style-profile-client';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

export default async function StyleProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!FACULTY_LIKE.includes(session.user.role)) {
    // Residents don't author decks; nothing to memorize.
    redirect('/profile');
  }

  const [profile, prefs] = await Promise.all([
    getFacultyStyleProfileForUi(session.user.id),
    db.userPreferences.findUnique({
      where: { userId: session.user.id },
      select: { aiMemoryOptIn: true },
    }),
  ]);

  return (
    <StyleProfileClient
      initialProfile={profile}
      memoryOptIn={prefs?.aiMemoryOptIn ?? true}
    />
  );
}
