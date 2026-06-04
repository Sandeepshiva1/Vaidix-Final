// ════════════════════════════════════════════════════════════════════════════
// NextAuth v5 — Main config (Node runtime)
// ════════════════════════════════════════════════════════════════════════════
//
// Multi-identifier login: the credentials provider accepts EITHER `identifier`
// (canonical name) OR `email` (back-compat alias). The schema folds the value
// into `identifier` after parsing so verifyCredentials always sees one input.
//
// Every login attempt — success, failure, locked — is written to the audit
// log here. The audit `details` field carries `identifierKind` (email|mobile|
// username) but NEVER the raw identifier value (PII / DPDPA). The canonical
// identifier is hashed before logging so SREs can correlate without storing
// the email/mobile/username verbatim.

import crypto from 'node:crypto';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { loginSchema } from './lib/validation/auth';
import { verifyCredentials } from './server/services/auth-service';
import { audit, AUDIT_EVENTS } from './server/services/audit';
import { loadProgramsForUser } from './server/services/program-service';

function hashIdentifier(canonical: string): string {
  // Truncated SHA-256: enough to correlate repeat attempts in audit logs
  // without storing the email/mobile/username at rest.
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function ipAndUaFromRequest(req: Request | undefined) {
  if (!req) return { ipAddress: null as string | null, userAgent: null as string | null };
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null;
  const userAgent = req.headers.get('user-agent') ?? null;
  return { ipAddress, userAgent };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        identifier: {},
        email: {},
        password: {},
      },
      async authorize(credentials, request) {
        const { ipAddress, userAgent } = ipAndUaFromRequest(request as Request | undefined);
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          await audit({
            eventType: AUDIT_EVENTS.LOGIN_FAILED,
            ipAddress,
            userAgent,
            success: false,
            details: { reason: 'VALIDATION', errors: parsed.error.flatten().fieldErrors },
          });
          return null;
        }

        const result = await verifyCredentials(parsed.data.identifier, parsed.data.password);

        if (!result.ok) {
          // Distinguish locked-account from generic failure for ops insight,
          // but keep the user-facing UX identical (handled in the form).
          const isLocked = result.reason === 'ACCOUNT_LOCKED';
          await audit({
            eventType: isLocked ? AUDIT_EVENTS.LOGIN_LOCKED : AUDIT_EVENTS.LOGIN_FAILED,
            ipAddress,
            userAgent,
            success: false,
            details: {
              reason: result.reason,
              identifierKind: result.identifierKind,
              identifierHash: result.canonicalIdentifier ? hashIdentifier(result.canonicalIdentifier) : null,
            },
          });
          return null;
        }

        await audit({
          actorId: result.user.id,
          actorRole: result.user.role,
          eventType: AUDIT_EVENTS.LOGIN_SUCCESS,
          entityType: 'user',
          entityId: result.user.id,
          ipAddress,
          userAgent,
          details: {
            identifierKind: result.identifierKind,
            identifierHash: hashIdentifier(result.canonicalIdentifier),
          },
        });

        // Load the user's program memberships + active program here
        // so the JWT carries them from sign-in onwards. No edge-runtime DB
        // imports leak into auth.config (this file is Node-only).
        const { programs, activeProgramId } = await loadProgramsForUser(result.user.id);

        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
          passwordVersion: result.user.passwordVersion,
          programs,
          activeProgramId,
        };
      },
    }),
  ],
});
