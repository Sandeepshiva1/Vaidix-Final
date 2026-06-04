// ════════════════════════════════════════════════════════════════════════════
// NextAuth Session Type Augmentation
// ════════════════════════════════════════════════════════════════════════════
// Adds our custom fields (id, role, programs[], activeProgramId) to Session.

import type { Role } from '@prisma/client';
import 'next-auth';
import 'next-auth/jwt';

/**
 * W6.11 multi-tenancy: lightweight Program shape carried in the JWT so every
 * page/server-action can show the switcher without a DB roundtrip. Kept
 * deliberately small — full Program metadata lives in the DB and is fetched
 * only when needed.
 */
export interface SessionProgramMembership {
  programId: string;
  slug: string;
  name: string;
  /** Effective role inside this program: ProgramMembership.role ?? User.role. */
  role: Role;
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      passwordVersion: number;
      programs: SessionProgramMembership[];
      activeProgramId: string | null;
    };
  }

  interface User {
    id: string;
    role: Role;
    passwordVersion: number;
    programs: SessionProgramMembership[];
    activeProgramId: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    passwordVersion: number;
    programs: SessionProgramMembership[];
    activeProgramId: string | null;
  }
}
