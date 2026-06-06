// ════════════════════════════════════════════════════════════════════════════
// Study-pack upload policy — single source of truth (client-safe)
// ════════════════════════════════════════════════════════════════════════════
// The "Upload material" buttons in the Pre-Conference curator advertise a fixed
// set of document types. The HTML `accept` attribute is only a hint — a user can
// still pick "All files" or drag-drop anything — so this module also provides a
// validator that rejects out-of-policy files in the browser with a clear,
// type-named message BEFORE any bytes are sent.
//
// The server remains the authority: `validateUpload` (server-only, in
// server/services/documents/upload-validation.ts) re-checks the extension AND
// sniffs the leading magic bytes, so a renamed file (evil.exe → notes.pdf)
// still can't slip through. Keep the extension set here in sync with the
// server ALLOWED map for the advertised study-pack subset.

export interface FileCheckOk {
  ok: true
}
export interface FileCheckErr {
  ok: false
  /** Human-readable, type-named rejection message safe to show in a toast. */
  reason: string
}

// extension → human-readable category. Insertion order drives the order of the
// `accept` attribute below. Every extension the buttons advertise lives here and
// nowhere else.
const EXT_CATEGORY: Record<string, string> = {
  pdf: 'PDF',
  ppt: 'PowerPoint',
  pptx: 'PowerPoint',
  key: 'Keynote',
  doc: 'Word document',
  docx: 'Word document',
  md: 'Markdown',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  mp4: 'video',
  mov: 'video',
}

/** Comma-joined extension list for an `<input type="file" accept="…">`. */
export const STUDY_PACK_ACCEPT = Object.keys(EXT_CATEGORY)
  .map((ext) => `.${ext}`)
  .join(',')

/** Human summary of the accepted formats — for hint text and error copy. */
export const ACCEPTED_FORMATS_LABEL =
  'PDF, PowerPoint, Keynote, Word, Markdown, image (PNG/JPG) or video (MP4/MOV)'

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/**
 * Client-side gate for the study-pack uploaders. Extension is the reliable
 * signal in the browser (the declared MIME type is unreliable and easily
 * absent), so we allowlist by extension here; the server additionally verifies
 * the file's magic bytes. Returns a friendly, type-named reason on rejection.
 */
export function validateStudyPackFile(file: { name: string; type?: string }): FileCheckOk | FileCheckErr {
  const ext = extensionOf(file.name)
  if (!ext) {
    return {
      ok: false,
      reason: `"${file.name}" has no file extension. Accepted formats: ${ACCEPTED_FORMATS_LABEL}.`,
    }
  }
  if (!(ext in EXT_CATEGORY)) {
    return {
      ok: false,
      reason: `.${ext} files aren't accepted here. Accepted formats: ${ACCEPTED_FORMATS_LABEL}.`,
    }
  }
  return { ok: true }
}
