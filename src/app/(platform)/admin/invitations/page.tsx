'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Mail,
  Search,
  UserPlus,
  RefreshCw,
  Trash2,
  MoreHorizontal,
  CircleDashed,
  CheckCircle2,
  Clock,
  Ban,
  Pencil,
  FileSpreadsheet,
} from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Role } from '@prisma/client';
import { InviteModal, type InviteModalEditData } from './_components/invite-modal';
import { InvitationDrawer } from './_components/invitation-drawer';
import { ConfirmDialog } from './_components/confirm-dialog';

type Status = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

interface InvitationRow {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  subspecialty: string | null;
  department: string | null;
  status: Status;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  resendCount: number;
  lastResentAt: string | null;
  createdAt: string;
  invitedBy: { id: string; name: string; email: string };
}

interface Summary {
  total: number;
  pending: number;
  accepted: number;
  expired: number;
  revoked: number;
}

const STATUS_CONFIG: Record<Status, { label: string; dot: string; text: string; icon: typeof CircleDashed }> = {
  PENDING: { label: 'Invited', dot: 'bg-amber-500', text: 'text-amber-700', icon: CircleDashed },
  ACCEPTED: { label: 'Registered', dot: 'bg-green-500', text: 'text-green-700', icon: CheckCircle2 },
  EXPIRED: { label: 'Expired', dot: 'bg-slate-400', text: 'text-slate-600', icon: Clock },
  REVOKED: { label: 'Revoked', dot: 'bg-red-500', text: 'text-red-700', icon: Ban },
};

export default function InvitationsPage() {
  const [rows, setRows] = useState<InvitationRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, pending: 0, accepted: 0, expired: 0, revoked: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<Status | ''>('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<InviteModalEditData | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    kind: 'revoke' | 'delete';
    id: string;
    email: string;
  } | null>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);

  // `silent` skips the loading placeholder so the table doesn't flicker
  // during the 15s background poll. User-initiated fetches still show it.
  async function fetchList(silent = false) {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (roleFilter) params.set('role', roleFilter);
    if (search) params.set('search', search);
    params.set('limit', '100');
    try {
      const res = await fetch(`/api/invitations?${params.toString()}`);
      const body = await res.json();
      if (body.ok) {
        setRows(body.data.invitations);
        setSummary(body.data.summary);
      } else {
        setToast({ kind: 'error', msg: body.error?.message ?? 'Failed to load invitations' });
      }
    } catch {
      if (!silent) setToast({ kind: 'error', msg: 'Network error' });
    }
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, roleFilter]);

  useEffect(() => {
    const t = setTimeout(fetchList, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Auto-refresh while pending invitations exist so admins see "Registered"
  // appear without manual reload once the invitee completes acceptance.
  useEffect(() => {
    if (summary.pending === 0) return;
    const interval = setInterval(() => {
      void fetchList(true); // silent refresh — no flicker
    }, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.pending, statusFilter, roleFilter, search]);

  async function openEdit(id: string) {
    setEditLoadingId(id);
    try {
      const res = await fetch(`/api/invitations/${id}`);
      const body = await res.json();
      if (!body.ok) {
        setToast({ kind: 'error', msg: body.error?.message ?? 'Failed to load invitation' });
        return;
      }
      const inv = body.data.invitation;
      if (inv.status !== 'PENDING') {
        setToast({ kind: 'error', msg: 'Only pending invitations can be edited' });
        return;
      }
      setEditing({
        id: inv.id,
        fullName: inv.fullName,
        email: inv.email,
        mobile: inv.mobile,
        mciRegNumber: inv.mciRegNumber,
        role: inv.role,
        subspecialty: inv.subspecialty,
        department: inv.department,
        yearOfResidency: inv.yearOfResidency,
        moduleOverrides: inv.moduleOverrides ?? null,
        expiresAt: inv.expiresAt,
        programDirectorId: inv.programDirectorId ?? null,
        programDirector: inv.programDirector ?? null,
        cohortId: inv.cohortId ?? null,
        cohort: inv.cohort ?? null,
        facultyMentorId: inv.facultyMentorId ?? null,
        facultyMentor: inv.facultyMentor ?? null,
        avatarUrl: inv.avatarUrl ?? null,
        gender: inv.gender ?? null,
      });
      setSelectedId(null);
    } catch {
      setToast({ kind: 'error', msg: 'Network error loading invitation' });
    } finally {
      setEditLoadingId(null);
    }
  }

  const filteredRows = useMemo(() => rows, [rows]);

  async function handleResend(id: string) {
    setActionRunning(true);
    try {
      const res = await fetch(`/api/invitations/${id}/resend`, { method: 'POST' });
      const body = await res.json();
      if (body.ok) {
        setToast({ kind: 'success', msg: 'Invitation re-sent' });
        await fetchList();
      } else {
        setToast({ kind: 'error', msg: body.error?.message ?? 'Failed to resend' });
      }
    } catch {
      setToast({ kind: 'error', msg: 'Network error' });
    }
    setActionRunning(false);
  }

  async function handleRevoke(id: string) {
    setActionRunning(true);
    try {
      const res = await fetch(`/api/invitations/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (body.ok) {
        setToast({ kind: 'success', msg: 'Invitation revoked' });
        setPendingAction(null);
        await fetchList();
      } else {
        setToast({ kind: 'error', msg: body.error?.message ?? 'Failed to revoke' });
      }
    } catch {
      setToast({ kind: 'error', msg: 'Network error' });
    }
    setActionRunning(false);
  }

  async function handleDelete(id: string) {
    setActionRunning(true);
    try {
      const res = await fetch(`/api/invitations/${id}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await res.json();
      if (body.ok) {
        setToast({ kind: 'success', msg: 'Invitation permanently deleted' });
        setPendingAction(null);
        await fetchList();
      } else {
        setToast({ kind: 'error', msg: body.error?.message ?? 'Failed to delete' });
      }
    } catch {
      setToast({ kind: 'error', msg: 'Network error' });
    }
    setActionRunning(false);
  }

  async function handleCopyLink(token: string) {
    const url = `${window.location.origin}/invitations/${token}`;
    await navigator.clipboard.writeText(url);
    setToast({ kind: 'success', msg: 'Invitation link copied' });
  }

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Admin &middot; Invitations
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
            Invitations queue
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Invite faculty and residents, track acceptance, manage access.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/invitations/bulk"
            data-testid="bulk-invite-link"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <FileSpreadsheet className="size-4" /> Bulk import
          </Link>
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-linear-to-br from-teal-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-teal-500/20 transition hover:shadow-xl"
          >
            <UserPlus className="size-4" /> Invite user
          </button>
        </div>
      </header>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard label="Total" value={summary.total} active={!statusFilter} onClick={() => setStatusFilter('')} />
        <SummaryCard
          label="Invited"
          value={summary.pending}
          tint="amber"
          active={statusFilter === 'PENDING'}
          onClick={() => setStatusFilter('PENDING')}
        />
        <SummaryCard
          label="Registered"
          value={summary.accepted}
          tint="green"
          active={statusFilter === 'ACCEPTED'}
          onClick={() => setStatusFilter('ACCEPTED')}
        />
        <SummaryCard
          label="Expired"
          value={summary.expired}
          tint="slate"
          active={statusFilter === 'EXPIRED'}
          onClick={() => setStatusFilter('EXPIRED')}
        />
        <SummaryCard
          label="Revoked"
          value={summary.revoked}
          tint="red"
          active={statusFilter === 'REVOKED'}
          onClick={() => setStatusFilter('REVOKED')}
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative flex-1 min-w-55">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | '')}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
        >
          <option value="">All roles</option>
          <option value="RESIDENT">Student</option>
          <option value="FACULTY">Teacher</option>
          <option value="PROGRAM_DIRECTOR">HOD</option>
          <option value="ADMIN">Admin</option>
          <option value="EXTERNAL_LEARNER">External Learner</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-slate-400">Loading invitations...</div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
            <Mail className="size-12 opacity-40" />
            <p className="text-sm">No invitations yet</p>
            <button
              onClick={() => setInviteOpen(true)}
              className="mt-2 text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              Send the first invitation &rarr;
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Dept</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const cfg = STATUS_CONFIG[row.status];
                  const canResend = row.status === 'PENDING' || row.status === 'EXPIRED';
                  const canDelete = row.status !== 'ACCEPTED';
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 transition hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelectedId(row.id)}
                          className="font-semibold text-slate-900 hover:text-teal-600"
                        >
                          {row.fullName ?? '—'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.email}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {humanRole(row.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{row.department ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 font-medium ${cfg.text}`}>
                          <span className={`size-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{relativeTime(row.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {row.status === 'PENDING' && (
                            <ActionBtn
                              onClick={() => openEdit(row.id)}
                              disabled={actionRunning || editLoadingId === row.id}
                              title="Edit"
                              icon={Pencil}
                            />
                          )}
                          {canResend && (
                            <ActionBtn
                              onClick={() => handleResend(row.id)}
                              disabled={actionRunning}
                              title="Resend"
                              icon={RefreshCw}
                            />
                          )}
                          {canDelete && (
                            <>
                              <ActionBtn
                                onClick={() =>
                                  setPendingAction({ kind: 'revoke', id: row.id, email: row.email })
                                }
                                disabled={actionRunning}
                                title="Revoke"
                                icon={Ban}
                              />
                              <ActionBtn
                                onClick={() =>
                                  setPendingAction({ kind: 'delete', id: row.id, email: row.email })
                                }
                                disabled={actionRunning}
                                title="Delete"
                                icon={Trash2}
                                danger
                              />
                            </>
                          )}
                          <ActionBtn
                            onClick={() => setSelectedId(row.id)}
                            title="View details"
                            icon={MoreHorizontal}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals / Drawers */}
      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => {
          setInviteOpen(false);
          setToast({ kind: 'success', msg: 'Invitation sent' });
          fetchList();
        }}
      />

      <InviteModal
        open={!!editing}
        edit={editing ?? undefined}
        onClose={() => setEditing(null)}
        onCreated={() => {
          setEditing(null);
          setToast({ kind: 'success', msg: 'Invitation updated' });
          fetchList();
        }}
      />

      <InvitationDrawer
        invitationId={selectedId}
        onClose={() => setSelectedId(null)}
        onCopyLink={handleCopyLink}
        onEdit={openEdit}
        onResend={handleResend}
        onRevoke={(id, email) => setPendingAction({ kind: 'revoke', id, email })}
        onDelete={(id, email) => setPendingAction({ kind: 'delete', id, email })}
      />

      <ConfirmDialog
        open={pendingAction?.kind === 'revoke'}
        title="Revoke invitation?"
        description={
          <>
            The invitation for <strong>{pendingAction?.email}</strong> will be marked as revoked.
            The record stays for audit, but the invite link will stop working.
          </>
        }
        confirmLabel="Revoke"
        confirmTone="warning"
        busy={actionRunning}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => pendingAction && handleRevoke(pendingAction.id)}
      />

      <ConfirmDialog
        open={pendingAction?.kind === 'delete'}
        title="Delete invitation permanently?"
        description={
          <>
            This removes <strong>{pendingAction?.email}</strong>&rsquo;s invitation record entirely.
            An audit event will still be logged. This cannot be undone.
          </>
        }
        confirmLabel="Delete forever"
        confirmTone="danger"
        busy={actionRunning}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => pendingAction && handleDelete(pendingAction.id)}
      />

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`fixed bottom-6 right-6 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.msg}
        </motion.div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tint = 'teal',
  active,
  onClick,
}: {
  label: string;
  value: number;
  tint?: 'teal' | 'amber' | 'green' | 'slate' | 'red';
  active?: boolean;
  onClick: () => void;
}) {
  const tints: Record<string, string> = {
    teal: 'border-teal-200 bg-teal-50 text-teal-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    green: 'border-green-200 bg-green-50 text-green-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-800',
    red: 'border-red-200 bg-red-50 text-red-900',
  };
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition hover:scale-[1.02] ${
        active ? tints[tint] + ' ring-2 ring-current ring-offset-2' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="text-2xl font-black">{value}</div>
      <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide opacity-80">{label}</div>
    </button>
  );
}

function ActionBtn({
  onClick,
  disabled,
  title,
  icon: Icon,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: typeof RefreshCw;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg p-1.5 transition disabled:opacity-40 ${
        danger
          ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      <Icon className="size-4" />
    </button>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function humanRole(role: string): string {
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
