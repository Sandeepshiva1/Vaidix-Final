// ════════════════════════════════════════════════════════════════════════════
// Office/Keynote → PDF conversion via LibreOffice (the unified "convert then
// inline" path). Gemini reads PDF natively, so converting .pptx/.ppt/.docx/.doc/
// .key to PDF first gives the model the FULL document — layout, images, and all
// — through the same inline path a native PDF uses. This is the only reliable
// way to feed Keynote (iWork) content to the model.
//
// Requires the `soffice` (LibreOffice) binary. When it's absent (e.g. local dev
// without LibreOffice) every function degrades gracefully to `null`, and the
// caller falls back to local text extraction. Set LIBREOFFICE_PATH to point at
// the binary if it isn't on PATH.
// ════════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const MIME_EXT: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.apple.keynote': 'key',
};

/** True if we can (attempt to) convert this mime to PDF via LibreOffice. */
export function isConvertibleToPdf(mimeType: string): boolean {
  return mimeType in MIME_EXT;
}

const CONVERT_TIMEOUT_MS = 90_000;

function sofficeCandidates(): string[] {
  const list: string[] = [];
  if (process.env.LIBREOFFICE_PATH) list.push(process.env.LIBREOFFICE_PATH);
  list.push('soffice', 'libreoffice');
  if (process.platform === 'win32') {
    list.push(
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    );
  } else {
    list.push('/usr/bin/soffice', '/usr/bin/libreoffice', '/opt/libreoffice/program/soffice');
  }
  return list;
}

/**
 * Convert an Office/Keynote document buffer to a PDF buffer. Returns null if
 * the type is unsupported, LibreOffice isn't available, or conversion fails —
 * callers should fall back to text extraction.
 */
export async function convertOfficeToPdf(buf: Buffer, mimeType: string): Promise<Buffer | null> {
  const ext = MIME_EXT[mimeType];
  if (!ext) return null;

  const dir = await mkdtemp(join(tmpdir(), 'vaidix-conv-'));
  const profileDir = join(dir, 'profile'); // isolated LO profile → no instance lock
  const inPath = join(dir, `src.${ext}`);
  try {
    await writeFile(inPath, buf);
    const ok = await runSoffice(inPath, dir, profileDir);
    if (!ok) return null;
    return await readFile(join(dir, 'src.pdf')).catch(() => null);
  } catch {
    return null;
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runSoffice(inPath: string, outDir: string, profileDir: string): Promise<boolean> {
  const args = [
    '--headless',
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    inPath,
  ];

  const tryBin = (bins: string[]): Promise<boolean> => {
    if (bins.length === 0) return Promise.resolve(false);
    const [bin, ...rest] = bins;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(bin, args, { stdio: 'ignore' });
      } catch {
        finish(false);
        return;
      }
      const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } finish(false); }, CONVERT_TIMEOUT_MS);
      // ENOENT (binary not found) → try the next candidate path.
      child.on('error', () => { clearTimeout(timer); finish(false); });
      child.on('exit', (code) => { clearTimeout(timer); finish(code === 0); });
    }).then((ok) => (ok ? true : tryBin(rest)));
  };

  return tryBin(sofficeCandidates());
}
