'use client';

// ════════════════════════════════════════════════════════════════════════════
// UserPicker — searchable multi-select for users
// ════════════════════════════════════════════════════════════════════════════
// Shared by /admin/cohorts (member add) and /calendar/new (INVITE_ONLY).
// Hits GET /api/users/searchable with role + search + excludeIds.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, Loader2 } from 'lucide-react';
import type { Role } from '@prisma/client';

export interface PickableUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
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

interface Props {
  selected: PickableUser[];
  onChange: (next: PickableUser[]) => void;
  /** Filter results to a single role (e.g. only RESIDENT). Omit for all roles. */
  role?: Role;
  /** User IDs to never show in results (e.g. existing members). */
  excludeIds?: string[];
  placeholder?: string;
  /**
   * Single-select mode. Picking a user replaces the current selection rather
   * than appending. The chip strip stays visible (so the user can clear) but
   * caps at 1.
   */
  single?: boolean;
  /**
   * Search context — drives the API auth gate.
   *   'invite' — any authenticated user with an active program (results
   *              scoped to that program). Use for session-invite pickers.
   *   'cohort' — ADMIN / PROGRAM_DIRECTOR only, returns global directory.
   *              Use for cohort-membership and admin pickers.
   * Defaults to 'cohort' to fail closed if a caller forgets to declare intent.
   */
  purpose?: 'invite' | 'cohort';
}

export function UserPicker({ selected, onChange, role, excludeIds = [], placeholder, single = false, purpose = 'cohort' }: Props) {
  const [search, setSearch]       = useState('');
  const [results, setResults]     = useState<PickableUser[]>([]);
  const [loading, setLoading]     = useState(false);
  const [showResults, setShowResults] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Pixel-position the portalled dropdown. Recomputed on open + on scroll /
  // resize so it tracks the input even inside scrollable containers.
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0, openUp: false });
  const PANEL_MAX_H = 288; // matches max-h-72 below
  const mounted = useMounted();

  const allExcluded = useMemo(
    () => [...excludeIds, ...selected.map((u) => u.id)],
    [excludeIds, selected]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set('purpose', purpose);
        if (role)                  params.set('role', role);
        if (search.trim())         params.set('search', search.trim());
        if (allExcluded.length > 0) params.set('excludeIds', allExcluded.join(','));
        params.set('limit', '20');
        const res = await fetch(`/api/users/searchable?${params.toString()}`);
        const body = await res.json();
        if (cancelled) return;
        if (body.ok) setResults(body.data.users);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, role, allExcluded, purpose]);

  // Click-outside collapses the results dropdown. The dropdown lives in a
  // portal (so it can escape parent overflow / clipping cards), so we have
  // to check both the trigger container AND the floating panel.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setShowResults(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Position the floating panel under the input. Re-runs on scroll / resize
  // so the dropdown stays anchored even inside scrollable cards. Skips the
  // work entirely while the panel is closed.
  useEffect(() => {
    if (!showResults) return;
    function reposition() {
      const el = inputWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      // Only open upward if there's genuinely very little space below (< 120px)
      // AND more room above — avoids flipping mid-form where the page can scroll.
      const openUp = spaceBelow < 120 && spaceAbove > spaceBelow + 80;
      const top = openUp ? Math.max(8, r.top - PANEL_MAX_H - 6) : r.bottom + 6;
      setPanelPos({ top, left: r.left, width: r.width, openUp });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [showResults]);

  function add(u: PickableUser) {
    if (selected.some((s) => s.id === u.id)) return;
    onChange(single ? [u] : [...selected, u]);
    setSearch('');
    setShowResults(false);
  }

  function remove(id: string) {
    onChange(selected.filter((u) => u.id !== id));
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 py-1 pl-2 pr-1 text-xs font-medium text-foreground"
            >
              <span>{u.name}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${ROLE_BADGE_BG[u.role]}`}>
                {humanRole(u.role)}
              </span>
              <button
                type="button"
                onClick={() => remove(u.id)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${u.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search input */}
      <div ref={inputWrapRef} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShowResults(true); }}
          onFocus={() => setShowResults(true)}
          placeholder={placeholder ?? 'Search by name or email…'}
          className="w-full rounded-xl border-2 border-input bg-card px-3.5 py-2.5 pl-10 text-sm font-medium text-foreground outline-none transition-all placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-primary focus:shadow-[0_0_0_4px_oklch(0.45_0.15_165/0.12)]"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Results dropdown — portalled to <body> with fixed positioning so it
          escapes the audience-card's overflow clipping (was getting cut off
          and its background bled with the parent card colour, making the
          TOPIC label below look like it sat inside the dropdown). */}
      {mounted && showResults &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 9999,
            }}
            className="max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-2xl shadow-black/15"
          >
            {results.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {loading ? 'Searching…' : search ? 'No matching users' : 'Start typing to search'}
              </div>
            ) : (
              <ul className="py-1">
                {results.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => add(u)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {initials(u.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-foreground">{u.name}</span>
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${ROLE_BADGE_BG[u.role]}`}>
                            {humanRole(u.role)}
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      </div>
                      <Check className="size-4 shrink-0 text-primary opacity-0 transition group-hover:opacity-100" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

// `useSyncExternalStore` is the React-blessed way to flip a value between
// SSR and client without tripping the hydration mismatch warning. Here we
// only render the portal post-hydration so document.body exists.
const NO_OP = (): (() => void) => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(NO_OP, () => true, () => false);
}
