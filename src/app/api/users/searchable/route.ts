// ════════════════════════════════════════════════════════════════════════════
// GET /api/users/searchable
// ════════════════════════════════════════════════════════════════════════════
// Lightweight user list for "pick a user" UIs (cohort member picker,
// session invite picker). Returns only the fields a picker needs — no admin
// surface area like lockedUntil, lastLoginAt, etc.
//
// Two purposes, two access models:
//   purpose=invite — any authenticated user with an active program may search,
//                    but results are scoped to fellow members of that program.
//                    Used by the schedule-a-session invite picker so a resident
//                    or fellow can invite anyone in their program (QA #2).
//   purpose=cohort — ADMIN / PROGRAM_DIRECTOR only. Used by the cohort
//                    membership and admin invitation surfaces, which need to
//                    surface every active user regardless of program.
//   (omitted)      — defaults to `cohort` for backwards compatibility — fail
//                    closed if a caller forgets to declare intent.
//
// Query params:
//   purpose      — 'invite' | 'cohort' (see above)
//   role         — optional, single Role enum value to filter by
//   search       — optional, case-insensitive name/email substring match
//   excludeIds   — optional, comma-separated user IDs to omit (already added)
//   limit        — default 30, max 100

import { db } from '@/lib/db';
import { Role, UserStatus, Prisma } from '@prisma/client';
import { jsonOk, requireRole, requireAuthWithProgram, handleUnexpected } from '@/server/services/api-helpers';

type Purpose = 'invite' | 'cohort';

export async function GET(req: Request) {
  try {
    const url      = new URL(req.url);
    const purpose: Purpose = url.searchParams.get('purpose') === 'invite' ? 'invite' : 'cohort';

    // Auth gate depends on purpose. `invite` is open to any authenticated user
    // with an active program; `cohort` (default) is admin-only as before.
    let actorProgramScope: Prisma.UserWhereInput | null = null;
    if (purpose === 'invite') {
      const gate = await requireAuthWithProgram();
      if (!gate.ok) return gate.response;
      // Restrict results to users who share at least one program membership
      // with the searcher. Without this, invite would leak the global user
      // directory across tenants.
      actorProgramScope = {
        programMemberships: { some: { programId: gate.user.activeProgramId } },
      };
    } else {
      const gate = await requireRole(Role.ADMIN, Role.PROGRAM_DIRECTOR);
      if (!gate.ok) return gate.response;
    }

    const role     = url.searchParams.get('role') as Role | null;
    const search   = url.searchParams.get('search')?.trim() ?? '';
    const exclude  = url.searchParams.get('excludeIds')?.split(',').filter(Boolean) ?? [];
    const limit    = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));

    const where: Prisma.UserWhereInput = {
      status: UserStatus.ACTIVE,
      deletedAt: null,
      ...(actorProgramScope ?? {}),
    };
    if (role && Object.values(Role).includes(role)) where.role = role;
    if (exclude.length > 0)                          where.id = { notIn: exclude };
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await db.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, avatarUrl: true },
      orderBy: { name: 'asc' },
      take: limit,
    });
    return jsonOk({ users });
  } catch (err) {
    return handleUnexpected(err);
  }
}
