// ════════════════════════════════════════════════════════════════════════════
// Slide Raster Service — render an uploaded deck's ORIGINAL slides to PNGs.
// ════════════════════════════════════════════════════════════════════════════
// Backs the editor's pixel-faithful "Original" view for VERBATIM imports.
//   PDF   → rasterise pages directly (pdf-to-img → pdfjs-dist + @napi-rs/canvas).
//   PPTX/PPT/Keynote → LibreOffice converts to PDF first (office-to-pdf.ts),
//                      then the same rasteriser runs.
//
// pdf-to-img is ESM with a top-level await (pdfjs legacy build), so it MUST be
// dynamically imported inside the function — a static import would force the
// whole module graph to ESM. It's also in next.config serverExternalPackages
// so Next never tries to bundle it. Everything here is best-effort: if
// LibreOffice is absent or rasterisation fails, callers fall back to the
// editable copy with no original image.
// ════════════════════════════════════════════════════════════════════════════

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3, BUCKET } from '@/lib/storage';
import { convertOfficeToPdf, isConvertibleToPdf } from './office-to-pdf';

const DEFAULT_SCALE = 2; // ~1920px wide for a 960pt slide — crisp on retina.
const MAX_PAGES = 200; // safety belt for pathological decks.

/** Rasterise every page of a PDF buffer to a PNG buffer (one per page). */
export async function rasterizePdf(
  pdf: Buffer,
  opts?: { scale?: number; maxPages?: number },
): Promise<Buffer[]> {
  // Dynamic import — see file header.
  const { pdf: toImages } = await import('pdf-to-img');
  const doc = await toImages(new Uint8Array(pdf), { scale: opts?.scale ?? DEFAULT_SCALE });
  const pages: Buffer[] = [];
  const max = opts?.maxPages ?? MAX_PAGES;
  for await (const png of doc) {
    pages.push(png);
    if (pages.length >= max) break;
  }
  return pages;
}

/**
 * Rasterise an uploaded source to per-slide PNGs. PDFs render directly; Office
 * formats convert to PDF first. Returns [] (never throws) when the type isn't
 * rasterisable or LibreOffice is unavailable — the caller keeps the editable
 * copy and simply has no "Original" image.
 */
export async function rasterizeSource(
  buffer: Buffer,
  mimeType: string,
  opts?: { scale?: number; maxPages?: number },
): Promise<Buffer[]> {
  try {
    if (mimeType === 'application/pdf') return await rasterizePdf(buffer, opts);
    if (isConvertibleToPdf(mimeType)) {
      const pdf = await convertOfficeToPdf(buffer, mimeType);
      if (!pdf || pdf.byteLength === 0) return [];
      return await rasterizePdf(pdf, opts);
    }
  } catch (e) {
    console.warn('[slide-raster] rasterise failed', {
      mimeType,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return [];
}

/**
 * Upload per-slide source PNGs to S3, returning the key for each index. Mirrors
 * the deck-forge image key layout but with a `source-` prefix so faithful-import
 * rasters never collide with AI-generated slide illustrations (`slide-`).
 */
export async function uploadSourceImages(opts: {
  jobId: string;
  requestedById: string;
  pngs: Buffer[];
}): Promise<string[]> {
  const keys: string[] = [];
  for (let i = 0; i < opts.pngs.length; i++) {
    const key = `documents/deck-forge/${opts.requestedById}/${opts.jobId}/source-${i}.png`;
    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: opts.pngs[i], ContentType: 'image/png' }),
    );
    keys.push(key);
  }
  return keys;
}
