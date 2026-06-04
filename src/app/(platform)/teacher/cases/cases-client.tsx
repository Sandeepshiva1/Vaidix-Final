'use client';

// ════════════════════════════════════════════════════════════════════════════
// FacultyCasesClient — "My cases" library
// ════════════════════════════════════════════════════════════════════════════
// Three groups: Drafts (forged but unpublished), Published (in program
// bank), Archived. Empty-state pushes faculty toward /teacher/documents
// (forge from a doc) or hand-authoring (post-Phase-4 enhancement).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Stethoscope,
  Sparkles,
  AlertTriangle,
  FileText,
  Search,
  Globe,
  Lock,
  Archive,
  ChevronRight,
  Clock,
} from 'lucide-react';
import {
  type CaseDifficulty,
  type CaseTemplateStatus,
} from '@prisma/client';

interface CaseRow {
  id: string;
  title: string;
  condition: string;
  status: CaseTemplateStatus;
  difficulty: CaseDifficulty;
  bloomsLevel: number;
  estimatedMinutes: number;
  forgedAt: string | null;
  publishedAt: string | null;
  sourceDocumentId: string | null;
  isEmergency: boolean;
  tags: string[];
}

interface Props {
  cases: CaseRow[];
}

const STATUS_TONE: Record<CaseTemplateStatus, string> = {
  DRAFT: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PUBLISHED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ARCHIVED: 'border-border bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<CaseTemplateStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

const STATUS_ICON: Record<CaseTemplateStatus, React.ComponentType<{ className?: string }>> = {
  DRAFT: Lock,
  PUBLISHED: Globe,
  ARCHIVED: Archive,
};

const DIFFICULTY_TONE: Record<CaseDifficulty, string> = {
  BEGINNER: 'text-emerald-600 dark:text-emerald-400',
  INTERMEDIATE: 'text-amber-600 dark:text-amber-400',
  ADVANCED: 'text-rose-600 dark:text-rose-400',
};

function relativeFrom(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function FacultyCasesClient({ cases }: Props) {
  const [filter, setFilter] = useState<'all' | CaseTemplateStatus>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let rows = cases;
    if (filter !== 'all') rows = rows.filter((c) => c.status === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.condition.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [cases, filter, query]);

  const counts = useMemo(
    () => ({
      all: cases.length,
      DRAFT: cases.filter((c) => c.status === 'DRAFT').length,
      PUBLISHED: cases.filter((c) => c.status === 'PUBLISHED').length,
      ARCHIVED: cases.filter((c) => c.status === 'ARCHIVED').length,
    }),
    [cases],
  );

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
      className="mx-auto max-w-6xl space-y-6 px-6 py-8"
      data-testid="faculty-cases"
    >
      {/* Header */}
      <motion.header
        variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
        className="space-y-2"
      >
        <h1 className="text-2xl font-semibold tracking-tight">My cases</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cases you&apos;ve forged from documents or authored. Drafts are private — publish to add
          them to the program case bank.
        </p>
      </motion.header>

      {/* Empty state */}
      {cases.length === 0 ? (
        <motion.div
          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
          className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center"
        >
          <Stethoscope className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="mb-1 text-lg font-semibold">No cases yet</h2>
          <p className="mx-auto mb-5 max-w-md text-sm text-muted-foreground">
            Upload a document, then click <span className="font-medium">Forge case</span>. AI drafts
            a Socratic 5-stage case keyed to your source — you refine, then publish.
          </p>
          <Link
            href="/teacher/documents"
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            <FileText className="h-4 w-4" />
            Open document library
          </Link>
        </motion.div>
      ) : (
        <>
          {/* Toolbar */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
            className="flex flex-wrap items-center gap-2"
          >
            <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} count={counts.all}>
              All
            </FilterPill>
            <FilterPill
              active={filter === 'DRAFT'}
              onClick={() => setFilter('DRAFT')}
              count={counts.DRAFT}
            >
              <Lock className="h-3 w-3" /> Drafts
            </FilterPill>
            <FilterPill
              active={filter === 'PUBLISHED'}
              onClick={() => setFilter('PUBLISHED')}
              count={counts.PUBLISHED}
            >
              <Globe className="h-3 w-3" /> Published
            </FilterPill>
            <FilterPill
              active={filter === 'ARCHIVED'}
              onClick={() => setFilter('ARCHIVED')}
              count={counts.ARCHIVED}
            >
              <Archive className="h-3 w-3" /> Archived
            </FilterPill>
            <div className="relative ml-auto w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, condition, tag…"
                className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-xs"
              />
            </div>
          </motion.section>

          {/* List */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
            className="space-y-2"
          >
            {filtered.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No cases match. Try clearing the filters.
              </p>
            ) : (
              <ul className="space-y-2">
                <AnimatePresence initial={false}>
                  {filtered.map((c, idx) => (
                    <CaseCard key={c.id} c={c} index={idx} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </motion.section>
        </>
      )}
    </motion.div>
  );
}

function FilterPill({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
      <span className={`text-[10px] ${active ? 'text-background/70' : 'text-muted-foreground'}`}>
        {count}
      </span>
    </button>
  );
}

function CaseCard({ c, index }: { c: CaseRow; index: number }) {
  const StatusIcon = STATUS_ICON[c.status];
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.04 }}
    >
      <Link
        href={`/teacher/cases/${c.id}/edit`}
        className="group flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card/60 p-4 transition hover:border-foreground/20 hover:bg-card"
        data-testid={`case-row-${c.id}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[c.status]}`}
            >
              <StatusIcon className="h-2.5 w-2.5" />
              {STATUS_LABEL[c.status]}
            </span>
            {c.isEmergency && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-2.5 w-2.5" /> Emergency
              </span>
            )}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className={DIFFICULTY_TONE[c.difficulty]}>
                {c.difficulty.toLowerCase()}
              </span>
              {' · '}
              Bloom {c.bloomsLevel}
            </span>
            {c.sourceDocumentId && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Sparkles className="h-2.5 w-2.5 text-amber-500" /> AI-forged
              </span>
            )}
          </div>

          <h3 className="mt-1.5 truncate text-sm font-semibold">{c.title}</h3>
          <p className="text-xs text-muted-foreground">{c.condition}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {c.estimatedMinutes} min
            </span>
            {c.forgedAt && (
              <>
                <span>·</span>
                <span>Forged {relativeFrom(c.forgedAt)}</span>
              </>
            )}
            {c.publishedAt && (
              <>
                <span>·</span>
                <span>Published {relativeFrom(c.publishedAt)}</span>
              </>
            )}
            {c.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px]">
                {t}
              </span>
            ))}
          </div>
        </div>

        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
      </Link>
    </motion.li>
  );
}
