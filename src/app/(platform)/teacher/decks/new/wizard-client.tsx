'use client';

// ════════════════════════════════════════════════════════════════════════════
// DeckWizardClient — 4-step deck-forge wizard
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Presentation,
  Wand2,
  Upload,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  File as FileIcon,
  X,
  Loader2,
  Check,
  AlertCircle,
  Library,
  Plus,
  GraduationCap,
  Clock,
  Target,
  MapPin,
} from 'lucide-react';
import { csrfHeaders } from '@/lib/csrf-client';
import { DocumentKind } from '@prisma/client';

// ─── Public types ──────────────────────────────────────────────────────────

export interface ExistingDoc {
  id: string;
  title: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface Props {
  existingDocs: ExistingDoc[];
}

type WizardIntent = 'ENHANCE_EXISTING' | 'DRAFT_FROM_SCRATCH';
type WizardRole = 'PRIMARY_PPTX' | 'SOURCE' | 'PRIOR_TRANSCRIPT';
type SessionType = 'LECTURE' | 'CASE_CONFERENCE' | 'JOURNAL_CLUB' | 'TUTORIAL';

interface PickedDoc {
  documentId: string;
  role: WizardRole;
  /** Display label (from upload or library pick) */
  title: string;
  /** Display badge */
  kindLabel: string;
}

interface Briefing {
  audience: string;
  sessionType: SessionType;
  durationMin: number;
  objectives: string;
  localContext: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Intent', icon: Wand2 },
  { id: 2, label: 'Sources', icon: Upload },
  { id: 3, label: 'Briefing', icon: GraduationCap },
  { id: 4, label: 'Confirm', icon: Sparkles },
] as const;

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

const SESSION_TYPE_OPTIONS: Array<{ value: SessionType; label: string; desc: string }> = [
  { value: 'LECTURE', label: 'Lecture', desc: 'Didactic presentation' },
  { value: 'CASE_CONFERENCE', label: 'Case conference', desc: 'Real-patient discussion' },
  { value: 'JOURNAL_CLUB', label: 'Journal club', desc: 'Literature critique' },
  { value: 'TUTORIAL', label: 'Tutorial', desc: 'Skill / concept walkthrough' },
];

const DURATION_OPTIONS = [30, 45, 60, 90, 120];

// ─── Component ─────────────────────────────────────────────────────────────

export function DeckWizardClient({ existingDocs }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [intent, setIntent] = useState<WizardIntent | null>(null);
  const [picked, setPicked] = useState<PickedDoc[]>([]);
  const [briefing, setBriefing] = useState<Briefing>({
    audience: '',
    sessionType: 'LECTURE',
    durationMin: 60,
    objectives: '',
    localContext: '',
  });
  const [forging, setForging] = useState(false);
  const [forgeError, setForgeError] = useState<string | null>(null);

  // ─── Step gating ───────────────────────────────────────────────────────

  const step1Done = intent !== null;
  const step2Done = useMemo(() => {
    if (!intent) return false;
    const primaries = picked.filter((p) => p.role === 'PRIMARY_PPTX').length;
    if (intent === 'ENHANCE_EXISTING') return primaries === 1 && picked.length >= 1;
    return primaries === 0 && picked.length >= 1;
  }, [intent, picked]);
  const step3Done =
    briefing.audience.trim().length > 0 && briefing.objectives.trim().length > 0;

  function goNext() {
    if (step === 1 && step1Done) setStep(2);
    else if (step === 2 && step2Done) setStep(3);
    else if (step === 3 && step3Done) setStep(4);
  }
  function goBack() {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3);
  }

  // ─── Step 1: pick intent (clears picked docs if intent changes) ────────

  function pickIntent(next: WizardIntent) {
    if (intent !== next) {
      setPicked([]);
    }
    setIntent(next);
  }

  // ─── Step 2: source management ─────────────────────────────────────────

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.documentId)), [picked]);
  const availableExisting = existingDocs.filter((d) => !pickedIds.has(d.id));

  function addFromLibrary(doc: ExistingDoc, role: WizardRole) {
    setPicked((prev) => [
      ...prev,
      {
        documentId: doc.id,
        role,
        title: doc.title,
        kindLabel: doc.kind,
      },
    ]);
  }

  function removePicked(documentId: string) {
    setPicked((prev) => prev.filter((p) => p.documentId !== documentId));
  }

  function changeRole(documentId: string, role: WizardRole) {
    setPicked((prev) => prev.map((p) => (p.documentId === documentId ? { ...p, role } : p)));
  }

  // ─── Upload: one file at a time, reuses /api/documents/upload ─────────

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[], role: WizardRole) => {
      const list = Array.from(files);
      if (!list.length) return;
      setUploading(true);
      setUploadError(null);
      try {
        for (const file of list) {
          const body = new FormData();
          body.append('title', file.name.replace(/\.[^.]+$/, ''));
          body.append('description', `Forged from wizard upload`);
          body.append('file', file);
          const res = await fetch('/api/documents/upload', { method: 'POST', body });
          const json = (await res.json()) as {
            ok: boolean;
            data?: { document: { id: string; kind: DocumentKind } };
            error?: { message: string };
          };
          if (!json.ok || !json.data) {
            throw new Error(json.error?.message ?? `Upload failed (${res.status})`);
          }
          setPicked((prev) => [
            ...prev,
            {
              documentId: json.data!.document.id,
              role,
              title: file.name,
              kindLabel: json.data!.document.kind,
            },
          ]);
        }
      } catch (err) {
        setUploadError((err as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  // ─── Step 4: forge ────────────────────────────────────────────────────

  const onForge = useCallback(async () => {
    if (!intent || !step2Done || !step3Done) return;
    setForging(true);
    setForgeError(null);
    try {
      // CSRF cookie is bootstrapped lazily — first POST in a fresh session
      // can race the cookie write. Mirror the role-context pattern: if the
      // cookie is missing, GET /api/csrf to mint it, then read again.
      if (!document.cookie.match(/(?:^|;\s*)vaidix-csrf=/)) {
        await fetch('/api/csrf', { credentials: 'include', cache: 'no-store' });
      }
      const res = await fetch('/api/decks/wizard/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          intent,
          briefing: {
            audience: briefing.audience.trim(),
            sessionType: briefing.sessionType,
            durationMin: briefing.durationMin,
            objectives: briefing.objectives.trim(),
            localContext: briefing.localContext.trim() || undefined,
          },
          inputs: picked.map((p) => ({ documentId: p.documentId, role: p.role })),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { jobId: string };
        error?: { message: string; code?: string };
      };
      if (!json.ok || !json.data) {
        throw new Error(json.error?.message ?? `Forge failed (${res.status})`);
      }
      // Wizard-forged decks land in the Presentation Studio. Legacy /[jobId]
      // (the legacy simple editor) stays for old jobs.
      router.push(`/teacher/decks/${json.data.jobId}/studio`);
    } catch (err) {
      setForgeError((err as Error).message);
      setForging(false);
    }
  }, [intent, step2Done, step3Done, briefing, picked, router]);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto max-w-5xl space-y-8 px-6 py-8"
      data-testid="deck-wizard"
    >
      <Link
        href="/teacher/documents"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to documents
      </Link>

      <header className="space-y-2">
        <h1 className="font-semibold tracking-tight text-3xl">Forge a new deck</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Upload your source materials, tell us who&apos;s in the room, and AI drafts a teaching deck
          you can polish in the studio. Your sources stay private to you until you tag the deck
          to a session.
        </p>
      </header>

      <Stepper current={step} step1Done={step1Done} step2Done={step2Done} step3Done={step3Done} />

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18 }}
        >
          {step === 1 && <IntentStep intent={intent} onPick={pickIntent} />}
          {step === 2 && (
            <SourcesStep
              intent={intent!}
              picked={picked}
              availableExisting={availableExisting}
              uploading={uploading}
              uploadError={uploadError}
              onUpload={handleFiles}
              onAddExisting={addFromLibrary}
              onRemove={removePicked}
              onChangeRole={changeRole}
            />
          )}
          {step === 3 && <BriefingStep briefing={briefing} onChange={setBriefing} />}
          {step === 4 && (
            <ConfirmStep
              intent={intent!}
              picked={picked}
              briefing={briefing}
              forging={forging}
              error={forgeError}
              onForge={onForge}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Step nav */}
      <div className="flex items-center justify-between border-t border-border pt-5">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 1 || forging}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm transition hover:bg-muted disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        {step < 4 && (
          <button
            type="button"
            onClick={goNext}
            disabled={
              (step === 1 && !step1Done) ||
              (step === 2 && !step2Done) ||
              (step === 3 && !step3Done)
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Stepper indicator ─────────────────────────────────────────────────────

function Stepper({
  current,
  step1Done,
  step2Done,
  step3Done,
}: {
  current: 1 | 2 | 3 | 4;
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
}) {
  const dones = [step1Done, step2Done, step3Done, false]; // step 4 is the action, not a "done"
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const isActive = current === s.id;
        const isDone = dones[i] && current > s.id;
        const Icon = isDone ? Check : s.icon;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <div
              className={`flex h-8 items-center gap-2 rounded-full px-3 text-xs font-medium transition ${
                isActive
                  ? 'bg-foreground text-background'
                  : isDone
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground'
              }`}
              data-testid={`step-${s.id}-${isActive ? 'active' : isDone ? 'done' : 'pending'}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-6 transition ${
                  isDone ? 'bg-emerald-500/40' : 'bg-border'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Intent ────────────────────────────────────────────────────────

function IntentStep({
  intent,
  onPick,
}: {
  intent: WizardIntent | null;
  onPick: (v: WizardIntent) => void;
}) {
  return (
    <div className="space-y-4" data-testid="step-1-intent">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        What are you forging?
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <IntentCard
          selected={intent === 'ENHANCE_EXISTING'}
          gradient="from-teal-500/15 via-emerald-500/10 to-cyan-500/15"
          ringColor="ring-teal-500/40"
          iconBg="bg-teal-500/15 text-teal-700 dark:text-teal-300"
          Icon={Presentation}
          title="Enhance my existing PPT"
          blurb="I have a deck already. AI reads it (plus optional reference materials) and proposes content / pedagogy / density improvements I can accept slide by slide."
          bullets={['Upload 1 existing PPT', '+ optional source PDFs / notes', 'Keeps your slide order']}
          onClick={() => onPick('ENHANCE_EXISTING')}
          testid="intent-enhance"
        />
        <IntentCard
          selected={intent === 'DRAFT_FROM_SCRATCH'}
          gradient="from-violet-500/15 via-fuchsia-500/10 to-rose-500/15"
          ringColor="ring-violet-500/40"
          iconBg="bg-violet-500/15 text-violet-700 dark:text-violet-300"
          Icon={Wand2}
          title="Draft a brand new deck"
          blurb="I only have source material (PDFs, Word notes, prior transcripts). AI authors a structured 14–22 slide deck from scratch with citations back to the source."
          bullets={['Upload 1+ source files', 'No existing PPT needed', 'AI picks the structure']}
          onClick={() => onPick('DRAFT_FROM_SCRATCH')}
          testid="intent-draft"
        />
      </div>
    </div>
  );
}

function IntentCard({
  selected,
  gradient,
  ringColor,
  iconBg,
  Icon,
  title,
  blurb,
  bullets,
  onClick,
  testid,
}: {
  selected: boolean;
  gradient: string;
  ringColor: string;
  iconBg: string;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  blurb: string;
  bullets: string[];
  onClick: () => void;
  testid: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      data-testid={testid}
      className={`group relative overflow-hidden rounded-2xl border bg-linear-to-br p-5 text-left transition ${gradient} ${
        selected ? `ring-2 ${ringColor} border-transparent` : 'border-border hover:ring-2 hover:' + ringColor
      }`}
    >
      <div className="space-y-3">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold leading-tight">{title}</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{blurb}</p>
        </div>
        <ul className="space-y-1 text-[11px] text-muted-foreground">
          {bullets.map((b) => (
            <li key={b} className="flex items-center gap-1.5">
              <Check className="h-3 w-3 shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      {selected && (
        <div className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background">
          <Check className="h-3.5 w-3.5" />
        </div>
      )}
    </motion.button>
  );
}

// ─── Step 2: Sources ───────────────────────────────────────────────────────

function SourcesStep({
  intent,
  picked,
  availableExisting,
  uploading,
  uploadError,
  onUpload,
  onAddExisting,
  onRemove,
  onChangeRole,
}: {
  intent: WizardIntent;
  picked: PickedDoc[];
  availableExisting: ExistingDoc[];
  uploading: boolean;
  uploadError: string | null;
  onUpload: (files: FileList | File[], role: WizardRole) => void;
  onAddExisting: (doc: ExistingDoc, role: WizardRole) => void;
  onRemove: (documentId: string) => void;
  onChangeRole: (documentId: string, role: WizardRole) => void;
}) {
  const primaryPicked = picked.find((p) => p.role === 'PRIMARY_PPTX');
  const needsPrimary = intent === 'ENHANCE_EXISTING' && !primaryPicked;
  const sources = picked.filter((p) => p.role !== 'PRIMARY_PPTX');

  return (
    <div className="space-y-6" data-testid="step-2-sources">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Pick or upload your source materials
      </h2>

      {/* Primary PPT zone — ENHANCE only */}
      {intent === 'ENHANCE_EXISTING' && (
        <Zone
          tone={needsPrimary ? 'required' : 'satisfied'}
          title="Your existing PPT (required)"
          subtitle="The deck the AI will read and enhance. Exactly one."
          testid="zone-primary"
        >
          {primaryPicked ? (
            <PickedRow doc={primaryPicked} onRemove={onRemove} onChangeRole={onChangeRole} />
          ) : (
            <UploadDropArea
              accept=".ppt,.pptx,.key,.pdf"
              role="PRIMARY_PPTX"
              onUpload={onUpload}
              uploading={uploading}
              availableExisting={availableExisting.filter(
                (d) => d.kind === 'PPT' || d.kind === 'PDF',
              )}
              onAddExisting={onAddExisting}
              libraryLabel="Or pick a PPT from your library"
              testid="upload-primary"
            />
          )}
        </Zone>
      )}

      {/* Source materials zone */}
      <Zone
        tone={sources.length > 0 ? 'satisfied' : intent === 'DRAFT_FROM_SCRATCH' ? 'required' : 'optional'}
        title={
          intent === 'DRAFT_FROM_SCRATCH'
            ? 'Source materials (required)'
            : 'Reference materials (optional)'
        }
        subtitle={
          intent === 'DRAFT_FROM_SCRATCH'
            ? 'The AI authors the deck from these — PDFs, Word docs, notes, prior transcripts.'
            : 'Extra context for the AI to weave in — guidelines, last term\'s transcript, etc.'
        }
        testid="zone-sources"
      >
        {sources.length > 0 && (
          <ul className="mb-3 space-y-2">
            {sources.map((s) => (
              <li key={s.documentId}>
                <PickedRow doc={s} onRemove={onRemove} onChangeRole={onChangeRole} />
              </li>
            ))}
          </ul>
        )}
        <UploadDropArea
          accept=".pdf,.doc,.docx,.md,.txt,.png,.jpg,.jpeg"
          role="SOURCE"
          onUpload={onUpload}
          uploading={uploading}
          availableExisting={availableExisting.filter(
            (d) => d.kind !== 'PPT' && d.kind !== 'VIDEO' && d.kind !== 'AUDIO',
          )}
          onAddExisting={onAddExisting}
          libraryLabel="Or pick from your library"
          testid="upload-sources"
        />
      </Zone>

      {uploadError && (
        <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
}

function Zone({
  tone,
  title,
  subtitle,
  testid,
  children,
}: {
  tone: 'required' | 'optional' | 'satisfied';
  title: string;
  subtitle: string;
  testid: string;
  children: React.ReactNode;
}) {
  const ring = {
    required: 'ring-1 ring-amber-500/40 bg-amber-500/5',
    optional: 'ring-1 ring-border bg-card/40',
    satisfied: 'ring-1 ring-emerald-500/30 bg-emerald-500/5',
  }[tone];
  return (
    <section className={`rounded-2xl ${ring} p-5`} data-testid={testid}>
      <header className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function PickedRow({
  doc,
  onRemove,
  onChangeRole,
}: {
  doc: PickedDoc;
  onRemove: (id: string) => void;
  onChangeRole: (id: string, role: WizardRole) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={doc.title}>
            {doc.title}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {doc.kindLabel}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {doc.role !== 'PRIMARY_PPTX' && (
          <select
            value={doc.role}
            onChange={(e) => onChangeRole(doc.documentId, e.target.value as WizardRole)}
            className="rounded-md border border-input bg-background px-2 py-1 text-[11px]"
          >
            <option value="SOURCE">Source</option>
            <option value="PRIOR_TRANSCRIPT">Prior transcript</option>
          </select>
        )}
        <button
          type="button"
          onClick={() => onRemove(doc.documentId)}
          className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Remove"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function UploadDropArea({
  accept,
  role,
  onUpload,
  uploading,
  availableExisting,
  onAddExisting,
  libraryLabel,
  testid,
}: {
  accept: string;
  role: WizardRole;
  onUpload: (files: FileList | File[], role: WizardRole) => void;
  uploading: boolean;
  availableExisting: ExistingDoc[];
  onAddExisting: (doc: ExistingDoc, role: WizardRole) => void;
  libraryLabel: string;
  testid: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  return (
    <div className="space-y-3" data-testid={testid}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files, role);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-background/40 px-6 py-8 text-center transition ${
          dragOver ? 'border-foreground bg-muted/60' : 'border-border hover:border-foreground/40'
        } ${uploading ? 'opacity-60' : ''}`}
      >
        <input
          type="file"
          accept={accept}
          multiple={role !== 'PRIMARY_PPTX'}
          disabled={uploading}
          onChange={(e) => {
            if (e.target.files) onUpload(e.target.files, role);
            e.target.value = '';
          }}
          className="hidden"
          data-testid={`${testid}-input`}
        />
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground" />
        )}
        <span className="text-xs font-medium">
          {uploading ? 'Uploading…' : 'Drop files here or click to upload'}
        </span>
        <span className="text-[10px] text-muted-foreground">{accept.replace(/\./g, '').toUpperCase()}</span>
      </label>

      {availableExisting.length > 0 && (
        <div className="rounded-xl border border-border bg-card/40">
          <button
            type="button"
            onClick={() => setLibraryOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs font-medium transition hover:bg-muted/40"
          >
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Library className="h-3.5 w-3.5" />
              {libraryLabel} ({availableExisting.length})
            </span>
            <ChevronRight
              className={`h-3.5 w-3.5 text-muted-foreground transition ${libraryOpen ? 'rotate-90' : ''}`}
            />
          </button>
          {libraryOpen && (
            <ul className="max-h-56 space-y-1 overflow-y-auto border-t border-border p-2">
              {availableExisting.map((doc) => {
                const Icon = KIND_ICON[doc.kind] ?? FileIcon;
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => onAddExisting(doc, role)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition hover:bg-muted"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate" title={doc.title}>
                          {doc.title}
                        </span>
                      </span>
                      <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Briefing ──────────────────────────────────────────────────────

function BriefingStep({
  briefing,
  onChange,
}: {
  briefing: Briefing;
  onChange: (v: Briefing) => void;
}) {
  return (
    <div className="space-y-5" data-testid="step-3-briefing">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Tell the AI who&apos;s in the room
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Audience"
          Icon={GraduationCap}
          hint="Who learns from this deck? Example: PG-2 ophthalmology students."
        >
          <input
            value={briefing.audience}
            onChange={(e) => onChange({ ...briefing, audience: e.target.value })}
            placeholder="PG-2 ophthalmology student"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            data-testid="briefing-audience"
          />
        </Field>

        <Field label="Session type" Icon={Presentation} hint="Shape of the session.">
          <select
            value={briefing.sessionType}
            onChange={(e) => onChange({ ...briefing, sessionType: e.target.value as SessionType })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            data-testid="briefing-session-type"
          >
            {SESSION_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.desc}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Duration" Icon={Clock} hint="Scales the slide count.">
          <select
            value={briefing.durationMin}
            onChange={(e) => onChange({ ...briefing, durationMin: Number(e.target.value) })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            data-testid="briefing-duration"
          >
            {DURATION_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Local context"
          Icon={MapPin}
          hint="LVPEI patient mix, adherence patterns — the AI weaves this in."
          optional
        >
          <input
            value={briefing.localContext}
            onChange={(e) => onChange({ ...briefing, localContext: e.target.value })}
            placeholder="Rural LVPEI cohort, ~60% adherence, follow-up gaps"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            data-testid="briefing-local-context"
          />
        </Field>
      </div>

      <Field
        label="Learning objectives"
        Icon={Target}
        hint="1–3 sentences. What should learners walk away knowing?"
      >
        <textarea
          value={briefing.objectives}
          onChange={(e) => onChange({ ...briefing, objectives: e.target.value })}
          placeholder="Students should be able to (1) classify POAG severity, (2) pick first-line pharmacotherapy, (3) recognise when to escalate to laser/surgery."
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          data-testid="briefing-objectives"
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  Icon,
  hint,
  optional,
  children,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        {optional && (
          <span className="text-[10px] font-normal text-muted-foreground">(optional)</span>
        )}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Step 4: Confirm + Forge ───────────────────────────────────────────────

function ConfirmStep({
  intent,
  picked,
  briefing,
  forging,
  error,
  onForge,
}: {
  intent: WizardIntent;
  picked: PickedDoc[];
  briefing: Briefing;
  forging: boolean;
  error: string | null;
  onForge: () => void;
}) {
  const sessionTypeLabel =
    SESSION_TYPE_OPTIONS.find((o) => o.value === briefing.sessionType)?.label ?? briefing.sessionType;
  return (
    <div className="space-y-5" data-testid="step-4-confirm">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Review and generate
      </h2>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <SummaryRow label="Intent">
          <span className="font-medium">
            {intent === 'ENHANCE_EXISTING' ? 'Enhance my existing PPT' : 'Draft a brand new deck'}
          </span>
        </SummaryRow>

        <SummaryRow label="Inputs">
          <ul className="space-y-1">
            {picked.map((p) => (
              <li key={p.documentId} className="flex items-center gap-2 text-xs">
                <FileText className="h-3 w-3 text-muted-foreground" />
                <span className="truncate">{p.title}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.role.replace(/_/g, ' ').toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </SummaryRow>

        <SummaryRow label="Audience">{briefing.audience}</SummaryRow>
        <SummaryRow label="Session">
          {sessionTypeLabel} · {briefing.durationMin} min
        </SummaryRow>
        <SummaryRow label="Objectives">
          <p className="whitespace-pre-wrap text-xs leading-relaxed">{briefing.objectives}</p>
        </SummaryRow>
        {briefing.localContext.trim() && (
          <SummaryRow label="Context">
            <p className="text-xs leading-relaxed">{briefing.localContext}</p>
          </SummaryRow>
        )}
      </section>

      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-linear-to-br from-teal-500/10 via-emerald-500/5 to-cyan-500/10 p-6 text-center">
        <Sparkles className="h-6 w-6 text-teal-700 dark:text-teal-300" />
        <h3 className="text-base font-semibold">Ready to forge</h3>
        <p className="max-w-md text-xs text-muted-foreground">
          AI reads your sources and drafts the deck. You&apos;ll land in the studio with the slides plus
          initial improvement suggestions to accept or dismiss.
        </p>
        <button
          type="button"
          onClick={onForge}
          disabled={forging}
          data-testid="forge-button"
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {forging ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Forging…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate deck
            </>
          )}
        </button>
        {error && (
          <div className="flex items-start gap-1.5 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-28 shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm">{children}</dd>
    </div>
  );
}
