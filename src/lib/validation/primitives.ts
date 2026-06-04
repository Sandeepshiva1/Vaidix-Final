// ════════════════════════════════════════════════════════════════════════════
// Validation primitives — reusable Zod fragments
// ════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';

export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Invalid email address')
  .max(254)
  .transform((v) => v.trim().toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password too long')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Must contain at least one digit')
  .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');

// Names may include digits (suffixes like "John Smith III", initialisms) and
// Unicode letters for Indian names in various scripts.
export const fullNameSchema = z
  .string()
  .min(2, 'Name is too short')
  .max(120, 'Name is too long')
  .regex(/^[\p{L}0-9\s.,'&()-]+$/u, 'Name contains invalid characters')
  .transform((v) => v.trim());

// Indian mobile: +91 followed by 10 digits starting 6-9, or plain 10 digits
export const mobileSchema = z
  .string()
  .regex(/^(\+91[-\s]?)?[6-9]\d{9}$/, 'Invalid Indian mobile number')
  .transform((v) => v.replace(/\s|-/g, ''));

export const mciRegSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[A-Z0-9-]+$/i, 'Invalid MCI registration number')
  .transform((v) => v.toUpperCase());

export const tokenSchema = z.string().min(16).max(256);

export const cuidSchema = z.string().regex(/^c[a-z0-9]{24}$/i, 'Invalid ID');

// ─── Username + identifier (multi-format login) ─────────────────────────────
// Username: 3-32 chars, lowercase letters/digits/underscore/hyphen. Reserved
// words can't be picked. Auto-generated from email local-part at invitation
// accept; operator can override later.
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help',
  'vaidix', 'lvpei', 'api', 'auth', 'login', 'logout', 'signin', 'signup',
  'me', 'self', 'null', 'undefined', 'true', 'false',
]);

export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username too long')
  .regex(/^[a-z0-9._-]+$/, 'Username may only contain lowercase letters, digits, dot, underscore, or hyphen')
  .refine((v) => !RESERVED_USERNAMES.has(v), 'This username is reserved')
  .transform((v) => v.trim().toLowerCase());

/** Identifier accepted by the login form: email, mobile, or username. */
export type IdentifierKind = 'email' | 'mobile' | 'username';

/**
 * Detect which kind of identifier the user typed. Lenient — does not validate
 * format strictly; that happens after detection by the kind-specific schema.
 */
export function detectIdentifierKind(raw: string): IdentifierKind {
  const v = raw.trim();
  if (v.includes('@')) return 'email';
  // Indian mobile shapes: +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX (digits/+/-/space only)
  if (/^[+\d][\d\s-]*$/.test(v) && v.replace(/\D/g, '').length >= 10) return 'mobile';
  return 'username';
}

/** Canonicalise a mobile string to '+91XXXXXXXXXX'; returns null if not parseable. */
export function canonicaliseMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  // strip leading 91 / 0
  if (/^91[6-9]\d{9}$/.test(digits)) return '+' + digits;
  if (/^0[6-9]\d{9}$/.test(digits)) return '+91' + digits.slice(1);
  if (/^[6-9]\d{9}$/.test(digits)) return '+91' + digits;
  return null;
}

/**
 * Login identifier schema — accepts email or mobile, normalises each into
 * its canonical form. Returns the kind alongside so the auth service can do
 * the right lookup without re-detecting. Username login is intentionally
 * NOT accepted: usernames are auto-generated from the email local-part at
 * invitation accept and never surfaced in the invite email, so a user has
 * no way to know their username before first login. The User.username
 * column stays (display-only on the profile page).
 */
export const loginIdentifierSchema = z
  .string()
  .min(1, 'Email or mobile number is required')
  .max(254)
  .transform((raw, ctx) => {
    const kind = detectIdentifierKind(raw);
    if (kind === 'email') {
      const r = emailSchema.safeParse(raw);
      if (!r.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid email address' });
        return z.NEVER;
      }
      return { kind: 'email' as const, value: r.data };
    }
    if (kind === 'mobile') {
      const m = canonicaliseMobile(raw);
      if (!m) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Indian mobile number' });
        return z.NEVER;
      }
      return { kind: 'mobile' as const, value: m };
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Enter a valid email address or Indian mobile number',
    });
    return z.NEVER;
  });
