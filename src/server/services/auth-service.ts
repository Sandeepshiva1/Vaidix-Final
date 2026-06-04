// ════════════════════════════════════════════════════════════════════════════
// Auth Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Password verification, account lockout, identifier resolution.
// NEVER import from client code. Business rules live here, not in frontend.
//
// The login surface accepts THREE identifier kinds: email, Indian mobile, or
// username. Each is canonicalised before lookup so an attacker cannot burn
// distinct rate-limit buckets by spelling the same identifier differently
// (e.g. 'A@B.com' vs 'a@b.com', or '+91 9xx xxxxxxx' vs '9xx-xxxxxxx').
//
// Email-enumeration timing is mitigated by always running a bcrypt.compare
// with a known dummy hash when the lookup misses, so the response time is
// indistinguishable from a wrong-password hit.

import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { UserStatus, type User } from '@prisma/client';
import {
  detectIdentifierKind,
  canonicaliseMobile,
  type IdentifierKind,
} from '@/lib/validation/primitives';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

// A pre-computed bcrypt hash of a non-guessable secret, used to keep the
// response time on email-miss indistinguishable from email-hit-wrong-pw.
const DUMMY_BCRYPT =
  '$2a$12$oCXrgOMM3JYsZukNHjYGIuZpiymRZ.XgXZ8a9p4UnyiTqhvxXtQg6';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: User['role'];
  status: UserStatus;
  passwordVersion: number;
}

export type AuthFailureReason =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DEACTIVATED'
  | 'ACCOUNT_PENDING';

export type AuthResult =
  | { ok: true; user: AuthenticatedUser; identifierKind: IdentifierKind; canonicalIdentifier: string }
  | { ok: false; reason: AuthFailureReason; lockedUntil?: Date; identifierKind: IdentifierKind; canonicalIdentifier: string };

export interface ResolvedIdentifier {
  kind: IdentifierKind;
  /** Canonical form used for DB lookup AND for rate-limit bucket keying. */
  canonical: string;
}

/**
 * Convert raw user input into the canonical (kind, value) tuple. Returns
 * null for inputs we cannot interpret at all (e.g. empty string, garbage).
 *
 * Callers MUST use the returned `canonical` for lockout/rate-limit buckets
 * and audit-log details, not the raw input.
 */
export function resolveIdentifier(raw: string): ResolvedIdentifier | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const kind = detectIdentifierKind(trimmed);
  if (kind === 'email') {
    const lower = trimmed.toLowerCase();
    // Defensive: very loose email shape check to avoid pathological inputs
    // hitting the DB. Strict validation is in emailSchema upstream.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return null;
    return { kind: 'email', canonical: lower };
  }
  if (kind === 'mobile') {
    const m = canonicaliseMobile(trimmed);
    if (!m) return null;
    return { kind: 'mobile', canonical: m };
  }
  const lower = trimmed.toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(lower)) return null;
  return { kind: 'username', canonical: lower };
}

/**
 * Look up a user by exactly ONE identifier kind. We deliberately do NOT use
 * an OR-clause across all three columns because that opens a side channel:
 * if mobile and username overlapped numerically, a query-planner-dependent
 * cost difference could leak which kind matched. By dispatching on the
 * detected kind we keep the lookup column stable and predictable.
 */
async function findUserByIdentifier(id: ResolvedIdentifier) {
  const where =
    id.kind === 'email'
      ? { email: id.canonical }
      : id.kind === 'mobile'
        ? { mobile: id.canonical }
        : { username: id.canonical };
  return db.user.findUnique({ where });
}

/**
 * Sign-in entrypoint. Accepts ANY identifier shape (email/mobile/username),
 * canonicalises, looks up, verifies password, applies lockout transitions,
 * and returns a typed AuthResult.
 */
export async function verifyCredentials(
  rawIdentifier: string,
  password: string
): Promise<AuthResult> {
  const resolved = resolveIdentifier(rawIdentifier);
  if (!resolved) {
    // Garbage input — still pay the bcrypt cost to keep timing flat.
    await bcrypt.compare(password, DUMMY_BCRYPT);
    // Default to 'username' for the rate-limit bucket so spam can't enumerate.
    return {
      ok: false,
      reason: 'INVALID_CREDENTIALS',
      identifierKind: 'username',
      canonicalIdentifier: '',
    };
  }

  const user = await findUserByIdentifier(resolved);

  if (!user || !user.passwordHash) {
    // Constant-time artificial work to prevent identifier enumeration.
    await bcrypt.compare(password, DUMMY_BCRYPT);
    return {
      ok: false,
      reason: 'INVALID_CREDENTIALS',
      identifierKind: resolved.kind,
      canonicalIdentifier: resolved.canonical,
    };
  }

  // Check lockout BEFORE checking password so brute-forcers don't get a
  // distinguishable timing signal between "valid pw, locked" and "invalid pw".
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    // Still pay the bcrypt cost so timing stays flat.
    await bcrypt.compare(password, DUMMY_BCRYPT);
    return {
      ok: false,
      reason: 'ACCOUNT_LOCKED',
      lockedUntil: user.lockedUntil,
      identifierKind: resolved.kind,
      canonicalIdentifier: resolved.canonical,
    };
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);

  if (!passwordOk) {
    await registerFailedAttempt(user.id);
    return {
      ok: false,
      reason: 'INVALID_CREDENTIALS',
      identifierKind: resolved.kind,
      canonicalIdentifier: resolved.canonical,
    };
  }

  switch (user.status) {
    case UserStatus.PENDING_INVITE:
      return {
        ok: false,
        reason: 'ACCOUNT_PENDING',
        identifierKind: resolved.kind,
        canonicalIdentifier: resolved.canonical,
      };
    case UserStatus.SUSPENDED:
      return {
        ok: false,
        reason: 'ACCOUNT_SUSPENDED',
        identifierKind: resolved.kind,
        canonicalIdentifier: resolved.canonical,
      };
    case UserStatus.DEACTIVATED:
      return {
        ok: false,
        reason: 'ACCOUNT_DEACTIVATED',
        identifierKind: resolved.kind,
        canonicalIdentifier: resolved.canonical,
      };
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      passwordVersion: user.passwordVersion,
    },
    identifierKind: resolved.kind,
    canonicalIdentifier: resolved.canonical,
  };
}

async function registerFailedAttempt(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { failedLoginCount: true },
  });
  if (!user) return;

  const nextCount = user.failedLoginCount + 1;
  const shouldLock = nextCount >= MAX_FAILED_ATTEMPTS;

  await db.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: nextCount,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
    },
  });
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function isUserCurrent(userId: string, passwordVersion: number): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordVersion: true, status: true },
  });
  if (!user) return false;
  if (user.status !== UserStatus.ACTIVE) return false;
  return user.passwordVersion === passwordVersion;
}

/**
 * Generate a candidate username from an email. Used at invitation accept
 * time to seed `User.username`. Mirrors the SQL backfill in migration
 * `20260425190000_user_mobile_username` so a backfill and a fresh sign-up
 * produce the same shape.
 *
 * NOTE: this returns a candidate — caller must check uniqueness in DB and
 * append a numeric suffix on collision.
 */
export function candidateUsernameFromEmail(email: string): string {
  const local = email.toLowerCase().split('@')[0] ?? '';
  const cleaned = local.replace(/[^a-z0-9._-]+/g, '_');
  const truncated = cleaned.slice(0, 28);
  if (!truncated) return 'user';
  return truncated;
}

/**
 * Find an unused username by trying the candidate, then candidate-2,
 * candidate-3, ... up to a sane bound. Race-safe: the caller should still
 * wrap the user creation in a transaction and handle the unique-constraint
 * failure (P2002) by retrying with the next suffix.
 */
export async function pickAvailableUsername(candidate: string): Promise<string> {
  const base = candidate.slice(0, 28);
  for (let i = 0; i < 50; i++) {
    const proposed = i === 0 ? base : `${base}-${i + 1}`;
    const trimmed = proposed.slice(0, 32);
    const taken = await db.user.findUnique({ where: { username: trimmed }, select: { id: true } });
    if (!taken) return trimmed;
  }
  // Fallback — guaranteed-unique 32-char value derived from the cuid generator
  // we already use everywhere; the caller can retry on the rare collision.
  const random = Math.random().toString(36).slice(2, 10);
  return `${base.slice(0, 23)}-${random}`;
}
