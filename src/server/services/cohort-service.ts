// ════════════════════════════════════════════════════════════════════════════
// Cohort Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Cohort CRUD + membership management. Used by Session Scheduling for
// COHORT-visibility sessions.

import { db } from '@/lib/db';
import { audit, AUDIT_EVENTS } from './audit';
import { CohortStatus, Role } from '@prisma/client';
import type { CreateCohortInput, UpdateCohortInput } from '@/lib/validation/session';

const FACULTY_REF_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

export class CohortServiceError extends Error {
  constructor(
    public readonly code: 'INVALID_FACULTY' | 'NOT_FOUND',
    message: string
  ) {
    super(message);
  }
}

/**
 * Verify that a cuid actually belongs to a FACULTY user before we accept it
 * as a cohort mentor. Returns null when the input is null/undefined so the
 * caller can pass-through. Throws on bad IDs.
 */
async function ensureFacultyId(facultyId: string | null | undefined): Promise<string | null> {
  if (facultyId == null) return null;
  const u = await db.user.findFirst({
    where: { id: facultyId, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!u) throw new CohortServiceError('INVALID_FACULTY', 'Faculty mentor user not found');
  if (u.role !== Role.FACULTY) {
    throw new CohortServiceError('INVALID_FACULTY', 'Cohort mentor must have role FACULTY');
  }
  return u.id;
}

/**
 * W6.11 multi-tenancy: callers MUST pass the active programId. Cohorts are
 * tenant-scoped — a PD viewing the MS Ophthalmology dashboard should never
 * see Cornea Fellowship cohorts even if they have membership in both.
 */
export async function listCohorts(opts: {
  programId: string
  includeArchived?: boolean
}) {
  return db.cohort.findMany({
    where: {
      programId: opts.programId,
      deletedAt: null,
      status: opts.includeArchived ? undefined : CohortStatus.ACTIVE,
    },
    include: {
      faculty: { select: FACULTY_REF_SELECT },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getCohort(id: string) {
  return db.cohort.findFirst({
    where: { id, deletedAt: null },
    include: {
      faculty: { select: FACULTY_REF_SELECT },
      members: {
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { addedAt: 'desc' },
      },
      _count: { select: { members: true, sessions: true } },
    },
  });
}

export async function createCohort(input: CreateCohortInput, createdBy: string, programId: string) {
  const facultyId = await ensureFacultyId(input.facultyId);
  const cohort = await db.cohort.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      academicYear: input.academicYear ?? null,
      facultyId,
      createdBy,
      programId,
    },
    include: { faculty: { select: FACULTY_REF_SELECT } },
  });
  await audit({
    actorId: createdBy,
    eventType: 'COHORT_CREATED',
    entityType: 'cohort',
    entityId: cohort.id,
    summary: `Created cohort "${cohort.name}"`,
    details: facultyId ? { facultyId } : undefined,
  });
  if (facultyId) {
    await audit({
      actorId: createdBy,
      eventType: AUDIT_EVENTS.COHORT_FACULTY_ASSIGNED,
      entityType: 'cohort',
      entityId: cohort.id,
      summary: `Assigned faculty mentor on cohort creation`,
      details: { facultyId },
    });
  }
  return cohort;
}

export async function addMembers(cohortId: string, userIds: string[], addedBy: string) {
  const added = await db.$transaction(
    userIds.map((userId) =>
      db.cohortMember.upsert({
        where: { cohortId_userId: { cohortId, userId } },
        create: { cohortId, userId, addedBy },
        update: {},
      })
    )
  );
  await audit({
    actorId: addedBy,
    eventType: 'COHORT_MEMBERS_ADDED',
    entityType: 'cohort',
    entityId: cohortId,
    summary: `Added ${added.length} member(s)`,
    details: { userIds },
  });
  return added;
}

export async function removeMember(cohortId: string, userId: string, removedBy: string) {
  await db.cohortMember.delete({
    where: { cohortId_userId: { cohortId, userId } },
  });
  await audit({
    actorId: removedBy,
    eventType: 'COHORT_MEMBER_REMOVED',
    entityType: 'cohort',
    entityId: cohortId,
    summary: `Removed member ${userId}`,
  });
}

export async function archiveCohort(id: string, actorId: string) {
  await db.cohort.update({
    where: { id },
    data: { status: CohortStatus.ARCHIVED },
  });
  await audit({
    actorId,
    eventType: 'COHORT_ARCHIVED',
    entityType: 'cohort',
    entityId: id,
    summary: 'Cohort archived',
  });
}

export async function updateCohort(id: string, input: UpdateCohortInput, actorId: string) {
  // Faculty mentor changes need a separate audit event so they show up
  // distinctly in compliance / mapping-history reports. Capture before-state
  // first so we can tell "assigned" vs "cleared" vs "swapped".
  let facultyChange: { from: string | null; to: string | null } | null = null;
  if (input.facultyId !== undefined) {
    const facultyId = await ensureFacultyId(input.facultyId);
    const existing = await db.cohort.findUnique({
      where: { id },
      select: { facultyId: true },
    });
    if (existing && existing.facultyId !== facultyId) {
      facultyChange = { from: existing.facultyId, to: facultyId };
    }
  }

  const cohort = await db.cohort.update({
    where: { id },
    data: {
      ...(input.name !== undefined          && { name: input.name }),
      ...(input.description !== undefined   && { description: input.description || null }),
      ...(input.academicYear !== undefined  && { academicYear: input.academicYear || null }),
      ...(input.facultyId !== undefined     && { facultyId: input.facultyId ?? null }),
    },
    include: { faculty: { select: FACULTY_REF_SELECT } },
  });

  await audit({
    actorId,
    eventType: 'COHORT_UPDATED',
    entityType: 'cohort',
    entityId: id,
    summary: `Updated cohort "${cohort.name}"`,
    details: input,
  });

  if (facultyChange) {
    await audit({
      actorId,
      eventType: facultyChange.to
        ? AUDIT_EVENTS.COHORT_FACULTY_ASSIGNED
        : AUDIT_EVENTS.COHORT_FACULTY_CLEARED,
      entityType: 'cohort',
      entityId: id,
      summary: facultyChange.to
        ? `Faculty mentor set on cohort "${cohort.name}"`
        : `Faculty mentor cleared on cohort "${cohort.name}"`,
      details: facultyChange,
    });
  }

  return cohort;
}

// Soft delete — sets deletedAt but keeps the row so audit trails / FKs survive.
// The cohort disappears from listCohorts() and getCohort() because both filter
// by `deletedAt: null`.
export async function deleteCohort(id: string, actorId: string) {
  const cohort = await db.cohort.update({
    where: { id },
    data: { deletedAt: new Date(), status: CohortStatus.ARCHIVED },
  });
  await audit({
    actorId,
    eventType: 'COHORT_DELETED',
    entityType: 'cohort',
    entityId: id,
    summary: `Deleted cohort "${cohort.name}"`,
  });
}

export async function getUserCohortIds(userId: string): Promise<string[]> {
  const rows = await db.cohortMember.findMany({
    where: { userId, cohort: { status: CohortStatus.ACTIVE, deletedAt: null } },
    select: { cohortId: true },
  });
  return rows.map((r) => r.cohortId);
}
