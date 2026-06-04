import { MODULES, CATEGORY_LABELS, defaultModulesForRole } from '@/lib/modules';
import { Role } from '@prisma/client';
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';

export async function GET() {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;

    const modules = MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      category: m.category,
      defaultRoles: m.defaultRoles,
      icon: m.icon,
      href: m.href,
    }));

    const defaultsByRole: Record<Role, string[]> = {
      RESIDENT: defaultModulesForRole(Role.RESIDENT),
      FACULTY: defaultModulesForRole(Role.FACULTY),
      PROGRAM_DIRECTOR: defaultModulesForRole(Role.PROGRAM_DIRECTOR),
      ADMIN: defaultModulesForRole(Role.ADMIN),
      EXTERNAL_LEARNER: defaultModulesForRole(Role.EXTERNAL_LEARNER),
    };

    return jsonOk({
      modules,
      categories: CATEGORY_LABELS,
      defaultsByRole,
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}
