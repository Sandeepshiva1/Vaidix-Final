'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Copy, RefreshCw, Ban, Trash2, ExternalLink, Check, Pencil } from 'lucide-react';

interface InvitationDetail {
  id: string;
  email: string;
  fullName: string | null;
  mobile: string | null;
  mciRegNumber: string | null;
  role: string;
  subspecialty: string | null;
  department: string | null;
  yearOfResidency: number | null;
  moduleOverrides: unknown;
  token: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  resendCount: number;
  lastResentAt: string | null;
  createdAt: string;
  invitedBy: { id: string; name: string; email: string };
}

interface TimelineEvent {
  eventType: string;
  summary: string | null;
  success: boolean;
  createdAt: string;
}

export function InvitationDrawer({
  invitationId,
  onClose,
  onCopyLink,
  onEdit,
  onResend,
  onRevoke,
  onDelete,
}: {
  invitationId: string | null;
  onClose: () => void;
  onCopyLink: (token: string) => void;
  onEdit?: (id: string) => void;
  onResend: (id: string) => Promise<void> | void;
  onRevoke: (id: string, email: string) => void;
  onDelete: (id: string, email: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ invitation: InvitationDetail; timeline: TimelineEvent[] } | null>(null);

  useEffect(() => {
    if (!invitationId) {
      setData(null);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/invitations/${invitationId}`);
        const body = await res.json();
        if (body.ok) setData(body.data);
      } finally {
        setLoading(false);
      }
    })();
  }, [invitationId]);

  const open = !!invitationId;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-md flex-col bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-lg font-bold text-slate-900">Invitation details</h2>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-5" />
              </button>
            </header>

            {loading || !data ? (
              <div className="flex flex-1 items-center justify-center text-slate-400">Loading...</div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  {/* Status pill */}
                  <StatusPill status={data.invitation.status} />

                  <h3 className="mt-4 text-xl font-bold text-slate-900">
                    {data.invitation.fullName ?? data.invitation.email}
                  </h3>
                  <p className="text-sm text-slate-500">{data.invitation.email}</p>

                  {/* Details */}
                  <dl className="mt-6 space-y-3">
                    <DetailRow label="Role" value={humanRole(data.invitation.role)} />
                    {data.invitation.subspecialty && (
                      <DetailRow label="Subspecialty" value={data.invitation.subspecialty} />
                    )}
                    {data.invitation.department && (
                      <DetailRow label="Department" value={data.invitation.department} />
                    )}
                    {data.invitation.yearOfResidency !== null && (
                      <DetailRow label="Year" value={`PGY-${data.invitation.yearOfResidency}`} />
                    )}
                    {data.invitation.mobile && <DetailRow label="Mobile" value={data.invitation.mobile} />}
                    {data.invitation.mciRegNumber && (
                      <DetailRow label="MCI Reg" value={data.invitation.mciRegNumber} />
                    )}
                    <DetailRow
                      label="Invited by"
                      value={`${data.invitation.invitedBy.name} (${data.invitation.invitedBy.email})`}
                    />
                    <DetailRow label="Expires" value={new Date(data.invitation.expiresAt).toLocaleString()} />
                    {data.invitation.resendCount > 0 && (
                      <DetailRow label="Resent" value={`${data.invitation.resendCount} time(s)`} />
                    )}
                  </dl>

                  {/* Magic link */}
                  {data.invitation.status === 'PENDING' && (
                    <div className="mt-6">
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                        Magic link
                      </div>
                      <MagicLinkRow token={data.invitation.token} onCopy={onCopyLink} />
                    </div>
                  )}

                  {/* Timeline */}
                  <div className="mt-6">
                    <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Timeline
                    </div>
                    <ol className="relative ml-3 space-y-3 border-l border-slate-200 pl-5">
                      {data.timeline.map((ev, idx) => (
                        <li key={idx} className="relative">
                          <span
                            className={`absolute -left-[28px] size-3 rounded-full border-2 ${
                              ev.success ? 'border-teal-500 bg-white' : 'border-red-500 bg-white'
                            }`}
                          />
                          <div className="text-xs font-semibold text-slate-900">
                            {prettyEventType(ev.eventType)}
                          </div>
                          <div className="text-xs text-slate-500">{ev.summary}</div>
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            {new Date(ev.createdAt).toLocaleString()}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                {/* Actions */}
                <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-6 py-4">
                  {data.invitation.status === 'PENDING' && onEdit && (
                    <button
                      onClick={() => onEdit(data.invitation.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
                    >
                      <Pencil className="size-4" /> Edit
                    </button>
                  )}
                  {(data.invitation.status === 'PENDING' || data.invitation.status === 'EXPIRED') && (
                    <button
                      onClick={() => onResend(data.invitation.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-100"
                    >
                      <RefreshCw className="size-4" /> Resend
                    </button>
                  )}
                  {data.invitation.status !== 'ACCEPTED' && (
                    <>
                      <button
                        onClick={() => onRevoke(data.invitation.id, data.invitation.email)}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                      >
                        <Ban className="size-4" /> Revoke
                      </button>
                      <button
                        onClick={() => onDelete(data.invitation.id, data.invitation.email)}
                        className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="size-4" /> Delete
                      </button>
                    </>
                  )}
                </footer>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { label: string; bg: string; text: string }> = {
    PENDING:  { label: 'Invited — waiting acceptance', bg: 'bg-amber-100', text: 'text-amber-800' },
    ACCEPTED: { label: 'Registered & active',          bg: 'bg-green-100', text: 'text-green-800' },
    EXPIRED:  { label: 'Expired',                       bg: 'bg-slate-200', text: 'text-slate-700' },
    REVOKED:  { label: 'Revoked',                       bg: 'bg-red-100',   text: 'text-red-800' },
  };
  const c = cfg[status] ?? cfg.PENDING;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${c.bg} ${c.text}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function MagicLinkRow({ token, onCopy }: { token: string; onCopy: (token: string) => void }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}/invitations/${token}` : '';
  return (
    <div className="flex items-stretch gap-2">
      <div className="flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <div className="truncate font-mono">{url}</div>
      </div>
      <button
        onClick={() => {
          onCopy(token);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        title="Open in new tab"
      >
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

function prettyEventType(t: string): string {
  const map: Record<string, string> = {
    'invitation.created':  'Invitation created',
    'invitation.sent':     'Email delivered',
    'invitation.resent':   'Invitation re-sent',
    'invitation.updated':  'Invitation edited',
    'invitation.revoked':  'Revoked',
    'invitation.deleted':  'Deleted',
    'invitation.accepted': 'Accepted',
    'invitation.expired':  'Expired',
  };
  return map[t] ?? t;
}

function humanRole(role: string): string {
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
