// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/users
// ════════════════════════════════════════════════════════════════════════════
// Paginated user list for admin management. Admin-only. Supports filtering by
// role / status and a case-insensitive search on name + email.

import {
  jsonOk,
  requireRole,
  parseQuery,
  handleUnexpected,
} from '@/server/services/api-helpers';
import { Role, UserStatus } from '@prisma/client';
import { listUsers } from '@/server/services/user-admin-service';
import { listUsersQuerySchema } from '@/lib/validation/auth';

export async function GET(req: Request) {
  try {
    const gate = await requireRole(Role.ADMIN);
    if (!gate.ok) return gate.response;

    const q = await parseQuery(req, listUsersQuerySchema);
    if (!q.ok) return q.response;

    const result = await listUsers({
      role: q.data.role,
      status: q.data.status as UserStatus | undefined,
      search: q.data.search,
      limit: q.data.limit,
      cursor: q.data.cursor,
    });
    return jsonOk(result);
  } catch (err) {
    return handleUnexpected(err);
  }
}
