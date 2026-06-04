// ════════════════════════════════════════════════════════════════════════════
// Vaidix — Module Registry
// ════════════════════════════════════════════════════════════════════════════
// Source of truth for all modules available in the platform.
// Role defines default access; UserModulePermission overrides per-user.
// Used by: invite modal checkboxes, middleware access checks, nav rendering.

import type { Role } from '@prisma/client';

export type ModuleCategory = 'learning' | 'assessment' | 'faculty' | 'program' | 'admin';

export interface ModuleDef {
  key: string;
  label: string;
  description: string;
  category: ModuleCategory;
  defaultRoles: Role[];         // roles that get this module by default
  icon?: string;                // lucide icon name (for UI)
  href?: string;                // route to navigate to
}

export const MODULES: readonly ModuleDef[] = [
  // ─── LEARNING ────────────────────────────────────────────────────────────
  {
    key: 'cases',
    label: 'Clinical Cases',
    description: '5-stage Socratic clinical case dialogues',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN'],
    icon: 'Stethoscope',
    href: '/cases',
  },
  {
    key: 'pearls',
    label: 'Pearls Library',
    description: 'Teacher-curated clinical wisdom and teaching pearls',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN', 'EXTERNAL_LEARNER'],
    icon: 'Gem',
    href: '/pearls',
  },
  {
    key: 'atlas',
    label: 'Signs Atlas',
    description: 'Ophthalmology image atlas with signs and modalities',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN', 'EXTERNAL_LEARNER'],
    icon: 'Image',
    href: '/atlas',
  },
  {
    key: 'challenges',
    label: 'Challenges',
    description: 'Diagnostic and imaging challenge problems',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY'],
    icon: 'Trophy',
    href: '/challenges',
  },
  {
    key: 'journal',
    label: 'Reflective Journal',
    description: 'Personal reflection entries and notes',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR'],
    icon: 'BookOpen',
    href: '/journal',
  },
  {
    key: 'classroom',
    label: 'Classroom & Sessions',
    description: 'Live video sessions, recordings, and Q&A',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN'],
    icon: 'Video',
    href: '/classroom',
  },
  {
    key: 'simulators',
    label: 'Simulators',
    description: 'OCT, fundus, VF reading simulators',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY'],
    icon: 'Activity',
    href: '/simulators',
  },
  {
    key: 'reviews',
    label: 'Spaced Repetition',
    description: 'SM-2 spaced repetition review queue',
    category: 'learning',
    defaultRoles: ['RESIDENT'],
    icon: 'RefreshCw',
    href: '/reviews',
  },
  {
    key: 'courses',
    label: 'Competency Courses',
    description: 'HEAD/HEART/HANDS skill track courses',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY'],
    icon: 'GraduationCap',
    href: '/courses',
  },
  {
    key: 'knowledge-hub',
    label: 'Knowledge Hub',
    description: 'RAG-powered ophthalmology reference Q&A',
    category: 'learning',
    defaultRoles: ['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN'],
    icon: 'BookMarked',
    href: '/knowledge-hub',
  },

  // ─── ASSESSMENT ─────────────────────────────────────────────────────────
  {
    key: 'progress',
    label: 'Progress & Portfolio',
    description: 'Personal dashboard with scores, EPA, milestones',
    category: 'assessment',
    defaultRoles: ['RESIDENT'],
    icon: 'TrendingUp',
    href: '/progress',
  },
  {
    key: 'recommendations',
    label: 'Recommendations',
    description: 'Personalized next-step suggestions',
    category: 'assessment',
    defaultRoles: ['RESIDENT'],
    icon: 'Sparkles',
    href: '/recommendations',
  },
  {
    key: 'dops',
    label: 'DOPS (take)',
    description: 'Direct Observation of Procedural Skills — student view',
    category: 'assessment',
    defaultRoles: ['RESIDENT'],
    icon: 'ClipboardCheck',
    href: '/dops',
  },
  {
    key: 'mini-cex',
    label: 'Mini-CEX (take)',
    description: 'Mini Clinical Evaluation Exercise — student view',
    category: 'assessment',
    defaultRoles: ['RESIDENT'],
    icon: 'FileCheck',
    href: '/mini-cex',
  },

  // ─── TEACHER ─────────────────────────────────────────────────────────────
  {
    key: 'faculty.cohort',
    label: 'Cohort Management',
    description: 'View and manage student cohort progress',
    category: 'faculty',
    defaultRoles: ['FACULTY', 'PROGRAM_DIRECTOR'],
    icon: 'Users',
    href: '/teacher/cohort',
  },
  {
    key: 'faculty.learners',
    label: 'Learners Dashboard',
    description: 'Per-student deep dive (scores, cases, recommendations)',
    category: 'faculty',
    defaultRoles: ['FACULTY', 'PROGRAM_DIRECTOR'],
    icon: 'UserCheck',
    href: '/teacher/learners',
  },
  {
    key: 'faculty.assess',
    label: 'Teacher Assessments',
    description: 'Complete DOPS and Mini-CEX on students',
    category: 'faculty',
    defaultRoles: ['FACULTY', 'PROGRAM_DIRECTOR'],
    icon: 'Edit',
    href: '/teacher/assess',
  },
  {
    key: 'faculty.documents',
    label: 'Document Library',
    description: 'Upload and manage teaching documents',
    category: 'faculty',
    defaultRoles: ['FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN'],
    icon: 'FolderOpen',
    href: '/teacher/documents',
  },
  {
    key: 'faculty.deck-forge',
    label: 'Deck Forge',
    description: 'AI-powered presentation generation from documents',
    category: 'faculty',
    defaultRoles: ['FACULTY', 'PROGRAM_DIRECTOR'],
    icon: 'Presentation',
    href: '/teacher/deck-forge',
  },
  {
    key: 'faculty.host-session',
    label: 'Host Sessions',
    description: 'Create and host live video sessions',
    category: 'faculty',
    defaultRoles: ['FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN'],
    icon: 'VideoIcon',
    href: '/teacher/sessions',
  },

  // ─── HOD ─────────────────────────────────────────────────────────────────
  {
    key: 'program.milestones',
    label: 'Milestones',
    description: 'ACGME-style milestone tracking for the program',
    category: 'program',
    defaultRoles: ['PROGRAM_DIRECTOR'],
    icon: 'Flag',
    href: '/hod/milestones',
  },
  {
    key: 'program.competency-map',
    label: 'Competency Map',
    description: 'Program-wide competency coverage visualization',
    category: 'program',
    defaultRoles: ['PROGRAM_DIRECTOR'],
    icon: 'Map',
    href: '/hod/competency-map',
  },
  {
    key: 'program.accreditation',
    label: 'Accreditation',
    description: 'Accreditation-ready reports and exports',
    category: 'program',
    defaultRoles: ['PROGRAM_DIRECTOR'],
    icon: 'Award',
    href: '/hod/accreditation',
  },

  // ─── ADMIN ────────────────────────────────────────────────────────────────
  {
    key: 'admin.users',
    label: 'User Management',
    description: 'Manage users, roles, and account status',
    category: 'admin',
    defaultRoles: ['ADMIN'],
    icon: 'Users',
    href: '/admin/users',
  },
  {
    key: 'admin.invitations',
    label: 'Invitations',
    description: 'Invite new users, track invitation queue',
    category: 'admin',
    defaultRoles: ['ADMIN'],
    icon: 'Mail',
    href: '/admin/invitations',
  },
  {
    key: 'admin.audit-logs',
    label: 'Audit Logs',
    description: 'System-wide audit trail of user actions',
    category: 'admin',
    defaultRoles: ['ADMIN'],
    icon: 'FileText',
    href: '/admin/audit-logs',
  },
  {
    key: 'admin.training-queue',
    label: 'Training Queue',
    description: 'Review content flagged for AI training set',
    category: 'admin',
    defaultRoles: ['ADMIN', 'PROGRAM_DIRECTOR'],
    icon: 'Database',
    href: '/admin/training-queue',
  },
  {
    key: 'admin.knowledge-base',
    label: 'Knowledge Base',
    description: 'Manage RAG collections and document indexing',
    category: 'admin',
    defaultRoles: ['ADMIN'],
    icon: 'Library',
    href: '/admin/knowledge-base',
  },
  {
    key: 'admin.institution',
    label: 'Institution Settings',
    description: 'Institution-wide settings and branding',
    category: 'admin',
    defaultRoles: ['ADMIN'],
    icon: 'Building',
    href: '/admin/institution',
  },
  {
    key: 'admin.settings',
    label: 'System Settings',
    description: 'Feature flags, retention policies, webhooks',
    category: 'admin',
    defaultRoles: ['ADMIN'],
    icon: 'Settings',
    href: '/admin/settings',
  },
  {
    key: 'admin.compliance',
    label: 'Compliance & DPDPA',
    description: 'DPDPA requests, consent records, expunge jobs',
    category: 'admin',
    defaultRoles: ['ADMIN', 'PROGRAM_DIRECTOR'],
    icon: 'ShieldCheck',
    href: '/admin/compliance',
  },
] as const;

export const MODULE_KEYS = MODULES.map((m) => m.key);
export type ModuleKey = typeof MODULES[number]['key'];

const moduleByKey = new Map(MODULES.map((m) => [m.key, m]));
export const getModule = (key: string): ModuleDef | undefined => moduleByKey.get(key);

export const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  learning: 'Learning Modules',
  assessment: 'Assessment Modules',
  faculty: 'Teacher Modules',
  program: 'HOD Modules',
  admin: 'Admin Modules',
};

export function modulesByCategory(): Record<ModuleCategory, ModuleDef[]> {
  const result = {
    learning: [] as ModuleDef[],
    assessment: [] as ModuleDef[],
    faculty: [] as ModuleDef[],
    program: [] as ModuleDef[],
    admin: [] as ModuleDef[],
  };
  for (const m of MODULES) result[m.category].push(m);
  return result;
}

/**
 * Default module keys granted to a role (before per-user overrides).
 */
export function defaultModulesForRole(role: Role): string[] {
  return MODULES.filter((m) => m.defaultRoles.includes(role)).map((m) => m.key);
}

/**
 * Resolve effective module access for a user.
 * Server-side function. Takes role defaults + per-user grants/revokes.
 */
export function resolveUserModules(
  role: Role,
  permissions: Array<{ moduleKey: string; granted: boolean }>
): Set<string> {
  const defaults = new Set(defaultModulesForRole(role));
  for (const p of permissions) {
    if (p.granted) defaults.add(p.moduleKey);
    else defaults.delete(p.moduleKey);
  }
  return defaults;
}
