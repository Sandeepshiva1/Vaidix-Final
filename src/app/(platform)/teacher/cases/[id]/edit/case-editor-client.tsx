'use client';

// ════════════════════════════════════════════════════════════════════════════
// CaseEditorClient — refine + publish a faculty case template
// ════════════════════════════════════════════════════════════════════════════
// Layout: header (status, title, source link, publish/archive CTAs); main
// two-column: left = patient + presenting complaint (the resident's first
// touch), right = metadata + tags + 5-stage AI mentor guidance (read-only
// preview in this phase). Edits POST /api/cases/[id] (PATCH).

import { useCallback, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Save,
  Globe,
  Archive,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Lock,
  FileText,
  ExternalLink,
  Stethoscope,
  Eye,
  Brain,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  X,
  BookOpenCheck,
  Lightbulb,
  Calendar,
  Share2,
} from 'lucide-react';
import {
  CaseDifficulty,
  CaseTemplateStatus,
} from '@prisma/client';
import { csrfHeaders } from '@/lib/csrf-client';

interface SourceDocument {
  id: string;
  title: string;
  kind: string;
}

interface StageGuidance {
  patientStory?: { mentorIntro?: string; expectedQuestions?: string[]; keyFacts?: string[] };
  observation?: { mentorPrompt?: string; expectedFindings?: string[] };
  hypothesis?: { differentials?: string[]; rationale?: string };
  investigation?: { workups?: string[]; rationale?: string };
  reflection?: { teachingPoints?: string[]; pearls?: string[] };
}

interface Template {
  id: string;
  title: string;
  condition: string;
  specialty: string;
  description: string;
  difficulty: CaseDifficulty;
  bloomsLevel: number;
  estimatedMinutes: number;
  patientName: string;
  patientAgeYears: number;
  patientSex: string;
  patientPresentingComplaint: string;
  oslerianPrinciples: string[];
  tags: string[];
  isEmergency: boolean;
  imageCount: number;
  status: CaseTemplateStatus;
  forgedAt: string | null;
  publishedAt: string | null;
  stageGuidance: unknown;
  sourceDocument: SourceDocument | null;
}

interface LinkedSession {
  sessionId: string;
  title: string;
  scheduledStart: string | null;
  status: string;
  required: boolean;
}

interface AvailableSession {
  id: string;
  title: string;
  scheduledStart: string | null;
}

interface Props {
  template: Template;
  linkedSessions: LinkedSession[];
  availableSessions: AvailableSession[];
}

// ─── Form draft ────────────────────────────────────────────────────────────

interface Draft {
  title: string;
  condition: string;
  description: string;
  patientName: string;
  patientAgeYears: number;
  patientSex: 'M' | 'F';
  patientPresentingComplaint: string;
  bloomsLevel: number;
  difficulty: CaseDifficulty;
  estimatedMinutes: number;
  isEmergency: boolean;
  tags: string[];
}

function templateToDraft(t: Template): Draft {
  return {
    title: t.title,
    condition: t.condition,
    description: t.description,
    patientName: t.patientName,
    patientAgeYears: t.patientAgeYears,
    patientSex: t.patientSex === 'F' ? 'F' : 'M',
    patientPresentingComplaint: t.patientPresentingComplaint,
    bloomsLevel: t.bloomsLevel,
    difficulty: t.difficulty,
    estimatedMinutes: t.estimatedMinutes,
    isEmergency: t.isEmergency,
    tags: t.tags,
  };
}

const STATUS_TONE: Record<CaseTemplateStatus, string> = {
  DRAFT: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PUBLISHED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ARCHIVED: 'border-border bg-muted text-muted-foreground',
};
const STATUS_LABEL: Record<CaseTemplateStatus, string> = {
  DRAFT: 'Draft (private)',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};
const STATUS_ICON: Record<CaseTemplateStatus, React.ComponentType<{ className?: string }>> = {
  DRAFT: Lock,
  PUBLISHED: Globe,
  ARCHIVED: Archive,
};

export function CaseEditorClient({ template, linkedSessions: initialLinks, availableSessions }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(templateToDraft(template));
  const [original] = useState<Draft>(templateToDraft(template));
  const [status, setStatus] = useState<CaseTemplateStatus>(template.status);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [linkedSessions, setLinkedSessions] = useState(initialLinks);
  const [pickedSessionId, setPickedSessionId] = useState<string>('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const linkedSessionIds = new Set(linkedSessions.map((l) => l.sessionId));
  const availableUnlinked = availableSessions.filter((s) => !linkedSessionIds.has(s.id));

  const linkToSession = useCallback(async () => {
    if (!pickedSessionId) return;
    setLinking(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/cases/${template.id}/tag-session`, {
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
            required: true,
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
  }, [pickedSessionId, template.id, availableSessions, router]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  const update = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/cases/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify(draft),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) throw new Error(json.error?.message ?? `Save failed (${res.status})`);
      setSavedAt(Date.now());
      startTransition(() => router.refresh());
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [draft, template.id, router]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setSaveError(null);
    try {
      // Save any pending edits first.
      if (dirty) await save();
      const res = await fetch(`/api/cases/${template.id}/publish`, {
        method: 'POST',
        headers: csrfHeaders(),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) throw new Error(json.error?.message ?? `Publish failed (${res.status})`);
      setStatus('PUBLISHED');
      startTransition(() => router.refresh());
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }, [dirty, save, template.id, router]);

  const archive = useCallback(async () => {
    if (!confirm('Archive this case? Students will no longer see it in the program bank.')) return;
    setArchiving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/cases/${template.id}/archive`, {
        method: 'POST',
        headers: csrfHeaders(),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) throw new Error(json.error?.message ?? `Archive failed (${res.status})`);
      setStatus('ARCHIVED');
      startTransition(() => router.refresh());
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setArchiving(false);
    }
  }, [template.id, router]);

  const StatusIcon = STATUS_ICON[status];
  const guidance = (template.stageGuidance ?? {}) as StageGuidance;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
      className="mx-auto max-w-6xl space-y-6 px-6 py-8"
      data-testid="case-editor"
    >
      {/* Back */}
      <motion.div variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}>
        <Link
          href="/teacher/cases"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to my cases
        </Link>
      </motion.div>

      {/* Header */}
      <motion.header
        variants={{ hidden: { opacity: 0, y: 6 }, visible: { opacity: 1, y: 0 } }}
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}
            >
              <StatusIcon className="h-3 w-3" />
              {STATUS_LABEL[status]}
            </span>
            {draft.isEmergency && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-3 w-3" /> Emergency
              </span>
            )}
            {template.forgedAt && (
              <span className="text-[10px] text-muted-foreground">
                AI-forged · {new Date(template.forgedAt).toLocaleString()}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">{draft.title}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{draft.condition}</span>
            {' · '}
            {template.specialty}
          </p>
          {template.sourceDocument && (
            <Link
              href={`/teacher/documents/${template.sourceDocument.id}`}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <FileText className="h-3 w-3" />
              Source: {template.sourceDocument.title}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <span className="text-[11px] text-muted-foreground">
              <AlertCircle className="mr-1 inline h-3 w-3" />
              Unsaved changes
            </span>
          )}
          {!dirty && savedAt && Date.now() - savedAt < 4000 && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              Saved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving || publishing || archiving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="case-save"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
          {status === 'DRAFT' && (
            <button
              type="button"
              onClick={publish}
              disabled={publishing || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
              data-testid="case-publish"
            >
              {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
              Publish to program bank
            </button>
          )}
          {status === 'PUBLISHED' && (
            <button
              type="button"
              onClick={archive}
              disabled={archiving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {archiving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
              Archive
            </button>
          )}
        </div>
      </motion.header>

      <AnimatePresence>
        {saveError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{saveError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left: editable fields */}
        <div className="space-y-6">
          <Section title="Title & summary" icon={BookOpenCheck}>
            <Field label="Title">
              <input
                type="text"
                value={draft.title}
                onChange={(e) => update('title', e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                maxLength={200}
                data-testid="case-title"
              />
            </Field>
            <Field label="Condition (canonical name)">
              <input
                type="text"
                value={draft.condition}
                onChange={(e) => update('condition', e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                maxLength={120}
              />
            </Field>
            <Field label="Description">
              <textarea
                value={draft.description}
                onChange={(e) => update('description', e.target.value)}
                rows={3}
                maxLength={600}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
              <CharCount value={draft.description} max={600} />
            </Field>
          </Section>

          <Section title="Patient" icon={Stethoscope}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name">
                <input
                  type="text"
                  value={draft.patientName}
                  onChange={(e) => update('patientName', e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  maxLength={80}
                />
              </Field>
              <Field label="Age (years)">
                <input
                  type="number"
                  value={draft.patientAgeYears}
                  onChange={(e) => update('patientAgeYears', Number(e.target.value))}
                  min={0}
                  max={110}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Sex">
                <select
                  value={draft.patientSex}
                  onChange={(e) => update('patientSex', e.target.value as 'M' | 'F')}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
              </Field>
            </div>
            <Field label="Presenting complaint (first message the student sees)">
              <textarea
                value={draft.patientPresentingComplaint}
                onChange={(e) => update('patientPresentingComplaint', e.target.value)}
                rows={3}
                maxLength={600}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium"
                placeholder="First-person, conversational. e.g. 'Doctor, my right eye has been red and painful for 3 days...'"
              />
              <CharCount value={draft.patientPresentingComplaint} max={600} />
            </Field>
          </Section>

          {/* Stage guidance — read-only preview */}
          <StageGuidancePreview guidance={guidance} />
        </div>

        {/* Right: metadata + tags */}
        <div className="space-y-6">
          <Section title="Difficulty & timing" icon={Brain}>
            <Field label="Difficulty">
              <select
                value={draft.difficulty}
                onChange={(e) => update('difficulty', e.target.value as CaseDifficulty)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="BEGINNER">Beginner</option>
                <option value="INTERMEDIATE">Intermediate</option>
                <option value="ADVANCED">Advanced</option>
              </select>
            </Field>
            <Field label={`Bloom's level: ${draft.bloomsLevel}`}>
              <input
                type="range"
                min={1}
                max={6}
                value={draft.bloomsLevel}
                onChange={(e) => update('bloomsLevel', Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>1 Remember</span>
                <span>6 Create</span>
              </div>
            </Field>
            <Field label="Estimated minutes">
              <input
                type="number"
                value={draft.estimatedMinutes}
                onChange={(e) => update('estimatedMinutes', Number(e.target.value))}
                min={5}
                max={120}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isEmergency}
                onChange={(e) => update('isEmergency', e.target.checked)}
                className="h-4 w-4"
              />
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-rose-500" />
                Emergency case
              </span>
            </label>
          </Section>

          <Section title="Tags" icon={Eye}>
            <TagsField
              tags={draft.tags}
              onChange={(tags) => update('tags', tags)}
            />
          </Section>

          {/* Share to session — only meaningful when published */}
          <Section title="Share to session" icon={Share2}>
            {status !== 'PUBLISHED' ? (
              <p className="text-[11px] text-muted-foreground">
                Publish this case first — drafts can&apos;t be assigned to a session.
              </p>
            ) : (
              <div className="space-y-3" data-testid="case-share-section">
                {linkedSessions.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Not yet assigned to a session. Pick one below.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    <AnimatePresence initial={false}>
                      {linkedSessions.map((s) => (
                        <motion.li
                          key={s.sessionId}
                          layout
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="flex items-start gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs"
                        >
                          <Calendar className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{s.title}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {s.scheduledStart
                                ? new Date(s.scheduledStart).toLocaleString()
                                : 'No date'}
                              {' · '}
                              {s.required ? 'required' : 'optional'}
                            </div>
                          </div>
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
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs"
                      disabled={linking}
                      data-testid="case-share-select"
                    >
                      <option value="">Pick a session…</option>
                      {availableUnlinked.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                          {s.scheduledStart
                            ? ` · ${new Date(s.scheduledStart).toLocaleDateString()}`
                            : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={linkToSession}
                      disabled={!pickedSessionId || linking}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
                      data-testid="case-share-link"
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
                      <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-700 dark:text-rose-300">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{linkError}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    {availableSessions.length === 0
                      ? 'No sessions in your program yet.'
                      : 'Linked to every available session.'}
                  </p>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
      className="space-y-3 rounded-2xl border border-border bg-card/60 p-5 backdrop-blur"
    >
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </motion.section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  const len = value.length;
  const tone = len > max * 0.95 ? 'text-rose-500' : 'text-muted-foreground';
  return <span className={`mt-0.5 block text-right text-[10px] ${tone}`}>{len} / {max}</span>;
}

function TagsField({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [pending, setPending] = useState('');
  const add = () => {
    const v = pending.trim().toLowerCase().replace(/\s+/g, '-');
    if (!v || tags.includes(v) || tags.length >= 8) return;
    onChange([...tags, v]);
    setPending('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {tags.map((t) => (
            <motion.span
              key={t}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px]"
            >
              {t}
              <button
                type="button"
                onClick={() => onChange(tags.filter((x) => x !== t))}
                aria-label={`Remove ${t}`}
                className="text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="add tag (e.g. anterior-uveitis)"
          className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-xs"
          disabled={tags.length >= 8}
        />
        <button
          type="button"
          onClick={add}
          disabled={!pending.trim() || tags.length >= 8}
          className="rounded-lg border border-border bg-background p-1.5 transition hover:bg-muted disabled:opacity-50"
          aria-label="Add tag"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function StageGuidancePreview({ guidance }: { guidance: StageGuidance }) {
  const [open, setOpen] = useState(true);

  const stages = [
    {
      key: 'patientStory' as const,
      label: 'Patient story',
      icon: Stethoscope,
      items: [
        { kind: 'text', label: 'Mentor intro', value: guidance.patientStory?.mentorIntro },
        { kind: 'list', label: 'Expected questions', value: guidance.patientStory?.expectedQuestions },
        { kind: 'list', label: 'Key facts', value: guidance.patientStory?.keyFacts },
      ],
    },
    {
      key: 'observation' as const,
      label: 'Observation',
      icon: Eye,
      items: [
        { kind: 'text', label: 'Mentor prompt', value: guidance.observation?.mentorPrompt },
        { kind: 'list', label: 'Expected findings', value: guidance.observation?.expectedFindings },
      ],
    },
    {
      key: 'hypothesis' as const,
      label: 'Hypothesis',
      icon: Brain,
      items: [
        { kind: 'list', label: 'Differentials (ranked)', value: guidance.hypothesis?.differentials },
        { kind: 'text', label: 'Rationale', value: guidance.hypothesis?.rationale },
      ],
    },
    {
      key: 'investigation' as const,
      label: 'Investigation',
      icon: BookOpenCheck,
      items: [
        { kind: 'list', label: 'Workups', value: guidance.investigation?.workups },
        { kind: 'text', label: 'Rationale', value: guidance.investigation?.rationale },
      ],
    },
    {
      key: 'reflection' as const,
      label: 'Reflection',
      icon: Lightbulb,
      items: [
        { kind: 'list', label: 'Teaching points', value: guidance.reflection?.teachingPoints },
        { kind: 'list', label: 'Pearls', value: guidance.reflection?.pearls },
      ],
    },
  ];

  const hasAny = stages.some((s) => s.items.some((i) => Array.isArray(i.value) ? i.value.length : i.value));

  return (
    <motion.section
      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
      className="space-y-3 rounded-2xl border border-border bg-card/60 p-5 backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Stethoscope className="h-3.5 w-3.5" />
          5-stage Socratic guidance
          <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
            AI-forged · read-only preview
          </span>
        </h2>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {!hasAny ? (
              <p className="text-xs text-muted-foreground">
                No stage guidance attached. Hand-authored cases skip this; forged cases include it
                unless the AI returned an empty skeleton.
              </p>
            ) : (
              <div className="space-y-4">
                {stages.map((s) => (
                  <div key={s.key} className="rounded-lg border border-border bg-background/50 p-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                      <s.icon className="h-3 w-3" />
                      {s.label}
                    </h3>
                    <dl className="space-y-2">
                      {s.items.map((it, i) => (
                        <div key={i}>
                          <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {it.label}
                          </dt>
                          <dd className="mt-0.5 text-xs">
                            {it.kind === 'text' ? (
                              it.value ? (
                                <p className="leading-relaxed text-muted-foreground">{it.value as string}</p>
                              ) : (
                                <span className="text-muted-foreground/60">— none</span>
                              )
                            ) : Array.isArray(it.value) && it.value.length > 0 ? (
                              <ul className="space-y-0.5">
                                {(it.value as string[]).map((x, j) => (
                                  <li key={j} className="leading-relaxed text-muted-foreground">
                                    • {x}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-muted-foreground/60">— none</span>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
