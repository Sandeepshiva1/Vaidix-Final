'use client';

// ════════════════════════════════════════════════════════════════════════════
// Admin · Bulk Invitations (Phase 1)
// ════════════════════════════════════════════════════════════════════════════
// Phase 1 scope:
//   - Download an .xlsx template with one sheet per role + an Instructions sheet
//   - Admin fills it in (typing emails for PD/mentor, name for cohort)
//   - Upload → client-side parse + per-row validation → preview table
//   - Submit valid rows to POST /api/admin/invitations/bulk
//   - Show results table with successes + per-row errors
//
// Why client-side resolution: the bulk endpoint reuses createInvitation()'s
// existing contract (expects ids, not emails). Resolving here keeps the
// server thin and lets us show "PD email not found" errors in the preview
// before any server round-trip.
//
// Phase 2 will add: data-validation dropdowns embedded in the template
// (live-snapshot lookup of PD/Faculty/Cohort), better error export, and
// chunked submission for very large batches.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileSpreadsheet,
  Send,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { Role } from '@prisma/client';
import { createInvitationSchema, type CreateInvitationInput } from '@/lib/validation/auth';
import { canonicaliseMobile } from '@/lib/validation/primitives';

// ─── Types ──────────────────────────────────────────────────────────────────

type SheetKey = 'Residents' | 'Faculty' | 'Program Directors' | 'Admins' | 'External Learners';

const SHEET_TO_ROLE: Record<SheetKey, Role> = {
  Residents: Role.RESIDENT,
  Faculty: Role.FACULTY,
  'Program Directors': Role.PROGRAM_DIRECTOR,
  Admins: Role.ADMIN,
  'External Learners': Role.EXTERNAL_LEARNER,
};

interface ColumnSpec {
  header: string;
  required: boolean;
  example: string;
  hint?: string;
}

const COLUMNS: Record<SheetKey, ColumnSpec[]> = {
  Residents: [
    { header: 'email', required: true, example: 'arjun.k@lvpei.org' },
    { header: 'fullName', required: true, example: 'Arjun Krishnan' },
    { header: 'mobile', required: false, example: '+919876543210', hint: '+91 followed by 10 digits' },
    { header: 'mciRegNumber', required: false, example: 'TSMC-12345' },
    { header: 'subspecialty', required: false, example: 'Vitreoretinal Surgery' },
    { header: 'department', required: false, example: 'Smt. Kanuri Santhamma Centre' },
    { header: 'yearOfResidency', required: true, example: '1', hint: '1 to 5' },
    // Reference fields left BLANK in the example row on purpose — admins
    // overwrite email/name but often forget the reference columns, dragging
    // the example value into real data. Blank = no mentor assigned at invite.
    { header: 'facultyMentorEmail', required: false, example: '', hint: 'Leave blank or use an existing FACULTY email' },
    { header: 'cohortName', required: false, example: '', hint: 'Leave blank or use an existing cohort name' },
    { header: 'gender', required: false, example: 'male', hint: 'male / female / other / prefer_not_to_say' },
    { header: 'expiresInHours', required: false, example: '48', hint: '24, 48, 72, or 168 (default 48)' },
  ],
  Faculty: [
    { header: 'email', required: true, example: 'meera.s@lvpei.org' },
    { header: 'fullName', required: true, example: 'Dr. Meera Sundaram' },
    { header: 'mobile', required: false, example: '+919876543211' },
    { header: 'mciRegNumber', required: false, example: 'TSMC-67890' },
    { header: 'subspecialty', required: false, example: 'Cornea & External Diseases' },
    { header: 'department', required: false, example: 'Cornea Institute' },
    // Blank by design — see note in the Residents sheet config above.
    { header: 'programDirectorEmail', required: false, example: '', hint: 'Leave blank or use an existing PROGRAM_DIRECTOR email' },
    { header: 'gender', required: false, example: 'female' },
    { header: 'expiresInHours', required: false, example: '48' },
  ],
  'Program Directors': [
    { header: 'email', required: true, example: 'rajeev.r@lvpei.org' },
    { header: 'fullName', required: true, example: 'Dr. Rajeev Reddy' },
    { header: 'mobile', required: false, example: '+919876543212' },
    { header: 'mciRegNumber', required: false, example: 'TSMC-00001' },
    { header: 'subspecialty', required: false, example: 'Glaucoma' },
    { header: 'department', required: false, example: 'Glaucoma Service' },
    { header: 'gender', required: false, example: 'male' },
    { header: 'expiresInHours', required: false, example: '48' },
  ],
  Admins: [
    { header: 'email', required: true, example: 'admin@lvpei.org' },
    { header: 'fullName', required: true, example: 'Platform Admin' },
    { header: 'mobile', required: false, example: '+919876543213' },
    { header: 'gender', required: false, example: 'prefer_not_to_say' },
    { header: 'expiresInHours', required: false, example: '48' },
  ],
  'External Learners': [
    { header: 'email', required: true, example: 'guest@external.org' },
    { header: 'fullName', required: true, example: 'Dr. External Guest' },
    { header: 'mobile', required: false, example: '+919876543214' },
    { header: 'subspecialty', required: false, example: 'Pediatric Ophthalmology' },
    { header: 'department', required: false, example: 'Visiting from AIIMS' },
    { header: 'gender', required: false, example: 'female' },
    { header: 'expiresInHours', required: false, example: '48' },
  ],
};

const SHEET_ORDER: SheetKey[] = ['Residents', 'Faculty', 'Program Directors', 'Admins', 'External Learners'];

interface LookupUser { id: string; email: string; name: string; role: Role }
interface Cohort { id: string; name: string; academicYear: string | null }

interface ParsedRow {
  rowNumber: number;
  sheet: SheetKey;
  role: Role;
  raw: Record<string, string>;
  resolved: CreateInvitationInput | null;
  /** Hard errors — row will NOT be submitted. */
  errors: string[];
  /** Soft warnings — row WILL be submitted; the unresolved ref is dropped. */
  warnings: string[];
  expiresInHours: number;
}

interface ResultRow {
  row: number;
  email: string;
  status: 'ok' | 'error';
  invitationId?: string;
  // Populated client-side after submit so the Detail column shows human text
  // ("Sent as Faculty, expires in 48h") instead of the raw CUID.
  role?: Role;
  expiresInHours?: number;
  warnings?: string[];
  error?: { code: string; message: string };
}

type Stage = 'idle' | 'previewing' | 'submitting' | 'done';

// ─── Helpers ────────────────────────────────────────────────────────────────

function normaliseHeader(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findHeaderKey(rawHeaders: string[], target: string): string | null {
  const want = normaliseHeader(target);
  for (const h of rawHeaders) if (normaliseHeader(h) === want) return h;
  return null;
}

function pick(row: Record<string, unknown>, headerMap: Record<string, string>, target: string): string {
  const key = headerMap[target];
  if (!key) return '';
  const v = row[key];
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function humanRole(role: string): string {
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Rewrite "@unresolved-ref|field|expectedRole|email" warning sentinels into
// precise human messages. Order of preference:
//   1. In-batch detection — the referenced email is being invited in THIS
//      upload, but hasn't accepted yet (Faculty must be a User, not an
//      Invitation, before another row can link to them).
//   2. /api/invitations/check-email — distinguishes USER_EXISTS / PENDING_INVITE
//      / available for emails NOT in this batch.
async function enrichUnresolvedRefs(rows: ParsedRow[], batchInvitees: Map<string, Role>): Promise<void> {
  type Lookup = { reason: string; user?: { role: string; status: string }; invitation?: { role: string } };
  const cache = new Map<string, Lookup | null>();

  // Skip check-email for emails we already know are in-batch — saves a
  // request per duplicate, and the in-batch case has a custom message anyway.
  const emails = new Set<string>();
  for (const row of rows) {
    for (const w of row.warnings) {
      if (w.startsWith('@unresolved-ref|')) {
        const [, , , email] = w.split('|');
        if (email && !batchInvitees.has(email.toLowerCase())) {
          emails.add(email.toLowerCase());
        }
      }
    }
  }

  await Promise.all(
    Array.from(emails).map(async (email) => {
      try {
        const res = await fetch(`/api/invitations/check-email?email=${encodeURIComponent(email)}`);
        const body = await res.json();
        if (!body.ok) { cache.set(email, null); return; }
        if (body.data.available) {
          cache.set(email, { reason: 'AVAILABLE' });
        } else if (body.data.reason === 'USER_EXISTS') {
          cache.set(email, { reason: 'USER_EXISTS', user: body.data.user });
        } else if (body.data.reason === 'PENDING_INVITE') {
          cache.set(email, { reason: 'PENDING_INVITE', invitation: body.data.invitation });
        } else {
          cache.set(email, null);
        }
      } catch {
        cache.set(email, null);
      }
    }),
  );

  for (const row of rows) {
    row.warnings = row.warnings.map((w) => {
      if (!w.startsWith('@unresolved-ref|')) return w;
      const [, field, expectedRoleRaw, emailRaw] = w.split('|');
      const email = emailRaw.toLowerCase();
      const expected = humanRole(expectedRoleRaw);

      // ─── In-batch detection (preferred) ─────────────────────────────────
      const inBatchRole = batchInvitees.get(email);
      if (inBatchRole) {
        const inBatchLabel = humanRole(inBatchRole);
        if (inBatchRole === (expectedRoleRaw as Role)) {
          // Same role as expected — this is the classic two-pass case.
          return `${field}: "${email}" is being invited as ${inBatchLabel} in this same upload, but they need to accept their invitation first before they can be referenced as a ${expected}. Invite will be sent now without this link — re-link them manually after acceptance, OR run as two passes (invite + accept the ${inBatchLabel} first, then upload the rest).`;
        }
        // Different role in batch — admin probably mistyped.
        return `${field}: "${email}" is being invited as ${inBatchLabel} in this same upload, not ${expected}. Invite will be sent without the link — fix the role and re-upload if you need them linked.`;
      }

      // ─── /api/invitations/check-email fallback ──────────────────────────
      const info = cache.get(email);
      if (!info) {
        return `${field}: "${email}" is not an active ${expected}. Invite will be sent without this link.`;
      }
      if (info.reason === 'AVAILABLE') {
        return `${field}: "${email}" has no account yet — invite them as ${expected} first, then upload this batch again. Invite will be sent without the link for now.`;
      }
      if (info.reason === 'USER_EXISTS' && info.user) {
        const actualRole = humanRole(info.user.role);
        if (actualRole === expected && info.user.status !== 'ACTIVE') {
          return `${field}: "${email}" exists as ${actualRole} but status is ${info.user.status} — reactivate them, or pick someone else. Invite will be sent without the link for now.`;
        }
        return `${field}: "${email}" exists as ${actualRole}, not ${expected} — change their role or pick a different ${expected}. Invite will be sent without the link for now.`;
      }
      if (info.reason === 'PENDING_INVITE' && info.invitation) {
        const invitedAs = humanRole(info.invitation.role);
        return `${field}: "${email}" has a pending invitation as ${invitedAs} — wait for them to accept, then re-upload. Invite will be sent without the link for now.`;
      }
      return `${field}: "${email}" is not an active ${expected}. Invite will be sent without this link.`;
    });
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function BulkInviteClient() {
  const [stage, setStage] = useState<Stage>('idle');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [parsingFile, setParsingFile] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-dismiss error toasts
  useEffect(() => {
    if (!globalError) return;
    const t = setTimeout(() => setGlobalError(null), 5000);
    return () => clearTimeout(t);
  }, [globalError]);

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Instructions sheet first so it opens by default
      const instructionsRows: Array<Array<string>> = [
        ['Vaidix · Bulk Invitations Template'],
        [''],
        ['How to use this template:'],
        ['1. Open one of the role sheets below (Residents, Faculty, Program Directors, Admins, External Learners).'],
        ['2. Fill in one row per person you want to invite.'],
        ['3. Save the file and upload it on the /admin/invitations/bulk page.'],
        [''],
        ['Required columns are marked with (*) on the role sheet header rows.'],
        ['For facultyMentorEmail, programDirectorEmail, and cohortName: type the EXACT email/name as it exists in the system today. The upload preview will flag mismatches.'],
        [''],
        ['Column reference:'],
        [''],
      ];
      for (const sheet of SHEET_ORDER) {
        instructionsRows.push([`— ${sheet} —`]);
        instructionsRows.push(['column', 'required', 'example', 'notes']);
        for (const c of COLUMNS[sheet]) {
          instructionsRows.push([c.header, c.required ? 'YES' : 'optional', c.example, c.hint ?? '']);
        }
        instructionsRows.push(['']);
      }
      const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsRows);
      wsInstructions['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 32 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

      // One sheet per role with header row + a single example row
      for (const sheet of SHEET_ORDER) {
        const cols = COLUMNS[sheet];
        const header = cols.map((c) => c.required ? `${c.header}*` : c.header);
        const example = cols.map((c) => c.example);
        const ws = XLSX.utils.aoa_to_sheet([header, example]);
        ws['!cols'] = cols.map((c) => ({ wch: Math.max(c.header.length + 4, c.example.length + 2) }));
        XLSX.utils.book_append_sheet(wb, ws, sheet);
      }

      XLSX.writeFile(wb, 'vaidix-invitations-template.xlsx');
    } catch (err) {
      console.error('[bulk] template download failed', err);
      setGlobalError('Could not generate template. Please try again.');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleFileChosen(file: File) {
    setParsingFile(true);
    setGlobalError(null);
    setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      // Pull lookup data once — emails / cohort names are resolved against
      // these snapshots. /api/users/searchable returns ACTIVE users only;
      // pending-invite users won't show up here, which is correct (you
      // can't be a mentor before accepting your invitation).
      const [pdRes, facRes, cohortRes] = await Promise.all([
        fetch('/api/users/searchable?role=PROGRAM_DIRECTOR&search=&limit=200'),
        fetch('/api/users/searchable?role=FACULTY&search=&limit=200'),
        fetch('/api/cohorts'),
      ]);
      const pdBody = await pdRes.json();
      const facBody = await facRes.json();
      const cohortBody = await cohortRes.json();
      const pds: LookupUser[] = pdBody.ok ? pdBody.data.users ?? pdBody.data ?? [] : [];
      const facs: LookupUser[] = facBody.ok ? facBody.data.users ?? facBody.data ?? [] : [];
      const cohorts: Cohort[] = cohortBody.ok ? (cohortBody.data?.cohorts ?? cohortBody.data ?? []) : [];

      const pdByEmail = new Map(pds.map((u) => [u.email.toLowerCase(), u.id]));
      const facByEmail = new Map(facs.map((u) => [u.email.toLowerCase(), u.id]));
      const cohortByName = new Map(cohorts.map((c) => [c.name.trim().toLowerCase(), c.id]));

      const rows: ParsedRow[] = [];
      let rowCounter = 0;

      for (const sheetName of wb.SheetNames) {
        if (!(sheetName in SHEET_TO_ROLE)) continue;
        const sheet = sheetName as SheetKey;
        const role = SHEET_TO_ROLE[sheet];
        const ws = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        if (json.length === 0) continue;

        const rawHeaders = Object.keys(json[0] ?? {});
        // Build header map: target column → actual key used in the row object.
        const headerMap: Record<string, string> = {};
        for (const c of COLUMNS[sheet]) {
          // Allow both "email" and "email*" (the asterisk denotes "required" in
          // the template header row but Excel may keep the asterisk in the key).
          const key =
            findHeaderKey(rawHeaders, c.header) ??
            findHeaderKey(rawHeaders, `${c.header}*`);
          if (key) headerMap[c.header] = key;
        }

        for (const r of json) {
          const email = pick(r, headerMap, 'email').toLowerCase();
          const fullName = pick(r, headerMap, 'fullName');
          // Skip empty/example-cleared rows so the admin doesn't see ghost
          // entries from a partially-cleared template.
          if (!email && !fullName) continue;

          rowCounter += 1;
          const errors: string[] = [];
          // Soft issues — typically optional refs that didn't resolve.
          // The row still submits; the unresolved value is dropped.
          const warnings: string[] = [];

          const mobile = pick(r, headerMap, 'mobile');
          const mciRegNumber = pick(r, headerMap, 'mciRegNumber');
          const subspecialty = pick(r, headerMap, 'subspecialty');
          const department = pick(r, headerMap, 'department');
          const yearStr = pick(r, headerMap, 'yearOfResidency');
          const genderRaw = pick(r, headerMap, 'gender').toLowerCase();
          const expiresStr = pick(r, headerMap, 'expiresInHours');

          // Hierarchy resolution: sheet → role decides which lookup applies.
          // Optional refs that don't resolve are WARNINGS, not errors — the
          // invite still goes out, just without the mapping. We tag the
          // warning with a sentinel marker so the post-parse enrichment step
          // can rewrite it via /api/invitations/check-email with a precise,
          // actionable reason (no account / wrong role / pending invite).
          let programDirectorId: string | null = null;
          let facultyMentorId: string | null = null;
          let cohortId: string | null = null;

          if (role === Role.FACULTY) {
            const pdEmail = pick(r, headerMap, 'programDirectorEmail').toLowerCase();
            if (pdEmail) {
              const id = pdByEmail.get(pdEmail);
              if (!id) warnings.push(`@unresolved-ref|programDirectorEmail|PROGRAM_DIRECTOR|${pdEmail}`);
              else programDirectorId = id;
            }
          }
          if (role === Role.RESIDENT) {
            const mentorEmail = pick(r, headerMap, 'facultyMentorEmail').toLowerCase();
            if (mentorEmail) {
              const id = facByEmail.get(mentorEmail);
              if (!id) warnings.push(`@unresolved-ref|facultyMentorEmail|FACULTY|${mentorEmail}`);
              else facultyMentorId = id;
            }
            const cohortName = pick(r, headerMap, 'cohortName').trim().toLowerCase();
            if (cohortName) {
              const id = cohortByName.get(cohortName);
              if (!id) {
                warnings.push(`cohortName: "${cohortName}" doesn't match any existing cohort — invite will be sent without cohort assignment. Create the cohort first if you need them linked.`);
              } else {
                cohortId = id;
              }
            }
          }

          const yearOfResidency = yearStr ? parseInt(yearStr, 10) : undefined;
          if (role === Role.RESIDENT) {
            if (!yearOfResidency || Number.isNaN(yearOfResidency)) {
              // Hint at the most common cause: the user typed Faculty / PD
              // data into the Residents sheet by mistake. Cheaper than a
              // full content-based heuristic and surfaces the right fix.
              errors.push(
                'yearOfResidency is required on the Residents sheet (1–5). If this person isn’t a student, move the row to the Faculty / Program Directors / Admins / External Learners sheet instead.',
              );
            }
          }

          const expiresInHours = expiresStr ? parseInt(expiresStr, 10) : 48;
          const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
          const gender = genderRaw && validGenders.includes(genderRaw) ? genderRaw : undefined;
          if (genderRaw && !gender) errors.push(`gender "${genderRaw}" — must be male / female / other / prefer_not_to_say`);

          const candidate = {
            email,
            fullName,
            mobile: mobile || undefined,
            mciRegNumber: mciRegNumber || undefined,
            role,
            subspecialty: subspecialty || undefined,
            department: department || undefined,
            yearOfResidency: role === Role.RESIDENT ? yearOfResidency : undefined,
            programDirectorId,
            facultyMentorId,
            cohortId,
            gender,
            expiresInHours: Number.isNaN(expiresInHours) ? 48 : expiresInHours,
            moduleOverrides: { granted: [] as string[], revoked: [] as string[] },
          };

          const parsed = createInvitationSchema.safeParse(candidate);
          let resolved: CreateInvitationInput | null = null;
          if (parsed.success) {
            resolved = parsed.data;
          } else {
            for (const issue of parsed.error.issues) {
              const path = issue.path.join('.') || '(row)';
              errors.push(`${path}: ${issue.message}`);
            }
          }

          rows.push({
            rowNumber: rowCounter,
            sheet,
            role,
            raw: {
              email,
              fullName,
              mobile,
              mciRegNumber,
              subspecialty,
              department,
              yearOfResidency: yearStr,
              gender: genderRaw,
            },
            // Warnings don't block submission — only hard errors do.
            resolved: errors.length === 0 ? resolved : null,
            errors,
            warnings,
            expiresInHours: Number.isNaN(expiresInHours) ? 48 : expiresInHours,
          });
        }
      }

      // ── In-batch mobile duplicate detection ─────────────────────────────
      // Mobile is a unique login identifier (multi-identifier login). Two rows
      // sharing a mobile would cause one to silently lose it at accept-time
      // (the server now also throws MOBILE_INVITE_EXISTS, but catching this
      // in the preview gives the admin a chance to fix before submitting).
      const mobileRowMap = new Map<string, number[]>();
      for (const row of rows) {
        const rawMobile = row.raw.mobile;
        if (!rawMobile) continue;
        const canonical = canonicaliseMobile(rawMobile);
        if (!canonical) continue;
        const existing = mobileRowMap.get(canonical) ?? [];
        existing.push(row.rowNumber);
        mobileRowMap.set(canonical, existing);
      }
      for (const [canonical, rowNums] of mobileRowMap) {
        if (rowNums.length <= 1) continue;
        for (const row of rows) {
          if (!row.raw.mobile || canonicaliseMobile(row.raw.mobile) !== canonical) continue;
          const others = rowNums.filter((n) => n !== row.rowNumber);
          row.warnings.push(
            `mobile: ${canonical} also appears in row${others.length === 1 ? '' : 's'} ${others.join(', ')} — mobile numbers must be unique. Only one person can hold this number; remove the duplicate before submitting.`,
          );
        }
      }

      // Build a map of emails being invited in THIS upload → their role.
      // The enrichment step prefers this over /api/invitations/check-email
      // so a Resident referencing a Faculty in the same batch sees a
      // specialised "two-pass workflow" message rather than the generic
      // "no account yet — invite as Faculty first" (they ARE in this very
      // batch — the issue is invite-vs-accept ordering, not missing data).
      const batchInvitees = new Map<string, Role>();
      for (const r of rows) {
        if (r.raw.email) batchInvitees.set(r.raw.email.toLowerCase(), r.role);
      }
      // Enrich unresolved-reference warnings with precise reasons. One
      // /api/invitations/check-email call per unique email — dedupe across
      // rows, fan out in parallel. Worst-case latency = one round-trip;
      // typical batch has 0-10 unresolved refs so this is cheap.
      await enrichUnresolvedRefs(rows, batchInvitees);

      if (rows.length === 0) {
        setGlobalError('No rows found. Make sure you filled in at least one role sheet.');
        setStage('idle');
        return;
      }

      setParsedRows(rows);
      setStage('previewing');
    } catch (err) {
      console.error('[bulk] parse failed', err);
      setGlobalError('Could not parse the file. Please use the downloaded template.');
      setStage('idle');
    } finally {
      setParsingFile(false);
    }
  }

  function resetAll() {
    setStage('idle');
    setParsedRows([]);
    setResults([]);
    setFileName(null);
    setGlobalError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit() {
    // Rows with warnings still submit — only hard errors block.
    const submittable = parsedRows.filter((r) => r.resolved !== null);
    if (submittable.length === 0) {
      setGlobalError('No rows ready to submit. Fix the errors above first.');
      return;
    }
    setStage('submitting');
    setGlobalError(null);
    try {
      const res = await fetch('/api/admin/invitations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: submittable.map((r) => r.resolved) }),
      });
      const body = await res.json();
      if (!body.ok) {
        setGlobalError(body.error?.message ?? 'Bulk invite failed');
        setStage('previewing');
        return;
      }
      // Augment server results with client-side metadata (role, expiry,
      // warnings) so the Detail column can show human text instead of the
      // raw CUID. Server-side row ordering matches submittable[i] one-to-one.
      const serverResults = (body.data.results ?? []) as ResultRow[];
      const augmented: ResultRow[] = serverResults.map((r, i) => {
        const src = submittable[i];
        return {
          ...r,
          role: src?.role,
          expiresInHours: src?.expiresInHours,
          warnings: src?.warnings,
        };
      });
      setResults(augmented);
      setStage('done');
    } catch (err) {
      console.error('[bulk] submit failed', err);
      setGlobalError('Network error during submit');
      setStage('previewing');
    }
  }

  const counts = useMemo(() => {
    let ready = 0;
    let warned = 0;
    let errs = 0;
    for (const r of parsedRows) {
      if (r.errors.length > 0) errs += 1;
      else if (r.warnings.length > 0) warned += 1;
      else ready += 1;
    }
    return { total: parsedRows.length, ready, warned, errs };
  }, [parsedRows]);

  const resultCounts = useMemo(() => {
    const ok = results.filter((r) => r.status === 'ok').length;
    return { total: results.length, ok, error: results.length - ok };
  }, [results]);

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/invitations"
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to invitations
          </Link>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Admin · Invitations · Bulk upload
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
            Bulk invite from Excel
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Download the template, fill one row per person, upload to send invitation emails.
          </p>
        </div>
      </header>

      <AnimatePresence>
        {globalError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="bulk-global-error"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>{globalError}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {stage === 'idle' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Step 1 · Download template" icon={Download}>
            <p className="text-sm text-slate-500">
              An Excel workbook with a sheet per role and an Instructions tab. Required columns are marked with an asterisk.
            </p>
            <button
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate}
              data-testid="download-template-btn"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
            >
              {downloadingTemplate ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {downloadingTemplate ? 'Generating…' : 'Download template (.xlsx)'}
            </button>
          </Card>

          <Card title="Step 2 · Upload filled file" icon={Upload}>
            <p className="text-sm text-slate-500">
              We&apos;ll validate every row and show you a preview before any invitations are sent.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              data-testid="bulk-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileChosen(f);
              }}
              className="mt-4 block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
            />
            {parsingFile && (
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="size-3 animate-spin" /> Parsing {fileName}…
              </div>
            )}
          </Card>
        </div>
      )}

      {stage === 'previewing' && (
        <PreviewView
          rows={parsedRows}
          counts={counts}
          fileName={fileName}
          submitting={false}
          onSubmit={handleSubmit}
          onReset={resetAll}
        />
      )}

      {stage === 'submitting' && (
        <PreviewView
          rows={parsedRows}
          counts={counts}
          fileName={fileName}
          submitting
          onSubmit={handleSubmit}
          onReset={resetAll}
        />
      )}

      {stage === 'done' && (
        <ResultsView results={results} counts={resultCounts} onReset={resetAll} />
      )}
    </div>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: typeof Download; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-slate-700" />
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function PreviewView({
  rows, counts, fileName, submitting, onSubmit, onReset,
}: {
  rows: ParsedRow[];
  counts: { total: number; ready: number; warned: number; errs: number };
  fileName: string | null;
  submitting: boolean;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const submittable = counts.ready + counts.warned;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="size-6 text-slate-700" />
          <div>
            <div className="text-sm font-bold text-slate-900">{fileName ?? 'Uploaded file'}</div>
            <div className="text-xs text-slate-500">{counts.total} total rows</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SummaryPill label="Ready" value={counts.ready} tint="green" />
          {counts.warned > 0 && <SummaryPill label="Warnings" value={counts.warned} tint="amber" />}
          <SummaryPill label="Errors" value={counts.errs} tint={counts.errs > 0 ? 'red' : 'slate'} />
          <button
            onClick={onReset}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            data-testid="bulk-reset-btn"
          >
            <RotateCcw className="size-3.5" /> Start over
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || submittable === 0}
            data-testid="bulk-submit-btn"
            className="inline-flex items-center gap-2 rounded-xl bg-linear-to-br from-teal-600 to-blue-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-teal-500/20 transition hover:shadow-xl disabled:opacity-60"
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {submitting ? 'Sending…' : `Send ${submittable} invitation${submittable === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="bulk-preview-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Sheet</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Issues</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                // Three states: error (red, blocks), warning (amber, will-
                // submit-anyway), ready (green). Errors take precedence in
                // the status pill even if warnings also exist.
                const hasErrors = r.errors.length > 0;
                const hasWarnings = r.warnings.length > 0;
                return (
                  <tr key={r.rowNumber} className="border-b border-slate-100">
                    <td className="px-4 py-2 text-slate-500">{r.rowNumber}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {r.sheet}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{r.raw.email || '—'}</td>
                    <td className="px-4 py-2 text-slate-700">{r.raw.fullName || '—'}</td>
                    <td className="px-4 py-2">
                      {hasErrors ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                          <XCircle className="size-3.5" /> {r.errors.length} error{r.errors.length === 1 ? '' : 's'}
                        </span>
                      ) : hasWarnings ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <AlertCircle className="size-3.5" /> Will send with {r.warnings.length} note{r.warnings.length === 1 ? '' : 's'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                          <CheckCircle2 className="size-3.5" /> Ready
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {hasErrors || hasWarnings ? (
                        <ul className="space-y-0.5 text-xs">
                          {r.errors.map((e, i) => <li key={`e${i}`} className="text-red-700">· {e}</li>)}
                          {r.warnings.map((w, i) => <li key={`w${i}`} className="text-amber-700">· {w}</li>)}
                        </ul>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ResultsView({
  results, counts, onReset,
}: {
  results: ResultRow[];
  counts: { total: number; ok: number; error: number };
  onReset: () => void;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-6 text-green-600" />
          <div>
            <div className="text-sm font-bold text-slate-900">Bulk invitation complete</div>
            <div className="text-xs text-slate-500">{counts.total} rows processed</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SummaryPill label="Sent" value={counts.ok} tint="green" />
          <SummaryPill label="Failed" value={counts.error} tint={counts.error > 0 ? 'red' : 'slate'} />
          <button
            onClick={onReset}
            data-testid="bulk-done-reset"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RotateCcw className="size-3.5" /> Upload another
          </button>
          <Link
            href="/admin/invitations"
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            View all invitations →
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="bulk-results-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const hadWarnings = (r.warnings?.length ?? 0) > 0;
                const roleLabel = r.role ? humanRole(r.role) : 'user';
                return (
                  <tr key={`${r.row}-${r.email}`} className="border-b border-slate-100">
                    <td className="px-4 py-2 text-slate-500">{r.row}</td>
                    <td className="px-4 py-2 text-slate-700">{r.email}</td>
                    <td className="px-4 py-2">
                      {r.status === 'ok' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
                          <CheckCircle2 className="size-3.5" /> Sent
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                          <XCircle className="size-3.5" /> Failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {r.status === 'ok' ? (
                        <div className="space-y-0.5">
                          <div className="text-slate-600">
                            Invited as <span className="font-semibold text-slate-800">{roleLabel}</span>
                            {r.expiresInHours ? <> · link expires in {r.expiresInHours}h</> : null}
                          </div>
                          {hadWarnings && (
                            <ul className="text-amber-700">
                              {r.warnings!.map((w, i) => <li key={i}>· {w}</li>)}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <span className="text-red-700">{r.error?.message ?? '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryPill({ label, value, tint }: { label: string; value: number; tint: 'green' | 'red' | 'amber' | 'slate' }) {
  const tints = {
    green: 'border-green-200 bg-green-50 text-green-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-bold ${tints[tint]}`}>
      <span>{label}</span>
      <span className="rounded-md bg-white/60 px-1.5 py-0.5 text-[11px]">{value}</span>
    </span>
  );
}
