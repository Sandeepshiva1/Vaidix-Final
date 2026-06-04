// ════════════════════════════════════════════════════════════════════════════
// Authentication + Invitation validation schemas
// ════════════════════════════════════════════════════════════════════════════
// Shared between frontend (react-hook-form + zodResolver) and backend
// (API route body parsing). Format validation only — business rules live in
// src/server/services/ and are never imported by client code.

import { z } from 'zod';
import {
  emailSchema,
  passwordSchema,
  fullNameSchema,
  mobileSchema,
  mciRegSchema,
  tokenSchema,
  cuidSchema,
  loginIdentifierSchema,
} from './primitives';
import { MODULE_KEYS } from '../modules';

// ─── Login ──────────────────────────────────────────────────────────────────
// `identifier` is the canonical field. `email` is kept as a back-compat alias
// so existing callers (older test scripts, NextAuth credentials shape, third-
// party integrations) keep working unchanged. The schema accepts EITHER one
// — never both — and folds the value into `identifier` after parsing.
export const loginSchema = z
  .object({
    identifier: z.string().min(1, 'Email or mobile number is required').max(254).optional(),
    email: z.string().min(1).max(254).optional(),
    password: z.string().min(1, 'Password is required').max(128),
    rememberMe: z.boolean().optional().default(false),
  })
  .transform((v, ctx) => {
    const raw = (v.identifier ?? v.email ?? '').trim();
    if (!raw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: 'Email or mobile number is required',
      });
      return z.NEVER;
    }
    const parsed = loginIdentifierSchema.safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: parsed.error.issues[0]?.message ?? 'Invalid identifier',
      });
      return z.NEVER;
    }
    return {
      identifier: parsed.data.value,
      identifierKind: parsed.data.kind,
      password: v.password,
      rememberMe: v.rememberMe ?? false,
    };
  });
export type LoginInput = z.infer<typeof loginSchema>;

// ─── Forgot Password ────────────────────────────────────────────────────────
// Accepts the same identifier shape as login. The reset link is always
// emailed to the user's bound email regardless of which identifier they
// used to initiate the request (no SMS provider in Phase 1).
export const forgotPasswordSchema = z
  .object({
    identifier: z.string().min(1).max(254).optional(),
    email: z.string().min(1).max(254).optional(),
  })
  .transform((v, ctx) => {
    const raw = (v.identifier ?? v.email ?? '').trim();
    if (!raw) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: 'Email or mobile number is required',
      });
      return z.NEVER;
    }
    const parsed = loginIdentifierSchema.safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: parsed.error.issues[0]?.message ?? 'Invalid identifier',
      });
      return z.NEVER;
    }
    return {
      identifier: parsed.data.value,
      identifierKind: parsed.data.kind,
    };
  });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// ─── Reset Password (from emailed token) ────────────────────────────────────
export const resetPasswordSchema = z
  .object({
    token: tokenSchema,
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ─── Change Password (authenticated user) ───────────────────────────────────
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from current',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ─── Admin: list users (search + paginate) ──────────────────────────────────
export const listUsersQuerySchema = z.object({
  role: z.enum(['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN', 'EXTERNAL_LEARNER']).optional(),
  status: z.enum(['PENDING_INVITE', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type ListUsersQueryInput = z.infer<typeof listUsersQuerySchema>;

// ─── Create Invitation (admin) ──────────────────────────────────────────────
const moduleOverridesSchema = z
  .object({
    granted: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).default([]),
    revoked: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).default([]),
  })
  .default({ granted: [], revoked: [] });

export const createInvitationSchema = z
  .object({
    email: emailSchema,
    fullName: fullNameSchema,
    mobile: mobileSchema.optional().or(z.literal('').transform(() => undefined)),
    mciRegNumber: mciRegSchema.optional().or(z.literal('').transform(() => undefined)),
    role: z.enum(['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN', 'EXTERNAL_LEARNER']),
    subspecialty: z.string().min(2).max(80).optional(),
    department: z.string().min(2).max(80).optional(),
    yearOfResidency: z.number().int().min(1).max(5).optional(),
    // Optional hierarchy mapping. Service enforces role-vs-target compatibility:
    //   programDirectorId requires role=FACULTY and ref.role=PROGRAM_DIRECTOR.
    //   facultyMentorId   requires role=RESIDENT and ref.role=FACULTY.
    //   cohortId          requires role=RESIDENT.
    // All ignored (cleared) for any other role to keep payloads honest.
    programDirectorId: cuidSchema.optional().nullable(),
    facultyMentorId:   cuidSchema.optional().nullable(),
    cohortId:          cuidSchema.optional().nullable(),
    avatarUrl:         z.string().url().max(2048).optional().nullable(),
    gender:            z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
    moduleOverrides: moduleOverridesSchema,
    expiresInHours: z.number().int().min(1).max(168).default(48),
  })
  .refine(
    (d) => d.role !== 'RESIDENT' || d.yearOfResidency !== undefined,
    { path: ['yearOfResidency'], message: 'Year of residency required for residents' }
  );
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

// ─── Bulk Create Invitations (admin Excel upload) ──────────────────────────
// Wraps createInvitationSchema in an array. Per-row validation is identical
// to the single-invite endpoint — the bulk route reuses the createInvitation
// service for each row and reports per-row results (commit-successes shape).
// Cap of 500 rows/batch keeps email + audit fan-out predictable; combined
// with BULK_INVITATION_CREATE rate limit (5 batches/hour) → 2.5k invites/hr.
export const bulkCreateInvitationsSchema = z.object({
  rows: z.array(createInvitationSchema).min(1, 'At least one row required').max(500, 'Maximum 500 rows per batch'),
});
export type BulkCreateInvitationsInput = z.infer<typeof bulkCreateInvitationsSchema>;

// ─── Update Invitation (admin) ──────────────────────────────────────────────
// Mutates an existing PENDING invitation. Email is NOT editable (it's the
// stable identity used for token resolution and acceptance dedupe). To "fix"
// a typo'd email, revoke + re-invite. All other fields can be changed.
export const updateInvitationSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    mobile: mobileSchema.optional().or(z.literal('').transform(() => undefined)).nullable(),
    mciRegNumber: mciRegSchema.optional().or(z.literal('').transform(() => undefined)).nullable(),
    role: z.enum(['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN', 'EXTERNAL_LEARNER']).optional(),
    subspecialty: z.string().min(2).max(80).optional().nullable(),
    department: z.string().min(2).max(80).optional().nullable(),
    yearOfResidency: z.number().int().min(1).max(5).optional().nullable(),
    programDirectorId: cuidSchema.optional().nullable(),
    facultyMentorId:   cuidSchema.optional().nullable(),
    cohortId:          cuidSchema.optional().nullable(),
    avatarUrl:         z.string().url().max(2048).optional().nullable(),
    gender:            z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
    moduleOverrides: moduleOverridesSchema.optional(),
    expiresInHours: z.number().int().min(1).max(168).optional(),
  })
  .refine(
    (d) => d.role !== 'RESIDENT' || d.yearOfResidency !== undefined,
    { path: ['yearOfResidency'], message: 'Year of residency required for residents' }
  );
export type UpdateInvitationInput = z.infer<typeof updateInvitationSchema>;

// ─── Accept Invitation (public endpoint) ────────────────────────────────────
export const acceptInvitationSchema = z
  .object({
    token: tokenSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      message: 'You must accept the terms to continue',
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

// ─── Invitation Query (admin list) ──────────────────────────────────────────
export const listInvitationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']).optional(),
  role: z.enum(['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN', 'EXTERNAL_LEARNER']).optional(),
  invitedById: cuidSchema.optional(),
  search: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: cuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;

// ─── Revoke / Delete Invitation ─────────────────────────────────────────────
export const revokeInvitationSchema = z.object({
  reason: z.string().max(500).optional(),
  notifyUser: z.boolean().optional().default(false),
});

export const deleteInvitationSchema = z.object({
  confirm: z.literal(true, {
    message: 'Confirmation required for permanent deletion',
  }),
  reason: z.string().max(500).optional(),
});

// ─── User Module Permissions Update (admin) ─────────────────────────────────
export const updateUserModulesSchema = z.object({
  grants: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).default([]),
  revokes: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).default([]),
  reason: z.string().max(500).optional(),
});
export type UpdateUserModulesInput = z.infer<typeof updateUserModulesSchema>;

// ─── Admin: Update User Role / Status ───────────────────────────────────────
// `reason` is optional to match the modal UI label ("Reason (optional, recorded
// in audit log)"). When present it still must be 3-500 chars; absence is fine
// — the audit row records null and the change still goes through.
export const updateUserRoleSchema = z.object({
  role: z.enum(['RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN', 'EXTERNAL_LEARNER']),
  reason: z.string().min(3).max(500).optional(),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  reason: z.string().min(3).max(500).optional(),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
