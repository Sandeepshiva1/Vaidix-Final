'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, UsersRound, UserMinus, Loader2, Pencil, Trash2, Save, GraduationCap } from 'lucide-react';
import { Role } from '@prisma/client';
import { UserPicker, type PickableUser } from '@/components/user-picker';

interface Member {
  user: { id: string; name: string; email: string; role: Role };
  addedAt: string;
}

interface FacultyRef {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface CohortDetail {
  id: string;
  name: string;
  description: string | null;
  academicYear: string | null;
  faculty: FacultyRef | null;
  members: Member[];
  _count: { members: number; sessions: number };
}

const ROLE_BADGE_BG: Record<string, string> = {
  RESIDENT:         'bg-violet-500/10 text-violet-700',
  FACULTY:          'bg-blue-500/10 text-blue-700',
  PROGRAM_DIRECTOR: 'bg-teal-500/10 text-teal-700',
  ADMIN:            'bg-slate-500/10 text-slate-700',
  EXTERNAL_LEARNER: 'bg-orange-500/10 text-orange-700',
};

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}
function humanRole(r: string): string {
  return r.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CohortDetailDrawer({
  cohortId,
  initialSection = 'members',
  onClose,
  onChanged,
  onDeleted,
  onRenamed,
}: {
  cohortId: string | null;
  /** Which section to open immediately when the drawer loads. */
  initialSection?: 'edit' | 'members';
  onClose: () => void;
  onChanged: (newMemberCount: number) => void;
  onDeleted: (cohortId: string) => void;
  onRenamed: (cohortId: string, patch: { name: string; description: string | null; academicYear: string | null; faculty: FacultyRef | null }) => void;
}) {
  const [data, setData]               = useState<CohortDetail | null>(null);
  const [loading, setLoading]         = useState(false);
  const [picker, setPicker]           = useState<PickableUser[]>([]);
  const [adding, setAdding]           = useState(false);
  const [removingId, setRemovingId]   = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);

  // Edit panel
  const [editing, setEditing]         = useState(false);
  const [editName, setEditName]       = useState('');
  const [editDesc, setEditDesc]       = useState('');
  const [editYear, setEditYear]       = useState('');
  const [savingEdit, setSavingEdit]   = useState(false);

  // Faculty mentor picker (inline, separate from edit panel)
  const [facultyPick, setFacultyPick] = useState<PickableUser[]>([]);
  const [savingFaculty, setSavingFaculty] = useState(false);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);

  async function load(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cohorts/${id}`);
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        setData(body.data.cohort);
      } else {
        const msg = body?.error?.message ?? `Server error (HTTP ${res.status})`;
        setError(msg);
        setData(null);
      }
    } catch {
      setError('Network error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Tracks whether to open edit mode once the data finishes loading.
  const pendingOpenEdit = useRef(false);

  useEffect(() => {
    if (!cohortId) {
      setData(null); setPicker([]); setFacultyPick([]); setEditing(false); setConfirmDelete(false);
      pendingOpenEdit.current = false;
      return;
    }
    pendingOpenEdit.current = initialSection === 'edit';
    void load(cohortId);
  }, [cohortId, initialSection]);

  // Fire openEdit() once data is available if the caller requested 'edit' section.
  useEffect(() => {
    if (data && pendingOpenEdit.current) {
      pendingOpenEdit.current = false;
      openEdit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function openEdit() {
    if (!data) return;
    setEditName(data.name);
    setEditDesc(data.description ?? '');
    setEditYear(data.academicYear ?? '');
    setEditing(true);
    setConfirmDelete(false);
  }

  async function handleSaveEdit() {
    if (!cohortId || editName.trim().length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         editName.trim(),
          description:  editDesc.trim(),
          academicYear: editYear.trim(),
        }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? 'Failed to save');
        return;
      }
      const c = body.data.cohort;
      onRenamed(cohortId, { name: c.name, description: c.description, academicYear: c.academicYear, faculty: c.faculty ?? null });
      setEditing(false);
      await load(cohortId);
    } catch {
      setError('Network error');
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveFaculty(facultyId: string | null) {
    if (!cohortId) return;
    setSavingFaculty(true);
    setError(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? 'Failed to update teacher mentor');
        return;
      }
      const c = body.data.cohort;
      onRenamed(cohortId, { name: c.name, description: c.description, academicYear: c.academicYear, faculty: c.faculty ?? null });
      await load(cohortId);
      setFacultyPick([]);
    } catch {
      setError('Network error');
    } finally {
      setSavingFaculty(false);
    }
  }

  async function handleDelete() {
    if (!cohortId) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}`, { method: 'DELETE' });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? 'Failed to delete');
        return;
      }
      onDeleted(cohortId);
      onClose();
    } catch {
      setError('Network error');
    } finally {
      setDeleting(false);
    }
  }

  async function handleAdd() {
    if (!cohortId || picker.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: picker.map((u) => u.id) }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? 'Failed to add members');
        return;
      }
      setPicker([]);
      await load(cohortId);
      const next = await fetch(`/api/cohorts/${cohortId}`).then((r) => r.json());
      if (next.ok) onChanged(next.data.cohort._count.members);
    } catch {
      setError('Network error');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    if (!cohortId) return;
    setRemovingId(userId);
    setError(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/members?userId=${userId}`, { method: 'DELETE' });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error?.message ?? 'Failed to remove member');
        return;
      }
      await load(cohortId);
      const next = await fetch(`/api/cohorts/${cohortId}`).then((r) => r.json());
      if (next.ok) onChanged(next.data.cohort._count.members);
    } catch {
      setError('Network error');
    } finally {
      setRemovingId(null);
    }
  }

  const open = !!cohortId;
  const existingIds = data?.members.map((m) => m.user.id) ?? [];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-lg flex-col bg-card shadow-2xl"
          >
            <header className="flex items-start justify-between border-b border-border px-6 py-5">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <UsersRound className="size-5 text-primary" />
                </div>
                <div className="min-w-0">
                  {loading || !data ? (
                    <div className="text-base font-bold text-muted-foreground">Loading…</div>
                  ) : (
                    <>
                      <h2 className="truncate text-lg font-bold tracking-tight text-foreground">{data.name}</h2>
                      <p className="text-xs text-muted-foreground">
                        {data._count.members} member{data._count.members === 1 ? '' : 's'}
                        {data.academicYear && ` · ${data.academicYear}`}
                        {data.faculty && ` · mentored by ${data.faculty.name}`}
                        {data._count.sessions > 0 && ` · ${data._count.sessions} session${data._count.sessions === 1 ? '' : 's'}`}
                      </p>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {data && !editing && (
                  <>
                    <button
                      onClick={openEdit}
                      className="rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                      title="Edit cohort"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => { setConfirmDelete(true); setEditing(false); }}
                      className="rounded-xl p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                      title="Delete cohort"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="rounded-xl p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {error && (
                <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              {/* Edit panel */}
              {editing && data && (
                <section className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-primary">
                    Edit cohort details
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Name *</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={100}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                        placeholder="e.g. PGY-1 Students 2026"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Academic year</label>
                      <input
                        type="text"
                        value={editYear}
                        onChange={(e) => setEditYear(e.target.value)}
                        maxLength={20}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                        placeholder="2026–27"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">Description</label>
                      <textarea
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        maxLength={500}
                        rows={2}
                        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={savingEdit}
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                      >
                        {savingEdit ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                        Save changes
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* Delete confirm */}
              {confirmDelete && data && (
                <section className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
                  <h3 className="text-sm font-bold text-destructive">Delete &quot;{data.name}&quot;?</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This soft-deletes the cohort. {data._count.members > 0 && `Its ${data._count.members} member assignment${data._count.members === 1 ? '' : 's'} will also disappear.`}
                    {data._count.sessions > 0 && ` ${data._count.sessions} past session${data._count.sessions === 1 ? '' : 's'} that referenced this cohort will keep working.`}
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground transition hover:opacity-90 disabled:opacity-60"
                    >
                      {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      Delete cohort
                    </button>
                  </div>
                </section>
              )}

              {/* Faculty mentor */}
              {!editing && !confirmDelete && data && (
                <section className="mb-6">
                  <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                    <GraduationCap className="size-3" /> Teacher mentor
                  </h3>
                  {data.faculty ? (
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-xs font-bold text-blue-700">
                        {initials(data.faculty.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{data.faculty.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{data.faculty.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveFaculty(null)}
                        disabled={savingFaculty}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        title="Clear teacher mentor"
                      >
                        {savingFaculty ? <Loader2 className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
                      </button>
                    </div>
                  ) : (
                    <>
                      <UserPicker
                        single
                        role={Role.FACULTY}
                        selected={facultyPick}
                        onChange={(next) => {
                          setFacultyPick(next);
                          if (next.length > 0) void saveFaculty(next[0].id);
                        }}
                        placeholder="Search teachers…"
                      />
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Optional. Pick one teacher who mentors this cohort.
                      </p>
                    </>
                  )}
                </section>
              )}

              {/* Add members */}
              {!editing && !confirmDelete && (
                <section className="mb-6">
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                    Add members
                  </h3>
                  <UserPicker
                    selected={picker}
                    onChange={setPicker}
                    excludeIds={existingIds}
                    placeholder="Search students, teachers, or anyone…"
                  />
                  {picker.length > 0 && (
                    <button
                      type="button"
                      onClick={handleAdd}
                      disabled={adding}
                      className="mt-3 flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-60"
                    >
                      {adding && <Loader2 className="size-4 animate-spin" />}
                      Add {picker.length} member{picker.length === 1 ? '' : 's'}
                    </button>
                  )}
                </section>
              )}

              {/* Current members */}
              <section>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Current members
                </h3>
                {loading ? (
                  <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading…
                  </div>
                ) : !data || data.members.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                    No members yet — add some above
                  </div>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                    {data.members.map((m) => (
                      <li key={m.user.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {initials(m.user.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-foreground">{m.user.name}</span>
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${ROLE_BADGE_BG[m.user.role]}`}>
                              {humanRole(m.user.role)}
                            </span>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{m.user.email}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemove(m.user.id)}
                          disabled={removingId === m.user.id}
                          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          title="Remove from cohort"
                        >
                          {removingId === m.user.id
                            ? <Loader2 className="size-4 animate-spin" />
                            : <UserMinus className="size-4" />
                          }
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
