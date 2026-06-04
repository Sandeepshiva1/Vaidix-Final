// security hardening — EXIF / metadata strip on uploaded images.
// Strips identifying camera/GPS/owner fields before the file lands in
// permanent storage. Pure JS implementation for JPEG and PNG; other types
// are passed through unchanged (operator can extend per Phase 2).
//
// Limitations: this strips well-known metadata containers (EXIF, IPTC, XMP
// for JPEG; tEXt/iTXt for PNG). It does not re-encode pixels — steganographic
// content survives. Real Microsoft Presidio sidecar (Phase 2) does deeper
// strip + redaction; this is the conservative stopgap.

import { Buffer } from 'node:buffer';

const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageKind(buf: Buffer): 'jpeg' | 'png' | 'other' {
  if (buf.length >= 2 && buf.subarray(0, 2).equals(JPEG_SOI)) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  return 'other';
}

export function stripJpegMetadata(buf: Buffer): { out: Buffer; removedSegments: string[] } {
  if (!buf.subarray(0, 2).equals(JPEG_SOI)) return { out: buf, removedSegments: [] };
  const out: Buffer[] = [Buffer.from(JPEG_SOI)];
  const removed: string[] = [];
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      // misaligned — bail out and return the rest unchanged from this point.
      out.push(buf.subarray(i));
      break;
    }
    const marker = buf[i + 1];
    // Standalone markers (no length).
    if (marker === 0xd8 || marker === 0xd9) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xda) {
      // Start of Scan — image data follows; just append the rest.
      out.push(buf.subarray(i));
      break;
    }
    if (i + 4 > buf.length) {
      out.push(buf.subarray(i));
      break;
    }
    const len = buf.readUInt16BE(i + 2);
    const segEnd = i + 2 + len;
    // APPn (0xE0..0xEF) and COM (0xFE) are metadata segments.
    const isAppN = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    if (isAppN || isComment) {
      removed.push(`0xff${marker.toString(16).padStart(2, '0')}(${len}b)`);
    } else {
      out.push(buf.subarray(i, segEnd));
    }
    i = segEnd;
  }
  return { out: Buffer.concat(out), removedSegments: removed };
}

export function stripPngMetadata(buf: Buffer): { out: Buffer; removedChunks: string[] } {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return { out: buf, removedChunks: [] };
  const out: Buffer[] = [Buffer.from(PNG_SIG)];
  const removed: string[] = [];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const chunkEnd = i + 12 + len;
    // Drop ancillary text/metadata chunks that commonly carry author/origin.
    const dropped =
      type === 'tEXt' || type === 'zTXt' || type === 'iTXt' ||
      type === 'tIME' || type === 'eXIf';
    if (dropped) {
      removed.push(`${type}(${len}b)`);
    } else {
      out.push(buf.subarray(i, chunkEnd));
    }
    i = chunkEnd;
    if (type === 'IEND') break;
  }
  return { out: Buffer.concat(out), removedChunks: removed };
}

export interface ExifStripReport {
  kind: 'jpeg' | 'png' | 'other';
  removed: string[];
  bytesIn: number;
  bytesOut: number;
}

export function stripImageMetadata(buf: Buffer): { out: Buffer; report: ExifStripReport } {
  const kind = detectImageKind(buf);
  if (kind === 'jpeg') {
    const r = stripJpegMetadata(buf);
    return {
      out: r.out,
      report: { kind, removed: r.removedSegments, bytesIn: buf.length, bytesOut: r.out.length },
    };
  }
  if (kind === 'png') {
    const r = stripPngMetadata(buf);
    return {
      out: r.out,
      report: { kind, removed: r.removedChunks, bytesIn: buf.length, bytesOut: r.out.length },
    };
  }
  return {
    out: buf,
    report: { kind: 'other', removed: [], bytesIn: buf.length, bytesOut: buf.length },
  };
}
