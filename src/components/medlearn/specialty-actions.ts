'use server';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role } from '@prisma/client';

// Roles allowed to extend the specialty taxonomy — kept identical to the
// session-creator allow-list, since adding a specialty only happens from the
// create-session wizard.
const TAXONOMY_EDITOR_ROLES: Role[] = [
  Role.PROGRAM_DIRECTOR,
  Role.ADMIN,
  Role.FACULTY,
  Role.RESIDENT,
];

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireEditor(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'You must be signed in.' };
  if (!TAXONOMY_EDITOR_ROLES.includes(session.user.role)) {
    return { ok: false, error: 'Your role cannot add specialties.' };
  }
  return { ok: true };
}

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Create (or reuse) a global Specialty. Case-insensitive dedupe so "Cornea"
 * and "cornea" don't both land in the dropdown. Returns the row so the wizard
 * can append + select it without a refetch.
 */
export async function createSpecialtyAction(
  rawName: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  const gate = await requireEditor();
  if (!gate.ok) return gate;

  const name = cleanName(rawName);
  if (name.length < 2) return { ok: false, error: 'Specialty name is too short.' };
  if (name.length > 80) return { ok: false, error: 'Specialty name is too long.' };

  const existing = await db.specialty.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (existing) return { ok: true, data: existing };

  const max = await db.specialty.aggregate({ _max: { displayOrder: true } });
  const created = await db.specialty.create({
    data: { name, displayOrder: (max._max.displayOrder ?? -1) + 1 },
    select: { id: true, name: true },
  });
  return { ok: true, data: created };
}

/**
 * Create (or reuse) a SubSpecialty under an existing Specialty. Validates the
 * parent exists and dedupes case-insensitively within that parent.
 */
export async function createSubSpecialtyAction(
  specialtyId: string,
  rawName: string,
): Promise<ActionResult<{ id: string; name: string; specialtyId: string }>> {
  const gate = await requireEditor();
  if (!gate.ok) return gate;

  const name = cleanName(rawName);
  if (name.length < 2) return { ok: false, error: 'Sub-specialty name is too short.' };
  if (name.length > 80) return { ok: false, error: 'Sub-specialty name is too long.' };

  const parent = await db.specialty.findUnique({
    where: { id: specialtyId },
    select: { id: true },
  });
  if (!parent) return { ok: false, error: 'Pick a specialty first.' };

  const existing = await db.subSpecialty.findFirst({
    where: { specialtyId, name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true, specialtyId: true },
  });
  if (existing) return { ok: true, data: existing };

  const max = await db.subSpecialty.aggregate({
    where: { specialtyId },
    _max: { displayOrder: true },
  });
  const created = await db.subSpecialty.create({
    data: { name, specialtyId, displayOrder: (max._max.displayOrder ?? -1) + 1 },
    select: { id: true, name: true, specialtyId: true },
  });
  return { ok: true, data: created };
}
