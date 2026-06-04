'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './medlearn.module.css';
import { IconUpload } from './icons';
import { attachDocumentAndForgeAction } from './actions';

interface Props {
  sessionId: string;
  sessionTitle?: string;
  hasSlides: boolean;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; fileName: string; percent: number }
  | { kind: 'forging'; fileName: string }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'done'; fileName: string; slideCount: number };

const ACCEPTED = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint',                                              // .ppt
  'application/pdf',                                                            // .pdf
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',    // .docx
  'application/msword',                                                         // .doc
].join(',');

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Slides uploader for the Pre-Conference flow. Two-step:
 *   1. POST multipart/form-data to /api/documents/upload — server streams
 *      bytes to S3 (prod) or `.local-uploads/<documentId>` (dev). Returns
 *      the created Document row.
 *   2. Call `attachDocumentAndForgeAction` — links the Document to the
 *      session and synchronously runs Deck Forge (Gemini-backed) to produce
 *      Slide rows the LiveScreen + Studio can render.
 *
 * Steps are observable: the user sees "Uploading… X%" then "Analyzing your
 * deck…" then "Deck ready · N slides". router.refresh() picks up the new
 * DocumentSessionLink + Slide rows on the Pre screen.
 */
export function SlidesUploader({ sessionId, sessionTitle, hasSlides }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });

  const pick = () => inputRef.current?.click();

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setState({ kind: 'error', message: 'File is too large (50 MB max).' });
      return;
    }

    try {
      setState({ kind: 'uploading', fileName: file.name, percent: 0 });
      const documentId = await uploadDocumentMultipart({
        file,
        title: sessionTitle || file.name.replace(/\.[^.]+$/, ''),
        description: `Slide source for session ${sessionId}`,
        onProgress: (pct) => setState({ kind: 'uploading', fileName: file.name, percent: pct }),
      });

      setState({ kind: 'forging', fileName: file.name });
      const result = await attachDocumentAndForgeAction(sessionId, documentId);
      if (!result.ok) {
        setState({ kind: 'error', message: friendlyForgeError(result.error, result.code), code: result.code });
        // The file is still uploaded and linked; user can retry forge via the
        // Pre screen. router.refresh() so the link shows up as a known file.
        router.refresh();
        return;
      }

      setState({ kind: 'done', fileName: file.name, slideCount: result.slideCount });
      router.refresh();
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };

  const busy = state.kind === 'uploading' || state.kind === 'forging';

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        hidden
        onChange={onFileChange}
        aria-hidden
      />

      <p className={styles.body} style={{ marginBottom: 8 }}>
        Drop a PowerPoint, Keynote, or PDF here — or pick a file from your computer. Up to 50 MB.
        The platform will analyse the deck and prepare it for your session.
      </p>

      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        onClick={pick}
        disabled={busy}
      >
        <IconUpload size={16} />
        <span>{busy ? 'Uploading…' : hasSlides ? 'Upload another file' : 'Choose a file'}</span>
      </button>

      {state.kind === 'uploading' && (
        <UploadProgress label={`Uploading ${state.fileName}`} percent={state.percent} />
      )}
      {state.kind === 'forging' && (
        <UploadProgress label={`Analyzing ${state.fileName}…`} percent={100} pulse />
      )}
      {state.kind === 'done' && (
        <p className={styles.body} style={{ color: 'var(--success)', fontWeight: 600 }}>
          ✓ Deck ready · {state.slideCount} slide{state.slideCount === 1 ? '' : 's'} from {state.fileName}.
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className={styles.body} style={{ color: 'var(--error)' }}>
          {state.message}
        </p>
      )}
    </div>
  );
}

function UploadProgress({ label, percent, pulse = false }: { label: string; percent: number; pulse?: boolean }) {
  return (
    <div>
      <p className={styles.body} style={{ fontSize: 13, marginBottom: 6 }}>
        {label}{pulse ? '' : ` — ${Math.round(percent)}%`}
      </p>
      <div className={styles.progressTrack} style={{ margin: 0 }}>
        <div
          className={styles.progressFill}
          style={{
            width: `${Math.max(2, percent)}%`,
            animation: pulse ? 'pulse 1.4s ease-in-out infinite' : undefined,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Server-proxied multipart upload (no presigned PUT needed because the route
 * itself streams the bytes to S3 / local-FS). Returns the created Document
 * id. Surfaces real progress via XHR upload events.
 */
async function uploadDocumentMultipart({
  file,
  title,
  description,
  onProgress,
}: {
  file: File;
  title: string;
  description: string;
  onProgress: (pct: number) => void;
}): Promise<string> {
  const form = new FormData();
  form.append('title', title);
  form.append('description', description);
  form.append('file', file);

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents/upload', true);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress((ev.loaded / ev.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const env = JSON.parse(xhr.responseText) as { data?: { document?: { id?: string } } };
          const id = env.data?.document?.id;
          if (!id) return reject(new Error('Upload succeeded but no document id returned.'));
          resolve(id);
        } catch (e) {
          reject(new Error(`Could not parse upload response: ${(e as Error).message}`));
        }
        return;
      }
      // Try to surface the standard error envelope.
      let msg = `Upload failed (${xhr.status})`;
      try {
        const env = JSON.parse(xhr.responseText) as { error?: { message?: string } };
        if (env.error?.message) msg = env.error.message;
      } catch { /* keep fallback */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    xhr.send(form);
  });
}

function friendlyForgeError(message: string, code?: string): string {
  if (code === 'AI_UNAVAILABLE') {
    return 'Slide analysis is unavailable — the GEMINI_API_KEY is missing from the server environment.';
  }
  if (code === 'NO_SOURCE') return 'Upload succeeded but the source could not be loaded for analysis.';
  if (code === 'SOURCE_NOT_FOUND') return 'The uploaded file could not be located on the server. Try again.';
  // Common Gemini failure paths surface their own messages.
  return `Slide analysis failed: ${message}`;
}
