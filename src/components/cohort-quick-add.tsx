'use client';

// ════════════════════════════════════════════════════════════════════════════
// CohortQuickAdd — one-click "add all members of cohort X" shortcut
// ════════════════════════════════════════════════════════════════════════════
// Sits above the UserPicker on the session-create form. Lists all cohorts
// as chips; clicking one fetches its members and merges them into the
// picker's selected list (deduplicated). Lets a PD invite "PGY-1 2026"
// in one click instead of picking 12 residents one by one.

import { useEffect, useState } from 'react';
import { UsersRound, Loader2, Plus } from 'lucide-react';
import type { PickableUser } from './user-picker';

interface CohortSummary {
  id: string;
  name: string;
  academicYear: string | null;
  memberCount: number;
}

interface Props {
  selected: PickableUser[];
  onChange: (next: PickableUser[]) => void;
}

export function CohortQuickAdd({ selected, onChange }: Props) {
  const [cohorts, setCohorts]   = useState<CohortSummary[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/cohorts');
        const body = await res.json();
        if (cancelled) return;
        if (body.ok) {
          setCohorts(
            body.data.cohorts.map((c: { id: string; name: string; academicYear: string | null; _count: { members: number } }) => ({
              id:           c.id,
              name:         c.name,
              academicYear: c.academicYear,
              memberCount:  c._count.members,
            }))
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function expand(cohortId: string) {
    setExpandingId(cohortId);
    setError(null);
    try {
      const res = await fetch(`/api/cohorts/${cohortId}`);
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body?.error?.message ?? `Failed to load cohort (HTTP ${res.status})`);
        return;
      }
      const members = body.data.cohort.members as Array<{
        user: { id: string; name: string; email: string; role: PickableUser['role']; avatarUrl?: string | null };
      }>;
      const newUsers: PickableUser[] = members.map((m) => ({
        id:        m.user.id,
        name:      m.user.name,
        email:     m.user.email,
        role:      m.user.role,
        avatarUrl: m.user.avatarUrl ?? null,
      }));
      const existingIds = new Set(selected.map((u) => u.id));
      const merged = [...selected, ...newUsers.filter((u) => !existingIds.has(u.id))];
      onChange(merged);
    } catch {
      setError('Network error loading cohort members');
    } finally {
      setExpandingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading cohorts…
      </div>
    );
  }

  if (cohorts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No cohorts yet — create one in <span className="font-medium">Admin → Cohorts</span> to invite groups in one click.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <UsersRound className="size-3.5 text-muted-foreground" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Quick-add a cohort
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cohorts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => expand(c.id)}
            disabled={expandingId === c.id || c.memberCount === 0}
            title={c.memberCount === 0 ? 'No members in this cohort' : `Add all ${c.memberCount} members`}
            className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-card px-3 py-1 text-xs font-semibold text-foreground transition hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {expandingId === c.id ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3 text-primary" />}
            <span>{c.name}</span>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              {c.memberCount}
            </span>
            {c.academicYear && (
              <span className="text-[10px] font-normal text-muted-foreground">{c.academicYear}</span>
            )}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
