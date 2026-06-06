// ════════════════════════════════════════════════════════════════════════════
// Upload validation — MIME allowlist + magic-byte sniffing
// ════════════════════════════════════════════════════════════════════════════
// The browser-supplied `file.type` is attacker-controlled, so it cannot be
// trusted on its own. We allowlist the document types the platform actually
// handles and verify the file's leading bytes match the declared category.
// This blocks storing/serving active content (HTML/SVG/scripts) that could be
// used for stored-XSS or content-sniffing attacks on download.

export interface UploadValidationOk {
  ok: true;
  /** The validated content-type to persist/serve. */
  mimeType: string;
}
export interface UploadValidationErr {
  ok: false;
  reason: string;
}

// Canonical content-type per accepted extension. SVG is intentionally absent
// (it can carry script); serve images as raster only.
const ALLOWED: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  key: 'application/vnd.apple.keynote',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

// Returns true if the bytes plausibly match the canonical type. Types without a
// reliable signature (text/csv) are accepted on extension alone.
function magicMatches(ext: string, buf: Buffer): boolean {
  switch (ext) {
    case 'pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
    case 'jpg':
    case 'jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'gif':
      return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case 'webp':
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8);
    case 'ppt':
    case 'doc':
    case 'xls':
      // Legacy OLE compound file.
      return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0]);
    case 'pptx':
    case 'docx':
    case 'xlsx':
    case 'key':
      // OOXML + modern iWork (.key) are ZIP containers.
      return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]);
    case 'mp4':
    case 'm4a':
      return startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4); // ....ftyp
    case 'mov': {
      // QuickTime: a 4-byte atom-size prefix then a 4-char atom type. Accept the
      // common top-level atoms a .mov can legitimately open with.
      if (buf.length < 8) return false;
      const atom = buf.toString('latin1', 4, 8);
      return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(atom);
    }
    case 'webm':
      return startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3]);
    case 'mp3':
      return startsWith(buf, [0x49, 0x44, 0x33]) || startsWith(buf, [0xff, 0xfb]);
    case 'wav':
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x41, 0x56, 0x45], 8);
    case 'csv':
    case 'txt':
    case 'md':
      return true;
    default:
      return false;
  }
}

/**
 * Validate an uploaded file by extension + leading bytes. Returns the canonical
 * content-type to store (never the raw client mime) on success.
 */
export function validateUpload(filename: string, bytes: Buffer): UploadValidationOk | UploadValidationErr {
  const ext = extOf(filename);
  const canonical = ALLOWED[ext];
  if (!canonical) {
    return { ok: false, reason: `File type ".${ext || 'unknown'}" is not allowed` };
  }
  if (!magicMatches(ext, bytes)) {
    return { ok: false, reason: 'File content does not match its extension' };
  }
  return { ok: true, mimeType: canonical };
}

/**
 * Allowlist a file by extension alone, returning the canonical content-type.
 * Used by the presigned-URL upload path where the server never sees the bytes
 * (they go browser → object store directly) and so cannot sniff magic numbers.
 * The client-declared `mimeType` is intentionally ignored — it's attacker-
 * controlled — and the canonical type is substituted instead.
 */
export function validateUploadMeta(
  filename: string,
): UploadValidationOk | UploadValidationErr {
  const ext = extOf(filename);
  const canonical = ALLOWED[ext];
  if (!canonical) {
    return { ok: false, reason: `File type ".${ext || 'unknown'}" is not allowed` };
  }
  return { ok: true, mimeType: canonical };
}
