'use client';

// ════════════════════════════════════════════════════════════════════════════
// Document detail — Forge launchpad + share + artifacts
// ════════════════════════════════════════════════════════════════════════════
// Vaidix faculty's "do something with this document" hub. The two hero cards
// (Forge Presentation, Forge Case) are intentionally large and gradient-led
// — these are the primary outcomes faculty come here to drive.

import { useCallback, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Sparkles,
  Stethoscope,
  Presentation,
  ChevronRight,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Tag as TagIcon,
  ExternalLink,
  X,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  File as FileIcon,
  Trash2,
} from 'lucide-react';
import { csrfHeaders } from '@/lib/csrf-client';
import {
  DocumentRoute,
  DocumentStatus,
  DocumentKind,
  Role,
  DeckForgeStatus,
} from '@prisma/client';

// ─── Types from server ──────────────────────────────────────────────────────

interface DocSummary {
  id: string;
  title: string;
  description: string | null;
  kind: DocumentKind;
  route: DocumentRoute;
  aiSuggestedRoute: DocumentRoute | null;
  aiConfidence: number | null;
  status: DocumentStatus;
  sizeBytes: number;
  mimeType: string;
  uploaderName: string;
  uploaderId: string;
  phiScanStatus: string | null;
  downloadUrl: string | null;
  tags: string[];
  createdAt: string;
}

interface DeckRow {
  id: string;
  status: DeckForgeStatus;
  slideCount: number | null;
  inputTitle: string | null;
  createdAt: string;
  readabilityScore: number | null;
  slideDensityScore: number | null;
  visualBalanceScore: number | null;
  suggestionCount: number;
}

interface LinkedSession {
  sessionId: string;
  title: string;
  scheduledStart: string | null;
  status: string;
  visibleAfterSession: boolean;
}

interface AvailableSession {
  id: string;
  title: string;
  scheduledStart: string | null;
}

interface Actor {
  id: string;
  role: Role;
}

interface Props {
  doc: DocSummary;
  decks: DeckRow[];
  linkedSessions: LinkedSession[];
  availableSessions: AvailableSession[];
  actor: Actor;
}

// ─── Display helpers ────────────────────────────────────────────────────────

const ROUTE_LABEL: Record<DocumentRoute, string> = {
  DECK_FORGE: 'PPT to polish',
  REFERENCE: 'Reference',
  CASE_NOTE: 'Case notes',
  PROMO_ASSET: 'Promo asset',
  PROMO_TEASER_VIDEO: 'Promo teaser video',
  UNCLASSIFIED: 'Unclassified',
};

const KIND_ICON: Record<DocumentKind, React.ComponentType<{ className?: string }>> = {
  PDF: FileText,
  PPT: Presentation,
  DOC: FileText,
  MARKDOWN: FileText,
  IMAGE: FileImage,
  VIDEO: FileVideo,
  AUDIO: FileAudio,
  OTHER: FileIcon,
};

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// Pinned to en-GB so server (often en-IN) and client (often en-US) render
// identically — otherwise SSR/hydration mismatch on "28/5/2026" vs "5/28/2026".
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function relativeFrom(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(iso);
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 8) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 5) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function DocumentDetailClient({
  doc,
  decks: initialDecks,
  linkedSessions: initialLinks,
  availableSessions,
  actor,
}: Props) {
  const router = useRouter();
  const [decks] = useState(initialDecks);
  const [linkedSessions, setLinkedSessions] = useState(initialLinks);

  // ─── Forge actions ────────────────────────────────────────────────────────

  const [forgingDeck, setForgingDeck] = useState(false);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [forgingCase, setForgingCase] = useState(false);
  const [caseForgeError, setCaseForgeError] = useState<string | null>(null);

  const forgePresentation = useCallback(async () => {
    setForgingDeck(true);
    setForgeError(null);
    try {
      const res = await fetch('/api/decks/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ documentId: doc.id }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { jobId: string };
        error?: { message: string };
      };
      if (!json.ok || !json.data) {
        throw new Error(json.error?.message ?? `Forge failed (${res.status})`);
      }
      router.push(`/teacher/decks/${json.data.jobId}`);
    } catch (err) {
      setForgeError((err as Error).message);
      setForgingDeck(false);
    }
  }, [doc.id, router]);

  const forgeCase = useCallback(async () => {
    setForgingCase(true);
    setCaseForgeError(null);
    try {
      const res = await fetch('/api/cases/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ documentId: doc.id }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { caseTemplateId: string };
        error?: { message: string };
      };
      if (!json.ok || !json.data) {
        throw new Error(json.error?.message ?? `Case forge failed (${res.status})`);
      }
      router.push(`/teacher/cases/${json.data.caseTemplateId}/edit`);
    } catch (err) {
      setCaseForgeError((err as Error).message);
      setForgingCase(false);
    }
  }, [doc.id, router]);

  const caseForgeEnabled = true;

  // ─── Share to session ─────────────────────────────────────────────────────

  const linkedSessionIds = useMemo(
    () => new Set(linkedSessions.map((l) => l.sessionId)),
    [linkedSessions],
  );
  const availableUnlinked = availableSessions.filter((s) => !linkedSessionIds.has(s.id));
  const [pickedSessionId, setPickedSessionId] = useState<string>('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const linkToSession = useCallback(async () => {
    if (!pickedSessionId) return;
    setLinking(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/tag-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ sessionId: pickedSessionId }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) throw new Error(json.error?.message ?? `Link failed (${res.status})`);
      const picked = availableSessions.find((s) => s.id === pickedSessionId);
      if (picked) {
        setLinkedSessions((prev) => [
          ...prev,
          {
            sessionId: picked.id,
            title: picked.title,
            scheduledStart: picked.scheduledStart,
            status: 'SCHEDULED',
            visibleAfterSession: true,
          },
        ]);
      }
      setPickedSessionId('');
      startTransition(() => router.refresh());
    } catch (err) {
      setLinkError((err as Error).message);
    } finally {
      setLinking(false);
    }
  }, [pickedSessionId, doc.id, availableSessions, router]);

  // ─── Delete ───────────────────────────────────────────────────────────────
  // Mirrors `canManage` in document-service.ts: admins and program directors
  // can delete any document; faculty only their own. The DELETE endpoint
  // re-validates, so this is purely a visibility toggle.
  const canDelete =
    actor.role === Role.ADMIN ||
    actor.role === Role.PROGRAM_DIRECTOR ||
    actor.id === doc.uploaderId;

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteDocument = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: 'DELETE',
        headers: { ...csrfHeaders() },
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message ?? `Delete failed (${res.status})`);
      }
      router.push('/teacher/documents');
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }, [doc.id, router]);

  // ─── Header values ────────────────────────────────────────────────────────

  const KindIcon = KIND_ICON[doc.kind] ?? FileIcon;

  const phiBadge = (() => {
    const s = doc.phiScanStatus;
    if (s === 'CLEAN' || s === 'COMPLETED') {
      return { Icon: ShieldCheck, label: 'PHI clean', tone: 'emerald' as const };
    }
    if (s === 'BLOCKED' || s === 'PENDING_REVIEW') {
      return { Icon: ShieldAlert, label: 'PHI flagged', tone: 'rose' as const };
    }
    if (s === 'PENDING' || s === 'IN_PROGRESS') {
      return { Icon: ShieldQuestion, label: 'PHI scanning', tone: 'amber' as const };
    }
    return { Icon: ShieldQuestion, label: 'No PHI scan', tone: 'muted' as const };
  })();
  const phiClasses = {
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    muted: 'border-border bg-muted text-muted-foreground',
  }[phiBadge.tone];

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
      className="mx-auto max-w-6xl space-y-8 px-6 py-8"
      data-testid="doc-detail"
    >
      {/* Back link */}
      <motion.div
        variants={{ hidden: { opacity: 0, y: -8 }, visible: { opacity: 1, y: 0 } }}
      >
        <Link
          href="/teacher/documents"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to library
        </Link>
      </motion.div>

      {/* Header */}
      <motion.header
        variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium">
            <KindIcon className="h-3.5 w-3.5" />
            {doc.kind}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${phiClasses}`}>
            <phiBadge.Icon className="h-3.5 w-3.5" />
            {phiBadge.label}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium">
            {ROUTE_LABEL[doc.route]}
          </span>
          {doc.aiSuggestedRoute && doc.aiSuggestedRoute !== doc.route && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300"
              title="AI suggested a different classification"
            >
              <Sparkles className="h-3 w-3" />
              AI suggests: {ROUTE_LABEL[doc.aiSuggestedRoute]}
            </span>
          )}
        </div>

        <div>
          <h1 className="font-semibold leading-tight tracking-tight text-3xl">
            {doc.title}
          </h1>
          {doc.description && (
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{doc.description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Uploaded by <span className="font-medium text-foreground">{doc.uploaderName}</span></span>
          <span>·</span>
          <span>{relativeFrom(doc.createdAt)}</span>
          <span>·</span>
          <span>{formatSize(doc.sizeBytes)}</span>
          {doc.downloadUrl && (
            <>
              <span>·</span>
              <a
                href={doc.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
              >
                Open source <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </div>

        {doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {doc.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                <TagIcon className="h-3 w-3" />
                {t}
              </span>
            ))}
          </div>
        )}
      </motion.header>

      {/* Main grid: forge actions left, share + meta right */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* ─── Left column ─── */}
        <div className="space-y-6">
          {/* Forge action cards */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
            className="space-y-3"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Generate from this document
            </h2>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Forge Presentation */}
              <ForgeActionCard
                gradient="from-teal-500/15 via-emerald-500/10 to-cyan-500/15"
                ringColor="ring-teal-500/40"
                Icon={Presentation}
                iconBg="bg-teal-500/15 text-teal-700 dark:text-teal-300"
                title="Forge presentation"
                blurb="AI builds a 14–22 slide deck — title, layout, bullets, speaker notes, with citations back to this source. You polish in the editor."
                badge="AI-generated · you polish"
                cta="Generate slides"
                ctaIcon={Sparkles}
                onClick={forgePresentation}
                pending={forgingDeck}
                error={forgeError}
                disabled={false}
              />

              {/* Forge Case */}
              <ForgeActionCard
                gradient="from-violet-500/15 via-fuchsia-500/10 to-rose-500/15"
                ringColor="ring-violet-500/40"
                Icon={Stethoscope}
                iconBg="bg-violet-500/15 text-violet-700 dark:text-violet-300"
                title="Forge case"
                blurb="AI drafts a Socratic 5-stage case (patient story, observation, hypothesis, investigation, reflection) keyed to this document. Edit, then publish to your program's case bank."
                badge="AI-generated · draft until you publish"
                cta="Generate case"
                ctaIcon={Stethoscope}
                onClick={forgeCase}
                pending={forgingCase}
                error={caseForgeError}
                disabled={!caseForgeEnabled}
              />
            </div>
          </motion.section>

          {/* Forged decks */}
          {decks.length > 0 && (
            <motion.section
              variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
              className="space-y-3"
            >
              <div className="flex items-end justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Forged decks
                </h2>
                <span className="text-xs text-muted-foreground">{decks.length} total</span>
              </div>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {decks.map((d, idx) => (
                    <DeckRow key={d.id} deck={d} index={idx} />
                  ))}
                </AnimatePresence>
              </div>
            </motion.section>
          )}
        </div>

        {/* ─── Right column ─── */}
        <div className="space-y-6">
          {/* Share to session */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
            className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Share to session</h2>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </div>

            {linkedSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Not yet linked. Sessions you link this to will surface this document in the
                study pack for students.
              </p>
            ) : (
              <ul className="mb-4 space-y-1.5">
                <AnimatePresence initial={false}>
                  {linkedSessions.map((s) => (
                    <motion.li
                      key={s.sessionId}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{s.title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDate(s.scheduledStart)} · {s.status.toLowerCase()}
                        </div>
                      </div>
                      <Link
                        href={`/classroom/${s.sessionId}`}
                        className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        aria-label="Open session"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}

            {availableUnlinked.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={pickedSessionId}
                  onChange={(e) => {
                    setPickedSessionId(e.target.value);
                    setLinkError(null);
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
                  disabled={linking}
                >
                  <option value="">Pick a session…</option>
                  {availableUnlinked.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                      {s.scheduledStart ? ` · ${new Date(s.scheduledStart).toLocaleDateString('en-GB')}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={linkToSession}
                  disabled={!pickedSessionId || linking}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {linking ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Linking…
                    </>
                  ) : (
                    <>Link to session</>
                  )}
                </button>
                {linkError && (
                  <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{linkError}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {availableSessions.length === 0
                  ? 'No sessions in your program yet.'
                  : 'Linked to every available session.'}
              </p>
            )}
          </motion.section>

          {/* Document info */}
          <motion.section
            variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
            className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur"
          >
            <h2 className="mb-4 text-sm font-semibold">Document info</h2>
            <dl className="space-y-2.5 text-xs">
              <Row label="MIME">
                <span className="font-mono text-[11px]">{doc.mimeType}</span>
              </Row>
              <Row label="Status">
                <span className="capitalize">{doc.status.toLowerCase().replace(/_/g, ' ')}</span>
              </Row>
              <Row label="Classification">
                <span>{ROUTE_LABEL[doc.route]}</span>
              </Row>
              {doc.aiConfidence !== null && (
                <Row label="AI confidence">
                  <span className="font-mono text-[11px]">
                    {(doc.aiConfidence * 100).toFixed(0)}%
                  </span>
                </Row>
              )}
              <Row label="PHI scan">
                <span className="capitalize">
                  {doc.phiScanStatus
                    ? doc.phiScanStatus.toLowerCase().replace(/_/g, ' ')
                    : 'not run'}
                </span>
              </Row>
            </dl>
          </motion.section>

          {/* Danger zone */}
          {canDelete && (
            <motion.section
              variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
              className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 backdrop-blur"
            >
              <h2 className="mb-1 text-sm font-semibold text-rose-700 dark:text-rose-300">
                Delete document
              </h2>
              <p className="mb-3 text-[11px] text-muted-foreground">
                Removes the document from your library and session study packs. Forged
                decks and cases stay. This can be undone within 30 days by an admin.
              </p>
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDeleteOpen(true);
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-500/15 dark:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete document
              </button>
            </motion.section>
          )}
        </div>
      </div>

      {/* Footnote — actor + role for clarity in shared screenshots */}
      <p className="text-[10px] text-muted-foreground">
        Viewing as {actor.role.toLowerCase().replace(/_/g, ' ')}.
      </p>

      {/* Delete confirm modal */}
      <AnimatePresence>
        {confirmDeleteOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
            onClick={() => !deleting && setConfirmDeleteOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 12 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 border-b border-border/60 px-6 py-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15">
                  <Trash2 className="size-4 text-rose-600 dark:text-rose-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Delete this document?</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{doc.title}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={deleting}
                  className="rounded-xl p-2 text-muted-foreground transition hover:bg-muted/60 disabled:opacity-40"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="space-y-3 px-6 py-5 text-xs text-muted-foreground">
                <p>
                  It will disappear from the library and from any session study pack it&apos;s
                  attached to. Forged decks and cases that came from this document stay
                  intact.
                </p>
                <p>
                  An admin can restore it within 30 days. After that it&apos;s purged
                  permanently.
                </p>
                {deleteError && (
                  <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-rose-700 dark:text-rose-300">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{deleteError}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/20 px-6 py-4">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  disabled={deleting}
                  className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-muted/60 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={deleteDocument}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-60"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Deleting…
                    </>
                  ) : (
                    <>
                      <Trash2 className="size-3.5" /> Delete
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ForgeActionCard({
  gradient,
  ringColor,
  Icon,
  iconBg,
  title,
  blurb,
  badge,
  cta,
  ctaIcon: CtaIcon,
  onClick,
  pending,
  error,
  disabled,
}: {
  gradient: string;
  ringColor: string;
  Icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  title: string;
  blurb: string;
  badge: string;
  cta: string;
  ctaIcon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  pending: boolean;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <motion.div
      whileHover={disabled ? undefined : { y: -2 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`group relative overflow-hidden rounded-2xl border border-border bg-linear-to-br p-5 transition ${gradient} ${
        disabled ? 'opacity-60' : `hover:ring-2 ${ringColor}`
      }`}
    >
      <div className="relative space-y-3">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className="h-5 w-5" />
        </div>

        <div>
          <h3 className="text-base font-semibold leading-tight">{title}</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{blurb}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{badge}</span>
        </div>

        <button
          type="button"
          onClick={onClick}
          disabled={disabled || pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <CtaIcon className="h-4 w-4" />
              {cta}
              <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </>
          )}
        </button>

        {error && (
          <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function DeckRow({ deck, index }: { deck: DeckRow; index: number }) {
  const isReady =
    deck.status === DeckForgeStatus.REVIEW_PENDING ||
    deck.status === DeckForgeStatus.APPROVED;
  const isFailed = deck.status === DeckForgeStatus.FAILED;
  const StatusIcon = isReady ? CheckCircle2 : isFailed ? AlertCircle : Loader2;
  const statusTone = isReady
    ? 'text-emerald-600 dark:text-emerald-400'
    : isFailed
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-muted-foreground';

  const Inner = (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card/60 px-4 py-3 transition hover:border-foreground/20 hover:bg-card">
      <StatusIcon
        className={`h-4 w-4 shrink-0 ${statusTone} ${isReady || isFailed ? '' : 'animate-spin'}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{deck.inputTitle ?? 'Untitled deck'}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {deck.status.toLowerCase().replace(/_/g, ' ')}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{deck.slideCount ?? '—'} slides</span>
          <span>·</span>
          <span>{relativeFrom(deck.createdAt)}</span>
          {deck.suggestionCount > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-600 dark:text-amber-400">
                {deck.suggestionCount} AI suggestion{deck.suggestionCount === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Score chips */}
      <div className="hidden items-center gap-1.5 sm:flex">
        <ScoreChip label="Read" score={deck.readabilityScore} />
        <ScoreChip label="Density" score={deck.slideDensityScore} />
        <ScoreChip label="Balance" score={deck.visualBalanceScore} />
      </div>

      {isReady && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </div>
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.04 }}
    >
      {isReady ? (
        <Link href={`/teacher/decks/${deck.id}`} className="block">
          {Inner}
        </Link>
      ) : (
        Inner
      )}
    </motion.div>
  );
}

function ScoreChip({ label, score }: { label: string; score: number | null }) {
  if (score === null) return null;
  return (
    <span
      className="rounded-md border border-border bg-background/40 px-2 py-1 text-[10px] font-medium"
      title={`${label}: ${score}/10`}
    >
      <span className="text-muted-foreground">{label} </span>
      <span className={`font-mono ${scoreColor(score)}`}>{score.toFixed(1)}</span>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}
