'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader2, ShieldCheck, User as UserIcon, Phone, AtSign, GraduationCap, Building2, Mail, AlertCircle, UserMinus, Camera, Trash2, Users as UsersIcon } from 'lucide-react'
import { Role, UserStatus } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ROLE_LABELS } from '@/lib/constants'
import { mapPrismaRoleToUserRole } from '@/lib/identity'
import { UserPicker, type PickableUser } from '@/components/user-picker'
import type { AdminUserRow } from './users-client'

interface CohortLite {
  id: string
  name: string
  academicYear: string | null
}

interface DetailedUser {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  avatarUrl: string | null
  mobile: string | null
  username: string | null
  programDirectorId: string | null
  programDirector: {
    id: string
    name: string
    email: string
    avatarUrl: string | null
  } | null
  facultyMentorId: string | null
  facultyMentor: {
    id: string
    name: string
    email: string
    avatarUrl: string | null
  } | null
  cohorts: Array<{ id: string; name: string; academicYear: string | null }>
  profile: {
    subspecialty: string | null
    yearOfResidency: number | null
    affiliation: string | null
    bio: string | null
    timezone: string | null
    mciRegNumber: string | null
    gender: string | null
  } | null
}

type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say'

interface Props {
  user: AdminUserRow
  currentUserId: string
  onClose: () => void
  onSaved: () => void
}

const ROLE_OPTIONS: Role[] = [
  Role.RESIDENT,
  Role.FACULTY,
  Role.PROGRAM_DIRECTOR,
  Role.ADMIN,
  Role.EXTERNAL_LEARNER,
]

const STATUS_OPTIONS: Array<Extract<UserStatus, 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'>> = [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
]

type Tab = 'identity' | 'profile' | 'role-status'

export function EditUserModal({ user, currentUserId, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('identity')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Identity
  const [name, setName] = useState(user.name)
  const [mobile, setMobile] = useState('')
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [originalAvatarUrl, setOriginalAvatarUrl] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)

  // Profile
  const [subspecialty, setSubspecialty] = useState('')
  const [yearOfResidency, setYearOfResidency] = useState<string>('')
  const [affiliation, setAffiliation] = useState('')
  const [mciRegNumber, setMciRegNumber] = useState('')
  const [bio, setBio] = useState('')
  const [gender, setGender] = useState<Gender | ''>('')

  // Role & status
  const [newRole, setNewRole] = useState<Role>(user.role)
  const [newStatus, setNewStatus] = useState<UserStatus>(user.status)
  const [reason, setReason] = useState('')

  // Program director (only meaningful when newRole === FACULTY)
  const [pdPick, setPdPick] = useState<PickableUser[]>([])
  const [originalPdId, setOriginalPdId] = useState<string | null>(null)

  // Faculty mentor (only meaningful when newRole === RESIDENT). Direct mentor
  // independent of cohort.
  const [mentorPick, setMentorPick] = useState<PickableUser[]>([])
  const [originalMentorId, setOriginalMentorId] = useState<string | null>(null)

  // Cohort assignment (only meaningful when newRole === RESIDENT). The admin
  // edit assigns at most one cohort here; multi-cohort membership stays in
  // the cohort drawer.
  const [cohortId, setCohortId] = useState<string | null>(null)
  const [originalCohortId, setOriginalCohortId] = useState<string | null>(null)
  const [cohorts, setCohorts] = useState<CohortLite[]>([])
  const [cohortsLoaded, setCohortsLoaded] = useState(false)

  const isSelf = user.id === currentUserId

  // Hydrate full user detail (mobile, username, profile) on open. Always
  // resolves the loading state — every error path sets it explicitly, and
  // the catch handles fetch failures (DNS, abort, parse errors).
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/admin/users/${user.id}`, {
          credentials: 'include',
          cache: 'no-store',
        })
        const text = await res.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          if (!cancelled) {
            setError(`Server returned non-JSON (status ${res.status}). Check server logs.`)
            setLoading(false)
          }
          return
        }
        if (!res.ok) {
          const errMsg =
            (parsed as { error?: { message?: string } } | null)?.error?.message ??
            `Request failed (status ${res.status})`
          if (!cancelled) {
            setError(errMsg)
            setLoading(false)
          }
          return
        }
        const u = (parsed as { data: { user: DetailedUser } }).data.user
        if (cancelled) return
        setMobile(u.mobile ?? '')
        setUsername(u.username ?? '')
        setAvatarUrl(u.avatarUrl ?? null)
        setOriginalAvatarUrl(u.avatarUrl ?? null)
        setSubspecialty(u.profile?.subspecialty ?? '')
        setYearOfResidency(u.profile?.yearOfResidency != null ? String(u.profile.yearOfResidency) : '')
        setAffiliation(u.profile?.affiliation ?? '')
        setMciRegNumber(u.profile?.mciRegNumber ?? '')
        setBio(u.profile?.bio ?? '')
        setOriginalPdId(u.programDirectorId ?? null)
        setPdPick(
          u.programDirector
            ? [{
                id: u.programDirector.id,
                name: u.programDirector.name,
                email: u.programDirector.email,
                role: Role.PROGRAM_DIRECTOR,
                avatarUrl: u.programDirector.avatarUrl,
              }]
            : []
        )
        setOriginalMentorId(u.facultyMentorId ?? null)
        setMentorPick(
          u.facultyMentor
            ? [{
                id: u.facultyMentor.id,
                name: u.facultyMentor.name,
                email: u.facultyMentor.email,
                role: Role.FACULTY,
                avatarUrl: u.facultyMentor.avatarUrl,
              }]
            : []
        )
        setGender((u.profile?.gender as Gender | null) ?? '')
        const firstCohort = u.cohorts?.[0]?.id ?? null
        setOriginalCohortId(firstCohort)
        setCohortId(firstCohort)
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Network error'
          setError(`Could not load user details: ${msg}`)
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [user.id])

  // Cohort list lazy-load — only needed if the editor is touching a resident,
  // either currently or via role change. Single fetch per modal lifetime.
  useEffect(() => {
    if (newRole !== Role.RESIDENT || cohortsLoaded) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/cohorts')
        const body = await res.json()
        if (cancelled || !body.ok) return
        const list = (body.data?.cohorts ?? []) as Array<{ id: string; name: string; academicYear: string | null }>
        setCohorts(list.map((c) => ({ id: c.id, name: c.name, academicYear: c.academicYear })))
        setCohortsLoaded(true)
      } catch {
        // Non-fatal — admin can save without changing cohort.
      }
    })()
    return () => { cancelled = true }
  }, [newRole, cohortsLoaded])

  // Avatar upload via the presign + PUT pattern. The DB write is deferred to
  // the main Save click so the admin can still cancel without leaving a half-
  // applied photo on the user row. The uploaded blob lingers in S3 either way
  // (cleanup is out of scope for this flow).
  async function handleAvatarFile(file: File) {
    setError(null)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Please choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be 5 MB or smaller.')
      return
    }
    setAvatarUploading(true)
    try {
      const presignRes = await fetch(`/api/admin/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
      })
      const presignBody = await presignRes.json()
      if (!presignRes.ok) {
        setError(presignBody?.error?.message ?? 'Could not start upload')
        return
      }
      const { uploadUrl, avatarUrl: newUrl } = presignBody.data as { uploadUrl: string; avatarUrl: string }

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!putRes.ok) {
        setError('Upload failed. Please try again.')
        return
      }
      setAvatarUrl(newUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setAvatarUploading(false)
    }
  }

  async function callPatch(path: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
    const res = await fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    return { ok: false, message: j?.error?.message ?? `Request failed (${res.status})` }
  }

  async function handleSave() {
    setSubmitting(true)
    setError(null)
    try {
      const yearInt = yearOfResidency.trim() ? Number.parseInt(yearOfResidency, 10) : null
      if (yearOfResidency.trim() && (Number.isNaN(yearInt!) || yearInt! < 1 || yearInt! > 10)) {
        setError('Year of residency must be between 1 and 10')
        setSubmitting(false)
        return
      }

      // 1) Role change first (separate endpoint — writes UserRoleHistory).
      //    Order matters: subsequent identity PATCH may set programDirectorId,
      //    which the service guards behind target.role === FACULTY.
      if (!isSelf && newRole !== user.role) {
        const r1 = await callPatch(`/api/admin/users/${user.id}/role`, {
          role: newRole,
          reason: reason.trim() || undefined,
        })
        if (!r1.ok) {
          setError(r1.message ?? 'Failed to change role')
          setSubmitting(false)
          return
        }
      }

      // 2) Identity + profile + programDirectorId + avatar + cohort (single PATCH)
      const identityPayload: Record<string, unknown> = {}
      if (name.trim() !== user.name) identityPayload.name = name.trim()
      if (mobile.trim()) identityPayload.mobile = mobile.trim()
      else identityPayload.mobile = null
      if (username.trim()) identityPayload.username = username.trim().toLowerCase()
      else identityPayload.username = null

      if (avatarUrl !== originalAvatarUrl) identityPayload.avatarUrl = avatarUrl

      identityPayload.profile = {
        subspecialty: subspecialty.trim() || null,
        yearOfResidency: yearInt,
        affiliation: affiliation.trim() || null,
        mciRegNumber: mciRegNumber.trim() || null,
        bio: bio.trim() || null,
        gender: gender || null,
      }

      // Send programDirectorId only when relevant: target is/will-be FACULTY.
      // For any other role the field is meaningless; skip it so the server
      // doesn't have to think about it.
      if (newRole === Role.FACULTY) {
        const nextPdId = pdPick[0]?.id ?? null
        if (nextPdId !== originalPdId) identityPayload.programDirectorId = nextPdId
      } else if (originalPdId) {
        // Leaving FACULTY — clear any PD link so we don't carry stale state.
        identityPayload.programDirectorId = null
      }

      // Cohort assignment is RESIDENT-only. When the resident becomes another
      // role we explicitly clear; the service rejects cohortId on non-residents.
      if (newRole === Role.RESIDENT) {
        if (cohortId !== originalCohortId) identityPayload.cohortId = cohortId
      } else if (originalCohortId) {
        identityPayload.cohortId = null
      }

      // Faculty mentor is RESIDENT-only. Mirror PD/cohort behavior: clear on
      // role transition out of RESIDENT.
      if (newRole === Role.RESIDENT) {
        const nextMentorId = mentorPick[0]?.id ?? null
        if (nextMentorId !== originalMentorId) identityPayload.facultyMentorId = nextMentorId
      } else if (originalMentorId) {
        identityPayload.facultyMentorId = null
      }

      const r2 = await callPatch(`/api/admin/users/${user.id}`, identityPayload)
      if (!r2.ok) {
        setError(r2.message ?? 'Failed to update user')
        setSubmitting(false)
        return
      }

      // 3) Status change (separate endpoint — bumps passwordVersion + may email)
      if (!isSelf && newStatus !== user.status && STATUS_OPTIONS.includes(newStatus as 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED')) {
        const r3 = await callPatch(`/api/admin/users/${user.id}/status`, {
          status: newStatus,
          reason: reason.trim() || undefined,
        })
        if (!r3.ok) {
          setError(r3.message ?? 'Failed to change status')
          setSubmitting(false)
          return
        }
      }

      onSaved()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18 }}
          className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-border/60 px-5 py-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-primary" />
                Edit user
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {user.name} · {user.email}{isSelf && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-400">YOU</span>}
              </p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted/60" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex shrink-0 border-b border-border/40 px-5">
            <TabButton active={tab === 'identity'} onClick={() => setTab('identity')}>
              <UserIcon className="size-3.5" />
              Identity
            </TabButton>
            <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
              <GraduationCap className="size-3.5" />
              Profile
            </TabButton>
            <TabButton active={tab === 'role-status'} onClick={() => setTab('role-status')} disabled={isSelf}>
              <ShieldCheck className="size-3.5" />
              Role & Status
            </TabButton>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading user details...
              </div>
            ) : tab === 'identity' ? (
              <div className="space-y-4">
                {/* Avatar — uploads to S3 via presign, commits on Save */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Camera className="size-3" />
                    Profile photo
                  </label>
                  <div className="flex items-center gap-4">
                    <div className="relative size-20 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt={name} className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-lg font-bold text-muted-foreground">
                          {name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'}
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
                          const f = e.target.files?.[0]
                          if (f) void handleAvatarFile(f)
                          e.target.value = ''
                        }}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={avatarUploading}
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          <Camera className="mr-1.5 size-3.5" />
                          {avatarUrl ? 'Replace photo' : 'Upload photo'}
                        </Button>
                        {avatarUrl && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={avatarUploading}
                            onClick={() => setAvatarUrl(null)}
                          >
                            <Trash2 className="mr-1.5 size-3.5" />
                            Remove
                          </Button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        JPEG, PNG, or WebP. Up to 5 MB. Saved when you click Save changes.
                      </p>
                    </div>
                  </div>
                </div>
                <Field label="Full name" icon={UserIcon}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Email (read-only)" icon={Mail} hint="Email is locked. Use the invitations flow to re-issue access under a new address.">
                  <Input value={user.email} readOnly disabled className="bg-muted/40" />
                </Field>
                <Field label="Mobile" icon={Phone} hint="E.164 format with country code, e.g. +919876543210">
                  <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+91XXXXXXXXXX" />
                </Field>
                <Field label="Username" icon={AtSign} hint="3–32 chars, lowercase letters / digits / dot / dash / underscore.">
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. ananya.k"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </Field>
              </div>
            ) : tab === 'profile' ? (
              <div className="space-y-4">
                <Field label="Subspecialty" icon={GraduationCap}>
                  <Input value={subspecialty} onChange={(e) => setSubspecialty(e.target.value)} placeholder="e.g. Vitreoretinal Surgery" />
                </Field>
                <Field label="Year of training" icon={GraduationCap} hint="1–10 (PGY level). Leave blank for non-students.">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={yearOfResidency}
                    onChange={(e) => setYearOfResidency(e.target.value)}
                    placeholder="e.g. 3"
                  />
                </Field>
                <Field label="Affiliation" icon={Building2}>
                  <Input value={affiliation} onChange={(e) => setAffiliation(e.target.value)} placeholder="L V Prasad Eye Institute" />
                </Field>
                <Field label="MCI registration number" icon={ShieldCheck} hint="Optional — Indian Medical Council registration.">
                  <Input value={mciRegNumber} onChange={(e) => setMciRegNumber(e.target.value)} placeholder="e.g. MCI/12345/2018" />
                </Field>
                <Field label="Gender" hint="Optional">
                  <select
                    value={gender}
                    onChange={(e) => setGender((e.target.value as Gender) || '')}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Prefer not to say</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </select>
                </Field>
                <Field label="Bio">
                  <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} placeholder="Short biography..." />
                </Field>
              </div>
            ) : (
              <div className="space-y-5">
                {isSelf && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    You cannot change your own role or status. Sign in as another admin to make this change.
                  </div>
                )}

                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Role</p>
                  <div className="grid gap-2">
                    {ROLE_OPTIONS.map((role) => (
                      <label
                        key={role}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm transition-colors ${
                          newRole === role ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
                        } ${isSelf ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={role}
                          checked={newRole === role}
                          onChange={() => setNewRole(role)}
                          disabled={isSelf}
                          className="size-4 accent-primary"
                        />
                        <span>{ROLE_LABELS[mapPrismaRoleToUserRole(role)]}</span>
                        {role === user.role && (
                          <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">current</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Status</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {STATUS_OPTIONS.map((status) => (
                      <label
                        key={status}
                        className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border p-2 text-xs font-medium transition-colors ${
                          newStatus === status ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/40'
                        } ${isSelf ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <input
                          type="radio"
                          name="status"
                          value={status}
                          checked={newStatus === status}
                          onChange={() => setNewStatus(status)}
                          disabled={isSelf}
                          className="hidden"
                        />
                        {status === 'ACTIVE' && '🟢'}
                        {status === 'SUSPENDED' && '🟡'}
                        {status === 'DEACTIVATED' && '🔴'}
                        {status.replace('_', ' ').toLowerCase()}
                      </label>
                    ))}
                  </div>
                  {newStatus !== 'ACTIVE' && newStatus !== user.status && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {newStatus === 'SUSPENDED'
                        ? 'Suspending invalidates active sessions and emails the user.'
                        : 'Deactivation invalidates active sessions; user keeps audit-history reference.'}
                    </p>
                  )}
                </div>

                {newRole === Role.RESIDENT && (
                  <>
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <ShieldCheck className="size-3" /> Teacher mentor
                      </p>
                      {mentorPick.length > 0 ? (
                        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-xs font-bold text-blue-700">
                            {mentorPick[0].name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{mentorPick[0].name}</div>
                            <div className="truncate text-xs text-muted-foreground">{mentorPick[0].email}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setMentorPick([])}
                            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                            aria-label="Clear teacher mentor"
                          >
                            <UserMinus className="size-4" />
                          </button>
                        </div>
                      ) : (
                        <UserPicker
                          single
                          role={Role.FACULTY}
                          excludeIds={[user.id]}
                          selected={mentorPick}
                          onChange={setMentorPick}
                          placeholder="Search teachers…"
                        />
                      )}
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Optional. Direct mentor for this student, independent of cohort.
                      </p>
                    </div>

                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <UsersIcon className="size-3" /> Cohort assignment
                      </p>
                      <select
                        value={cohortId ?? ''}
                        onChange={(e) => setCohortId(e.target.value || null)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">No cohort</option>
                        {cohorts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.academicYear ? ` · ${c.academicYear}` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Replaces existing cohort membership when saved. Use the cohort drawer for multi-cohort students.
                      </p>
                    </div>
                  </>
                )}

                {newRole === Role.FACULTY && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ShieldCheck className="size-3" /> Reports to (HOD)
                    </p>
                    {pdPick.length > 0 ? (
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-xs font-bold text-teal-700">
                          {pdPick[0].name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{pdPick[0].name}</div>
                          <div className="truncate text-xs text-muted-foreground">{pdPick[0].email}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPdPick([])}
                          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Clear HOD"
                        >
                          <UserMinus className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <UserPicker
                        single
                        role={Role.PROGRAM_DIRECTOR}
                        excludeIds={[user.id]}
                        selected={pdPick}
                        onChange={setPdPick}
                        placeholder="Search HODs…"
                      />
                    )}
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Optional. Saved when you click Save changes.
                    </p>
                  </div>
                )}

                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Reason (optional, recorded in audit log)</p>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. promoted to teacher after fellowship completion"
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-md bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-400">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-5 py-3">
            <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={submitting || loading}>
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {children}
    </button>
  )
}

function Field({
  label,
  icon: Icon,
  hint,
  children,
}: {
  label: string
  icon?: React.ElementType
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
