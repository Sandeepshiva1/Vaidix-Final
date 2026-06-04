'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  ShieldCheck,
  LayoutGrid,
  Mail,
  Phone,
  IdCard,
  Send,
  CheckCircle2,
  Clock,
  Stethoscope,
  BookOpen,
  Users,
  Settings,
  GraduationCap,
  Sparkles,
  Loader2,
  AlertCircle,
  UserMinus,
  Network,
  Camera,
  Trash2,
  Users2,
} from 'lucide-react';
import { useRef } from 'react';
import { Role } from '@prisma/client';
import { MODULES, CATEGORY_LABELS, defaultModulesForRole, type ModuleDef, type ModuleCategory } from '@/lib/modules';
import { createInvitationSchema, updateInvitationSchema } from '@/lib/validation/auth';
import { UserPicker, type PickableUser } from '@/components/user-picker';

export interface InviteModalEditData {
  id: string;
  fullName: string | null;
  email: string;
  mobile: string | null;
  mciRegNumber: string | null;
  role: Role;
  subspecialty: string | null;
  department: string | null;
  yearOfResidency: number | null;
  moduleOverrides: { granted?: string[]; revoked?: string[] } | null;
  expiresAt: string;
  programDirectorId: string | null;
  programDirector: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  cohortId: string | null;
  cohort: { id: string; name: string; academicYear: string | null } | null;
  facultyMentorId: string | null;
  facultyMentor: { id: string; name: string; email: string; avatarUrl: string | null } | null;
  avatarUrl: string | null;
  gender: string | null;
}

type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

interface CohortLite {
  id: string;
  name: string;
  academicYear: string | null;
}

type Step = 1 | 2 | 3;

const ROLE_OPTIONS: Array<{
  value: Role;
  label: string;
  description: string;
  icon: typeof UserCircle;
}> = [
  { value: Role.RESIDENT,         label: 'Student',          description: 'Ophthalmology student in training',  icon: GraduationCap },
  { value: Role.FACULTY,          label: 'Teacher',          description: 'Consultant / teaching staff',        icon: Stethoscope },
  { value: Role.PROGRAM_DIRECTOR, label: 'HOD',              description: 'Head of Department / program lead',  icon: BookOpen },
  { value: Role.ADMIN,            label: 'Admin',            description: 'Platform administrator',             icon: Settings },
  { value: Role.EXTERNAL_LEARNER, label: 'External Learner', description: 'Non-LVPEI invited learner',          icon: Users },
];

const STEP_META = [
  { label: 'Basic details', sub: 'Name, email & contacts', icon: UserCircle },
  { label: 'Role & scope',  sub: 'Permissions & expiry',   icon: ShieldCheck },
  { label: 'Module access', sub: 'Feature toggles',        icon: LayoutGrid },
];

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

function defaultModuleMap(role: Role): Record<string, boolean> {
  const defaults = defaultModulesForRole(role);
  const map: Record<string, boolean> = {};
  for (const m of MODULES) map[m.key] = defaults.includes(m.key);
  return map;
}

function emptyModuleMap(): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const m of MODULES) map[m.key] = false;
  return map;
}

function deriveModuleMapFromEdit(edit: InviteModalEditData): Record<string, boolean> {
  const base = defaultModuleMap(edit.role);
  const granted = edit.moduleOverrides?.granted ?? [];
  const revoked = edit.moduleOverrides?.revoked ?? [];
  for (const k of granted) base[k] = true;
  for (const k of revoked) base[k] = false;
  return base;
}

function hoursUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  const hrs = Math.max(1, Math.round(ms / 3_600_000));
  return [24, 48, 72, 168].includes(hrs) ? hrs : 48;
}

function InviteModalBody({ onClose, onCreated, edit }: {
  onClose: () => void;
  onCreated: () => void;
  edit?: InviteModalEditData;
}) {
  const isEdit = !!edit;
  const [step, setStep] = useState<Step>(1);

  const [fullName,      setFullName]      = useState(edit?.fullName ?? '');
  const [email,         setEmail]         = useState(edit?.email ?? '');
  const [mobile,        setMobile]        = useState(edit?.mobile ?? '');
  const [mciRegNumber,  setMciRegNumber]  = useState(edit?.mciRegNumber ?? '');
  const [gender,        setGender]        = useState<Gender | ''>((edit?.gender as Gender | null) ?? '');
  const [avatarUrl,     setAvatarUrl]     = useState<string | null>(edit?.avatarUrl ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [role,           setRoleState]      = useState<Role | null>(edit?.role ?? null);
  const [subspecialty,   setSubspecialty]   = useState(edit?.subspecialty ?? '');
  const [department,     setDepartment]     = useState(edit?.department ?? '');
  const [yearOfResidency, setYearOfResidency] = useState<number | ''>(edit?.yearOfResidency ?? 1);
  const [expiresInHours, setExpiresInHours]  = useState(edit ? hoursUntil(edit.expiresAt) : 48);

  // Hierarchy mapping pickers (Step 2). Server enforces role-vs-mapping
  // compatibility, so the UI only needs to show the right picker per role.
  const [pdPick, setPdPick] = useState<PickableUser[]>(
    edit?.programDirector
      ? [{
          id: edit.programDirector.id,
          name: edit.programDirector.name,
          email: edit.programDirector.email,
          role: Role.PROGRAM_DIRECTOR,
          avatarUrl: edit.programDirector.avatarUrl,
        }]
      : []
  );
  const [mentorPick, setMentorPick] = useState<PickableUser[]>(
    edit?.facultyMentor
      ? [{
          id: edit.facultyMentor.id,
          name: edit.facultyMentor.name,
          email: edit.facultyMentor.email,
          role: Role.FACULTY,
          avatarUrl: edit.facultyMentor.avatarUrl,
        }]
      : []
  );
  const [cohortId, setCohortId] = useState<string | null>(edit?.cohortId ?? null);
  const [cohorts, setCohorts] = useState<CohortLite[]>([]);
  const [cohortsLoaded, setCohortsLoaded] = useState(false);

  const [moduleMap, setModuleMap] = useState<Record<string, boolean>>(
    () => (edit ? deriveModuleMapFromEdit(edit) : emptyModuleMap())
  );

  const [submitting,   setSubmitting]   = useState(false);
  const [fieldErrors,  setFieldErrors]  = useState<Record<string, string>>({});
  const [formError,    setFormError]    = useState<string | null>(null);

  // ─── Live email-availability check (create mode only) ──────────────────
  // Hits /api/invitations/check-email after the user pauses typing. Blocks
  // the "Continue" button if the email is already a registered user OR a
  // pending invitation, so the admin doesn't fill 3 steps before finding out.
  type EmailCheck =
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'available' }
    | { state: 'taken'; reason: 'USER_EXISTS' | 'PENDING_INVITE'; message: string };

  const [emailCheck, setEmailCheck] = useState<EmailCheck>({ state: 'idle' });

  useEffect(() => {
    if (isEdit) return;
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailCheck({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setEmailCheck({ state: 'checking' });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/invitations/check-email?email=${encodeURIComponent(trimmed)}`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) { setEmailCheck({ state: 'idle' }); return; }
        if (body.data.available) {
          setEmailCheck({ state: 'available' });
        } else if (body.data.reason === 'USER_EXISTS') {
          setEmailCheck({
            state: 'taken',
            reason: 'USER_EXISTS',
            message: `${body.data.user?.name ?? 'A user'} already has an account with this email`,
          });
        } else {
          const inv = body.data.invitation;
          const who = inv?.fullName ?? 'Someone';
          setEmailCheck({
            state: 'taken',
            reason: 'PENDING_INVITE',
            message: `${who} already has a pending invitation. Revoke it first to re-invite.`,
          });
        }
      } catch {
        if (!cancelled) setEmailCheck({ state: 'idle' });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [email, isEdit]);

  function setRole(next: Role) {
    setRoleState(next);
    setModuleMap(defaultModuleMap(next));
    // Drop mappings that no longer apply to the new role; the server would
    // strip them anyway but clearing here keeps the picker UI honest.
    if (next !== Role.FACULTY) setPdPick([]);
    if (next !== Role.RESIDENT) {
      setCohortId(null);
      setMentorPick([]);
    }
  }

  // Avatar upload via the generic /api/admin/avatar presign route. We commit
  // the URL to the Invitation row only when "Send invitation" is clicked, so
  // the admin can still cancel without leaving a half-applied photo.
  async function handleAvatarFile(file: File) {
    setFormError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError('Image must be 5 MB or smaller.');
      return;
    }
    setAvatarUploading(true);
    try {
      const presignRes = await fetch('/api/admin/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
      });
      const presignBody = await presignRes.json();
      if (!presignRes.ok) {
        setFormError(presignBody?.error?.message ?? 'Could not start upload');
        return;
      }
      const { uploadUrl, avatarUrl: newUrl } = presignBody.data as { uploadUrl: string; avatarUrl: string };
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) {
        setFormError('Upload failed. Please try again.');
        return;
      }
      setAvatarUrl(newUrl);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setAvatarUploading(false);
    }
  }

  // Lazy-load active cohorts the first time the user lands on a RESIDENT
  // invite. Re-fetch on subsequent visits is cheap but unnecessary; the list
  // doesn't change often during a single invite session.
  useEffect(() => {
    if (role !== Role.RESIDENT || cohortsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/cohorts');
        const body = await res.json();
        if (cancelled || !body.ok) return;
        const list = (body.data?.cohorts ?? []) as Array<{ id: string; name: string; academicYear: string | null }>;
        setCohorts(list.map((c) => ({ id: c.id, name: c.name, academicYear: c.academicYear })));
        setCohortsLoaded(true);
      } catch {
        // Non-fatal: admin can still send the invite without a cohort.
      }
    })();
    return () => { cancelled = true; };
  }, [role, cohortsLoaded]);

  function step1Valid(): boolean {
    const errs: Record<string, string> = {};
    if (fullName.trim().length < 2) errs.fullName = 'Full name is required';
    if (!isEdit) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errs.email = 'Valid email required';
      } else if (emailCheck.state === 'taken') {
        errs.email = emailCheck.message;
      } else if (emailCheck.state === 'checking') {
        errs.email = 'Checking email availability…';
      }
    }
    if (mobile && !/^(\+91[-\s]?)?[6-9]\d{9}$/.test(mobile.replace(/\s|-/g, '')))
      errs.mobile = 'Invalid Indian mobile number';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function step2Valid(): boolean {
    const errs: Record<string, string> = {};
    if (!role) errs.role = 'Please select a role';
    if (role === Role.RESIDENT && !yearOfResidency) errs.yearOfResidency = 'Year required for residents';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!role) { setFormError('Please select a role first.'); return; }

    const roleDefaults = new Set(defaultModulesForRole(role));
    const granted: string[] = [];
    const revoked: string[] = [];
    for (const [key, enabled] of Object.entries(moduleMap)) {
      const isDefault = roleDefaults.has(key);
      if (enabled && !isDefault) granted.push(key);
      else if (!enabled && isDefault) revoked.push(key);
    }

    const basePayload = {
      fullName:        fullName.trim(),
      mobile:          mobile.trim() || undefined,
      mciRegNumber:    mciRegNumber.trim() || undefined,
      role,
      subspecialty:    subspecialty.trim() || undefined,
      department:      department.trim() || undefined,
      yearOfResidency: role === Role.RESIDENT && typeof yearOfResidency === 'number' ? yearOfResidency : undefined,
      programDirectorId: role === Role.FACULTY  ? (pdPick[0]?.id ?? null)     : null,
      facultyMentorId:   role === Role.RESIDENT ? (mentorPick[0]?.id ?? null) : null,
      cohortId:          role === Role.RESIDENT ? (cohortId ?? null)          : null,
      avatarUrl:         avatarUrl ?? null,
      gender:            (gender as Gender | '') || null,
      moduleOverrides: { granted, revoked },
      expiresInHours,
    };

    if (isEdit) {
      const parsed = updateInvitationSchema.safeParse(basePayload);
      if (!parsed.success) {
        setFormError('Validation failed. Please check highlighted fields.');
        setFieldErrors(Object.fromEntries(
          Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, (v as string[])?.[0] ?? ''])
        ));
        return;
      }

      setSubmitting(true);
      try {
        const res  = await fetch(`/api/invitations/${edit!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
        });
        const body = await res.json();
        if (res.ok) onCreated();
        else setFormError(body?.error?.message ?? 'Failed to update invitation');
      } catch {
        setFormError('Network error. Please try again.');
      }
      setSubmitting(false);
      return;
    }

    const createPayload = { ...basePayload, email: email.trim().toLowerCase() };
    const parsed = createInvitationSchema.safeParse(createPayload);
    if (!parsed.success) {
      setFormError('Validation failed. Please check highlighted fields.');
      setFieldErrors(Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, (v as string[])?.[0] ?? ''])
      ));
      return;
    }

    setSubmitting(true);
    try {
      const res  = await fetch('/api/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) });
      const body = await res.json();
      if (res.ok) onCreated();
      else setFormError(body?.error?.message ?? 'Failed to create invitation');
    } catch {
      setFormError('Network error. Please try again.');
    }
    setSubmitting(false);
  }

  function handleNext() {
    if (step === 1 && !step1Valid()) return;
    if (step === 2 && !step2Valid()) return;
    setStep((s) => (s < 3 ? ((s + 1) as Step) : s));
  }

  const enabledModuleCount = Object.values(moduleMap).filter(Boolean).length;
  const roleOption          = role ? ROLE_OPTIONS.find((r) => r.value === role) : null;
  const RoleIcon            = roleOption?.icon ?? null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-foreground/60 backdrop-blur-md"
        onClick={submitting ? undefined : onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 24 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl bg-card shadow-[0_32px_80px_-8px_oklch(0.12_0.05_260/0.35)]"
        style={{ maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Sidebar ── */}
        <aside className="relative flex w-60 shrink-0 flex-col overflow-hidden">
          {/* premium-hero gradient using Vaidix primary palette */}
          <div className="absolute inset-0" style={{
            background: `
              radial-gradient(at 20% 30%, oklch(0.45 0.17 165 / 0.95) 0px, transparent 55%),
              radial-gradient(at 80% 20%, oklch(0.45 0.18 190 / 0.85) 0px, transparent 60%),
              radial-gradient(at 60% 90%, oklch(0.40 0.16 220 / 0.75) 0px, transparent 60%),
              linear-gradient(135deg, oklch(0.18 0.06 220), oklch(0.15 0.05 200))
            `,
          }} />

          <div className="relative z-10 flex flex-1 flex-col">
            {/* Avatar preview */}
            <div className="flex flex-col items-center px-5 pb-5 pt-8">
              <div className="relative mb-3">
                <div className="absolute -inset-2 rounded-3xl blur-xl" style={{ background: 'oklch(0.55 0.17 165 / 0.4)' }} />
                <motion.div
                  layout
                  className="relative flex size-18 items-center justify-center rounded-2xl text-2xl font-extrabold text-white shadow-xl"
                  style={{ background: 'oklch(0.55 0.17 165)', boxShadow: '0 8px 24px oklch(0.45 0.17 165 / 0.5)' }}
                >
                  <AnimatePresence mode="wait">
                    {getInitials(fullName) ? (
                      <motion.span key={getInitials(fullName)} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.15 }} className="tracking-tight">
                        {getInitials(fullName)}
                      </motion.span>
                    ) : (
                      <motion.div key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <UserCircle className="size-9 opacity-50" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>

              <AnimatePresence mode="wait">
                {fullName.trim() ? (
                  <motion.p key="name" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                    className="text-center text-sm font-bold leading-snug text-white"
                  >
                    {fullName}
                  </motion.p>
                ) : (
                  <motion.p key="ph" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-xs italic text-white/40">
                    No name yet
                  </motion.p>
                )}
              </AnimatePresence>

              {email && (
                <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-1 max-w-45 truncate text-center text-[11px] text-white/50">
                  {email}
                </motion.p>
              )}

              <motion.div layout className="mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide" style={{ background: 'oklch(1 0 0 / 0.12)', color: 'oklch(1 0 0 / 0.85)' }}>
                {RoleIcon ? <RoleIcon className="size-3" /> : <UserCircle className="size-3" />}
                {roleOption?.label ?? 'No role yet'}
              </motion.div>
            </div>

            {/* Divider */}
            <div className="mx-5 border-t border-white/10" />

            {/* Steps */}
            <nav className="flex flex-1 flex-col gap-0.5 px-2.5 py-4">
              {STEP_META.map((meta, i) => {
                const n      = (i + 1) as Step;
                const Icon   = meta.icon;
                const active = step === n;
                const done   = step > n;
                return (
                  <div key={n} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${active ? 'bg-white/10' : ''}`}>
                    <motion.div
                      animate={done ? { background: 'oklch(0.55 0.17 165)', color: '#fff' } : active ? { background: '#fff', color: 'oklch(0.18 0.06 220)' } : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}
                      className="flex size-7 shrink-0 items-center justify-center rounded-full"
                    >
                      {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-3.5" />}
                    </motion.div>
                    <div>
                      <div className={`text-[10px] ${active ? 'text-white/50' : done ? 'text-white/30' : 'text-white/25'}`}>Step {n}</div>
                      <div className={`text-sm font-semibold leading-none ${active ? 'text-white' : done ? 'text-white/60' : 'text-white/35'}`}>{meta.label}</div>
                    </div>
                  </div>
                );
              })}
            </nav>

            {/* Stats */}
            <div className="mx-3 mb-5 rounded-2xl border border-white/10 p-3.5" style={{ background: 'oklch(1 0 0 / 0.06)' }}>
              <div className="mb-2 flex items-center gap-1.5">
                <Sparkles className="size-3 text-white/60" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Summary</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/50">Modules</span>
                  <span className="font-bold text-white/80">{enabledModuleCount} / {MODULES.length}</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: 'oklch(1 0 0 / 0.12)' }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'oklch(0.65 0.17 165)' }}
                    animate={{ width: `${(enabledModuleCount / MODULES.length) * 100}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/50">Expires in</span>
                  <span className="font-bold text-white/80">{expiresInHours}h</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── Right panel ── */}
        <div className="flex flex-1 flex-col overflow-hidden bg-card">
          {/* Header */}
          <header className="flex items-start justify-between border-b border-border px-7 py-5">
            <div>
              <p className="mb-0.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                {isEdit ? 'Edit invitation' : 'New invitation'} · Step {step} of 3
              </p>
              <h2 className="text-2xl font-extrabold tracking-tight text-foreground">
                {STEP_META[step - 1].label}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{STEP_META[step - 1].sub}</p>
            </div>
            <button
              onClick={onClose}
              disabled={submitting}
              className="mt-1 rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-7 py-6">
            <AnimatePresence>
              {formError && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  className="mb-5 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  <X className="size-4 shrink-0" />
                  {formError}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div key="s1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
                  <Step1
                    fullName={fullName} email={email} mobile={mobile} mciRegNumber={mciRegNumber} errors={fieldErrors}
                    emailLocked={isEdit}
                    emailCheck={emailCheck}
                    avatarUrl={avatarUrl}
                    avatarUploading={avatarUploading}
                    avatarInputRef={avatarInputRef}
                    onAvatarFile={handleAvatarFile}
                    onAvatarClear={() => setAvatarUrl(null)}
                    gender={gender}
                    onGenderChange={(v) => setGender(v)}
                    onChange={(patch) => {
                      if ('fullName'     in patch) setFullName(patch.fullName!);
                      if ('email'        in patch) setEmail(patch.email!);
                      if ('mobile'       in patch) setMobile(patch.mobile!);
                      if ('mciRegNumber' in patch) setMciRegNumber(patch.mciRegNumber!);
                    }}
                  />
                </motion.div>
              )}
              {step === 2 && (
                <motion.div key="s2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
                  <Step2
                    role={role} subspecialty={subspecialty} department={department}
                    yearOfResidency={yearOfResidency} expiresInHours={expiresInHours} errors={fieldErrors}
                    onRoleChange={setRole} onSubspecialtyChange={setSubspecialty}
                    onDepartmentChange={setDepartment} onYearChange={setYearOfResidency} onExpiryChange={setExpiresInHours}
                    pdPick={pdPick} onPdChange={setPdPick}
                    mentorPick={mentorPick} onMentorChange={setMentorPick}
                    cohortId={cohortId} cohorts={cohorts} onCohortChange={setCohortId}
                  />
                </motion.div>
              )}
              {step === 3 && (
                <motion.div key="s3" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
                  <Step3
                    role={role!} moduleMap={moduleMap}
                    onToggle={(key) => setModuleMap((m) => ({ ...m, [key]: !m[key] }))}
                    onResetToRoleDefaults={() => role && setModuleMap(defaultModuleMap(role))}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between border-t border-border px-7 py-4">
            {step > 1 ? (
              <button onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))} disabled={submitting}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="size-4" /> Back
              </button>
            ) : (
              <button onClick={onClose} disabled={submitting}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
            )}

            {step < 3 ? (
              <motion.button
                onClick={handleNext}
                disabled={step === 1 && !isEdit && (emailCheck.state === 'taken' || emailCheck.state === 'checking')}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ boxShadow: '0 8px 24px oklch(0.45 0.15 165 / 0.35)' }}
              >
                Continue <ChevronRight className="size-4" />
              </motion.button>
            ) : (
              <motion.button onClick={handleSubmit} disabled={submitting} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground shadow-lg transition hover:opacity-90 disabled:opacity-60"
                style={{ boxShadow: '0 8px 24px oklch(0.45 0.15 165 / 0.35)' }}
              >
                <Send className="size-4" />
                {submitting
                  ? (isEdit ? 'Saving...' : 'Sending...')
                  : (isEdit ? 'Save changes' : 'Send invitation')}
              </motion.button>
            )}
          </footer>
        </div>
      </motion.div>
    </>
  );
}

export function InviteModal({ open, onClose, onCreated, edit }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  edit?: InviteModalEditData;
}) {
  return (
    <AnimatePresence>
      {open && <InviteModalBody key={edit?.id ?? 'new'} onClose={onClose} onCreated={onCreated} edit={edit} />}
    </AnimatePresence>
  );
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────
type EmailCheckState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken'; reason: 'USER_EXISTS' | 'PENDING_INVITE'; message: string };

function Step1({
  fullName, email, mobile, mciRegNumber, errors, emailLocked, emailCheck,
  avatarUrl, avatarUploading, avatarInputRef, onAvatarFile, onAvatarClear,
  gender, onGenderChange,
  onChange,
}: {
  fullName: string; email: string; mobile: string; mciRegNumber: string;
  errors: Record<string, string>;
  emailLocked?: boolean;
  emailCheck?: EmailCheckState;
  avatarUrl: string | null;
  avatarUploading: boolean;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  onAvatarFile: (file: File) => void | Promise<void>;
  onAvatarClear: () => void;
  gender: Gender | '';
  onGenderChange: (v: Gender | '') => void;
  onChange: (patch: Partial<{ fullName: string; email: string; mobile: string; mciRegNumber: string }>) => void;
}) {
  const emailFormatValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const nameValid   = fullName.trim().length >= 2;
  const mobileValid = !mobile || /^(\+91[-\s]?)?[6-9]\d{9}$/.test(mobile.replace(/\s|-/g, ''));

  // The Field-level "valid" tick only lights when format is good AND, in
  // create mode, the live availability check came back available.
  const emailValid =
    !emailLocked &&
    emailFormatValid &&
    email.length > 0 &&
    (!emailCheck || emailCheck.state === 'available' || emailCheck.state === 'idle');

  // We hide the standard error message when the live check has its own
  // banner, so we don't show the same thing twice.
  const showStandardEmailError =
    !!errors.email && (!emailCheck || emailCheck.state !== 'taken');

  return (
    <div className="space-y-5">
      {/* Avatar — uploaded directly to S3 via presign, committed on Send */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Camera className="size-3.5 text-muted-foreground" />
          <label className="text-sm font-semibold text-foreground">Profile photo</label>
          <span className="ml-auto text-xs text-muted-foreground">Optional</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl border-2 border-input bg-muted/40">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={fullName || 'avatar'} className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-lg font-bold text-muted-foreground">
                {getInitials(fullName) || '?'}
              </div>
            )}
            {avatarUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="size-5 animate-spin text-primary" />
              </div>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onAvatarFile(f);
                e.target.value = '';
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={avatarUploading}
                onClick={() => avatarInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-xl border-2 border-input bg-card px-3 py-1.5 text-xs font-bold text-foreground transition hover:border-primary/40 hover:bg-accent disabled:opacity-50"
              >
                <Camera className="size-3.5" />
                {avatarUrl ? 'Replace photo' : 'Upload photo'}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  disabled={avatarUploading}
                  onClick={onAvatarClear}
                  className="flex items-center gap-1.5 rounded-xl border-2 border-input bg-card px-3 py-1.5 text-xs font-bold text-foreground transition hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">JPEG, PNG, or WebP. Up to 5 MB.</p>
          </div>
        </div>
      </div>

      <Field label="Full name" icon={UserCircle} required error={errors.fullName} valid={nameValid && fullName.length > 0}>
        <FancyInput value={fullName} onChange={(v) => onChange({ fullName: v })} placeholder="Dr. Priya Nair" />
      </Field>
      <Field
        label="Email address"
        icon={Mail}
        required={!emailLocked}
        error={showStandardEmailError ? errors.email : undefined}
        valid={emailValid}
        hint={emailLocked ? 'Locked — revoke & re-invite to change' : undefined}
      >
        {emailLocked ? (
          <div className="w-full rounded-xl border-2 border-dashed border-border bg-muted/30 px-3.5 py-2.5 text-sm font-medium text-muted-foreground">
            {email}
          </div>
        ) : (
          <FancyInput type="email" value={email} onChange={(v) => onChange({ email: v })} placeholder="priya@lvpei.org" />
        )}
        {!emailLocked && emailFormatValid && emailCheck && (
          <EmailCheckBanner check={emailCheck} />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Mobile" icon={Phone} hint="Optional" error={errors.mobile} valid={mobileValid && mobile.length > 0}>
          <FancyInput value={mobile} onChange={(v) => onChange({ mobile: v })} placeholder="+91 98765 43210" />
        </Field>
        <Field label="MCI registration" icon={IdCard} hint="Optional">
          <FancyInput value={mciRegNumber} onChange={(v) => onChange({ mciRegNumber: v })} placeholder="TSMC-12345" />
        </Field>
        <Field label="Gender" hint="Optional">
          <FancySelect value={gender} onChange={(v) => onGenderChange((v as Gender) || '')}>
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </FancySelect>
        </Field>
      </div>
    </div>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────
function Step2({
  role, subspecialty, department, yearOfResidency, expiresInHours, errors,
  onRoleChange, onSubspecialtyChange, onDepartmentChange, onYearChange, onExpiryChange,
  pdPick, onPdChange, mentorPick, onMentorChange, cohortId, cohorts, onCohortChange,
}: {
  role: Role | null; subspecialty: string; department: string; yearOfResidency: number | ''; expiresInHours: number;
  errors: Record<string, string>;
  onRoleChange: (r: Role) => void; onSubspecialtyChange: (v: string) => void; onDepartmentChange: (v: string) => void;
  onYearChange: (v: number | '') => void; onExpiryChange: (v: number) => void;
  pdPick: PickableUser[]; onPdChange: (v: PickableUser[]) => void;
  mentorPick: PickableUser[]; onMentorChange: (v: PickableUser[]) => void;
  cohortId: string | null; cohorts: CohortLite[]; onCohortChange: (v: string | null) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Select role</p>
        {errors.role && (
          <p className="mb-2 text-xs font-medium text-destructive">{errors.role}</p>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ROLE_OPTIONS.map((opt) => {
            const Icon     = opt.icon;
            const selected = role === opt.value;
            return (
              <motion.label key={opt.value} whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-3.5 transition-all ${
                  selected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border hover:border-primary/40 hover:bg-accent/50'
                }`}
              >
                <input type="radio" name="role" value={opt.value} checked={selected} onChange={() => onRoleChange(opt.value)} className="sr-only" />
                <div className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl transition ${selected ? 'bg-primary/10' : 'bg-muted'}`}>
                  <Icon className={`size-5 transition ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-bold text-foreground">{opt.label}</span>
                    <AnimatePresence>
                      {selected && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                          <CheckCircle2 className="size-4 text-primary" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
              </motion.label>
            );
          })}
        </div>
      </div>

      {/* Hierarchy mapping — role-conditional pickers */}
      {role === Role.FACULTY && (
        <div>
          <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Network className="size-3" /> Reports to (HOD)
          </p>
          {pdPick.length > 0 ? (
            <PickedChip
              user={pdPick[0]}
              onClear={() => onPdChange([])}
              accent="teal"
            />
          ) : (
            <UserPicker
              single
              role={Role.PROGRAM_DIRECTOR}
              selected={pdPick}
              onChange={onPdChange}
              placeholder="Search HODs…"
            />
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Optional. Applied automatically when the invitee accepts.
          </p>
        </div>
      )}

      {role === Role.RESIDENT && (
        <div className="space-y-5">
          <div>
            <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <Network className="size-3" /> Teacher mentor
            </p>
            {mentorPick.length > 0 ? (
              <PickedChip
                user={mentorPick[0]}
                onClear={() => onMentorChange([])}
                accent="blue"
              />
            ) : (
              <UserPicker
                single
                role={Role.FACULTY}
                selected={mentorPick}
                onChange={onMentorChange}
                placeholder="Search teachers…"
              />
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Optional. Direct mentor for this resident, independent of cohort.
            </p>
          </div>

          <div>
            <p className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <Users2 className="size-3" /> Cohort assignment
            </p>
            <FancySelect value={cohortId ?? ''} onChange={(v) => onCohortChange(v || null)}>
              <option value="">No cohort (assign later)</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.academicYear ? ` · ${c.academicYear}` : ''}
                </option>
              ))}
            </FancySelect>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Optional. Applied automatically when the invitee accepts.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Subspecialty">
          <FancyInput value={subspecialty} onChange={onSubspecialtyChange} placeholder="Vitreoretinal Surgery" />
        </Field>
        <Field label="Department">
          <FancyInput value={department} onChange={onDepartmentChange} placeholder="Department name" />
        </Field>
        {role === Role.RESIDENT && (
          <Field label="Year of Residency" required error={errors.yearOfResidency}>
            <FancySelect value={String(yearOfResidency)} onChange={(v) => onYearChange(v ? parseInt(v) : '')}>
              <option value="">Select year</option>
              {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>PGY-{y}</option>)}
            </FancySelect>
          </Field>
        )}
        <Field label="Invitation expires" icon={Clock}>
          <FancySelect value={String(expiresInHours)} onChange={(v) => onExpiryChange(parseInt(v))}>
            <option value={24}>24 hours</option>
            <option value={48}>48 hours (recommended)</option>
            <option value={72}>72 hours</option>
            <option value={168}>7 days</option>
          </FancySelect>
        </Field>
      </div>
    </div>
  );
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────
function Step3({ role, moduleMap, onToggle, onResetToRoleDefaults }: {
  role: Role; moduleMap: Record<string, boolean>;
  onToggle: (key: string) => void; onResetToRoleDefaults: () => void;
}) {
  const byCategory = useMemo(() => {
    const g: Record<ModuleCategory, ModuleDef[]> = { learning: [], assessment: [], faculty: [], program: [], admin: [] };
    for (const m of MODULES) g[m.category].push(m);
    return g;
  }, []);

  const enabledCount = Object.values(moduleMap).filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3.5">
        <div>
          <p className="text-sm font-bold text-foreground">
            Defaults for <span className="text-primary">{humanRole(role)}</span> pre-selected
          </p>
          <p className="text-xs text-muted-foreground">{enabledCount} of {MODULES.length} enabled · customise below</p>
        </div>
        <button onClick={onResetToRoleDefaults} type="button"
          className="rounded-xl border border-primary/30 bg-card px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/5"
        >
          Reset
        </button>
      </div>

      {(['learning', 'assessment', 'faculty', 'program', 'admin'] as ModuleCategory[]).map((cat) => (
        <div key={cat}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{CATEGORY_LABELS[cat]}</span>
            <div className="flex-1 border-t border-border" />
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {byCategory[cat].map((m) => {
              const enabled   = moduleMap[m.key] ?? false;
              const isDefault = m.defaultRoles.includes(role);
              return (
                <motion.label key={m.key} whileHover={{ scale: 1.01 }}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                    enabled ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:border-primary/20'
                  }`}
                >
                  <input type="checkbox" checked={enabled} onChange={() => onToggle(m.key)}
                    className="mt-0.5 size-4 rounded border-border text-primary focus:ring-primary/20"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-foreground">{m.label}</span>
                      {!isDefault && enabled && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">EXTRA</span>
                      )}
                      {isDefault && !enabled && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">REMOVED</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{m.description}</p>
                  </div>
                </motion.label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────
function Field({ label, icon: Icon, error, required, hint, valid, children }: {
  label: string; icon?: typeof UserCircle; error?: string; required?: boolean; hint?: string; valid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {Icon && <Icon className="size-3.5 text-muted-foreground" />}
          {label}
          {required && <span className="text-destructive">*</span>}
        </label>
        <div className="flex items-center gap-2">
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
          <AnimatePresence>
            {valid && (
              <motion.span initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                <CheckCircle2 className="size-3.5 text-primary" />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="mt-1 text-xs font-medium text-destructive"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FancyInput ───────────────────────────────────────────────────────────────
function FancyInput({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      className={`w-full rounded-xl border-2 bg-muted/40 px-3.5 py-2.5 text-sm font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60 transition-all ${
        focused
          ? 'border-primary bg-card shadow-[0_0_0_4px_oklch(0.45_0.15_165/0.12)]'
          : 'border-input hover:border-primary/30 hover:bg-card'
      }`}
    />
  );
}

// ─── FancySelect ─────────────────────────────────────────────────────────────
function FancySelect({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={`w-full rounded-xl border-2 bg-muted/40 px-3.5 py-2.5 text-sm font-medium text-foreground outline-none transition-all ${
        focused
          ? 'border-primary bg-card shadow-[0_0_0_4px_oklch(0.45_0.15_165/0.12)]'
          : 'border-input hover:border-primary/30 hover:bg-card'
      }`}
    >
      {children}
    </select>
  );
}

// ─── EmailCheckBanner ────────────────────────────────────────────────────────
function EmailCheckBanner({ check }: { check: EmailCheckState }) {
  if (check.state === 'idle') return null;
  if (check.state === 'checking') {
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" />
        Checking availability…
      </motion.div>
    );
  }
  if (check.state === 'available') {
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 flex items-center gap-2 rounded-lg bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary"
      >
        <CheckCircle2 className="size-3.5" />
        Email is available — ready to invite
      </motion.div>
    );
  }
  // taken
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <div>
        <div className="font-bold uppercase tracking-wide text-[10px]">
          {check.reason === 'USER_EXISTS' ? 'Already a registered user' : 'Already invited'}
        </div>
        <div className="mt-0.5">{check.message}</div>
      </div>
    </motion.div>
  );
}

function humanRole(role: string): string {
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function PickedChip({ user, onClear, accent }: {
  user: PickableUser;
  onClear: () => void;
  accent: 'teal' | 'blue';
}) {
  const ring = accent === 'teal' ? 'bg-teal-500/10 text-teal-700' : 'bg-blue-500/10 text-blue-700';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
      <div className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ring}`}>
        {user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{user.name}</div>
        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
        aria-label="Clear selection"
      >
        <UserMinus className="size-4" />
      </button>
    </div>
  );
}
