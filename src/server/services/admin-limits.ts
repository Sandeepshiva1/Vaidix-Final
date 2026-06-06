// ════════════════════════════════════════════════════════════════════════════
// Admin-count policy — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Caps how many ACTIVE admins can exist at once. Suspended / deactivated admins
// do NOT count, so disabling an admin frees a slot (and re-enabling consumes one
// again). Configurable via the MAX_ACTIVE_ADMINS env var (default 3).
//
// Enforced at every point an account can BECOME admin:
//   • invite creation (counts active admins + outstanding PENDING admin invites)
//   • invite accept   (live active-admin count)
//   • role change → ADMIN (live active-admin count)
//
// Note on "enterprise grade": large orgs usually don't hard-cap admins at a
// tiny number — they lean on least-privilege roles, approval/justification, and
// separation of duties. A small configurable cap is a reasonable guardrail
// against admin sprawl; keep it adjustable rather than hard-coded.

import { db } from '@/lib/db';
import { Role, UserStatus, InvitationStatus } from '@prisma/client';

export const MAX_ACTIVE_ADMINS = Math.max(
  1,
  Number.parseInt(process.env.MAX_ACTIVE_ADMINS ?? '', 10) || 3,
);

export const ADMIN_LIMIT_CODE = 'ADMIN_LIMIT_REACHED';

export const adminLimitMessage = `Admin limit reached (${MAX_ACTIVE_ADMINS} active admins). Disable or downgrade an existing admin to free a slot, or raise the MAX_ACTIVE_ADMINS setting.`;

export class AdminLimitError extends Error {
  constructor() {
    super(ADMIN_LIMIT_CODE);
    this.name = 'AdminLimitError';
  }
}

export async function countActiveAdmins(): Promise<number> {
  return db.user.count({
    where: { role: Role.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
  });
}

/**
 * Throws {@link AdminLimitError} when granting one more ADMIN would exceed the
 * cap. Pass `includePendingInvites` at invite-creation time so you can't queue
 * up more admin invites than there are free slots; at accept / role-change time
 * leave it off (the live active-admin count is the source of truth there).
 */
export async function assertCanGrantAdmin(opts?: { includePendingInvites?: boolean }): Promise<void> {
  let load = await countActiveAdmins();
  if (opts?.includePendingInvites) {
    load += await db.invitation.count({
      where: { role: Role.ADMIN, status: InvitationStatus.PENDING },
    });
  }
  if (load >= MAX_ACTIVE_ADMINS) throw new AdminLimitError();
}
