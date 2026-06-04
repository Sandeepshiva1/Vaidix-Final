// ════════════════════════════════════════════════════════════════════════════
// Office text extraction for the deck forge.
//
// Gemini reads PDF / plain-text / markdown natively (sent inline), but NOT the
// Office Open XML ZIP binaries (.pptx / .docx). So we crack those open locally
// and hand Gemini the extracted text instead — that's how PPTX/DOCX content
// reaches the model the same way a PDF's does.
//
// Keynote (.key) is Apple iWork (snappy-compressed protobuf, not OOXML) and is
// NOT handled here — it needs a LibreOffice/unoconv → PDF conversion step
// (the uniform "convert to PDF then inline" path). It also isn't in the upload
// allowlist today, so it never reaches the forge.
// ════════════════════════════════════════════════════════════════════════════

import JSZip from 'jszip';
import { PptxDocument } from '@/server/services/pptx/pptx-document';

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const EXTRACTABLE = new Set([PPTX_MIME, DOCX_MIME]);

/** True if we can extract text from this mime locally (pptx/docx). */
export function isExtractableOffice(mimeType: string): boolean {
  return EXTRACTABLE.has(mimeType);
}

// Cap so a huge deck/doc doesn't blow the token budget (~60k chars ≈ 15k tokens).
const MAX_CHARS = 60_000;

/**
 * Extract readable text from a PPTX or DOCX buffer for AI deck generation.
 * Returns '' if the type is unsupported or the document has no extractable text.
 */
export async function extractOfficeText(buf: Buffer, mimeType: string): Promise<string> {
  let text = '';
  try {
    if (mimeType === PPTX_MIME) text = extractPptxText(buf);
    else if (mimeType === DOCX_MIME) text = await extractDocxText(buf);
  } catch {
    return '';
  }
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

/** PPTX → reuse the existing parser: title + body text per slide, in order. */
function extractPptxText(buf: Buffer): string {
  const doc = PptxDocument.fromBuffer(buf);
  const out: string[] = [];
  for (const slide of doc.slides()) {
    const title = slide.shapes.find((s) => s.isTitle)?.text?.trim();
    const body = slide.shapes
      .filter((s) => !s.isTitle)
      .map((s) => s.text.trim())
      .filter(Boolean);
    const lines = [title ? `## ${title}` : '', ...body].filter(Boolean);
    if (lines.length) out.push(`[Slide ${slide.index}]\n${lines.join('\n')}`);
  }
  return out.join('\n\n').trim();
}

/** DOCX → unzip, read word/document.xml, pull <w:t> runs per <w:p> paragraph. */
async function extractDocxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return '';
  const paras: string[] = [];
  for (const para of xml.split(/<\/w:p>/)) {
    const runs = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1]));
    const line = runs.join('').trim();
    if (line) paras.push(line);
  }
  return paras.join('\n').trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
