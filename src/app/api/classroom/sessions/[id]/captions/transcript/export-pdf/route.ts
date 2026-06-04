// ════════════════════════════════════════════════════════════════════════════
// GET /api/classroom/sessions/[id]/captions/transcript/export-pdf
// ════════════════════════════════════════════════════════════════════════════
// Downloads the finalized live session transcript as a formatted PDF.
// Auth: any role that can see the session (same gate as GET /transcript).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  handleUnexpected,
  jsonError,
  requireAuth,
} from '@/server/services/api-helpers';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import { db } from '@/lib/db';

const MARGIN = 50;
const PAGE_W = 595; // A4
const PAGE_H = 842;
const LINE_H = 16;
const BODY_W = PAGE_W - MARGIN * 2;

interface Segment {
  startMs: number;
  endMs?: number;
  text: string;
  speakerName?: string | null;
}

function msToTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function wrapText(text: string, font: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id: sessionId } = await ctx.params;

  const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role);
  if (!role) return jsonError('FORBIDDEN', 'You do not have access to this session', 403);

  try {
    const [session, transcript] = await Promise.all([
      db.teachingSession.findUnique({
        where: { id: sessionId },
        select: { title: true, scheduledStart: true },
      }),
      db.sessionTranscript.findUnique({
        where: { sessionId_language: { sessionId, language: 'en' } },
        select: { segments: true, contentText: true, finalizedAt: true, finalized: true },
      }),
    ]);

    if (!transcript) return jsonError('NOT_FOUND', 'No transcript found for this session', 404);

    // segments is a Prisma JsonArray on the DB; cast through unknown so the
    // explicit narrowing isn't blocked by Prisma's recursive JSON type which
    // is structurally too permissive to overlap with the Segment shape.
    const segments = Array.isArray(transcript.segments)
      ? (transcript.segments as unknown as Segment[])
      : [];

    // ─── Build PDF ───────────────────────────────────────────────────────────
    const pdfDoc = await PDFDocument.create();
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const mono = await pdfDoc.embedFont(StandardFonts.Courier);

    const navy = rgb(0.05, 0.1, 0.3);
    const teal = rgb(0.0, 0.5, 0.5);
    const black = rgb(0, 0, 0);
    const grey = rgb(0.4, 0.4, 0.4);

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    function ensureSpace(needed: number) {
      if (y - needed < MARGIN) {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
    }

    function drawLine(text: string, font: typeof regular, size: number, color: typeof black, indent = 0) {
      ensureSpace(size + 4);
      page.drawText(text, { x: MARGIN + indent, y, size, font, color });
      y -= LINE_H;
    }

    // Header
    page.drawRectangle({ x: 0, y: PAGE_H - 70, width: PAGE_W, height: 70, color: navy });
    page.drawText('VAIDIX', { x: MARGIN, y: PAGE_H - 30, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText('Session Transcript', { x: MARGIN, y: PAGE_H - 50, size: 11, font: regular, color: rgb(0.8, 0.9, 1) });
    y = PAGE_H - 90;

    drawLine(session?.title ?? 'Session', bold, 14, navy);
    if (session?.scheduledStart) {
      drawLine(new Date(session.scheduledStart).toLocaleDateString('en-IN', { dateStyle: 'full' }), regular, 10, grey);
    }
    if (transcript.finalized && transcript.finalizedAt) {
      drawLine(`Finalized: ${new Date(transcript.finalizedAt).toLocaleString('en-IN')}`, regular, 9, grey);
    }

    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: teal });
    y -= 16;

    if (segments.length === 0) {
      // Fall back to raw contentText if segments array is empty.
      const lines = wrapText(transcript.contentText || '(empty transcript)', regular, 10, BODY_W);
      for (const l of lines) drawLine(l, regular, 10, black);
    } else {
      for (const seg of segments) {
        const ts = `[${msToTimestamp(seg.startMs)}]`;
        const speaker = seg.speakerName ? `${seg.speakerName}: ` : '';
        const header = `${ts} ${speaker}`;

        ensureSpace(LINE_H * 3);
        page.drawText(header, { x: MARGIN, y, size: 9, font: mono, color: teal });
        y -= 13;

        const textLines = wrapText(seg.text, regular, 10, BODY_W - 12);
        for (const l of textLines) drawLine(l, regular, 10, black, 12);
        y -= 4;
      }
    }

    // Footer on each page
    const pageCount = pdfDoc.getPageCount();
    for (let i = 0; i < pageCount; i++) {
      const p = pdfDoc.getPage(i);
      p.drawText(`Page ${i + 1} of ${pageCount}  |  Generated by Vaidix`, {
        x: MARGIN,
        y: 20,
        size: 8,
        font: regular,
        color: grey,
      });
    }

    const bytes = await pdfDoc.save();

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      eventType: AUDIT_EVENTS.TRANSCRIPT_PDF_EXPORTED,
      entityType: 'TeachingSession',
      entityId: sessionId,
      summary: 'Transcript exported as PDF',
      ...extractRequestMetadata(req),
    });

    const filename = `transcript-${sessionId.slice(-8)}.pdf`;
    // pdf-lib's `save()` returns Uint8Array<ArrayBufferLike>, which is
    // structurally a valid BodyInit, but TypeScript's lib.dom typing for
    // the Response constructor narrows BufferSource to `ArrayBufferView`
    // without the generic parameter. Cast to BodyInit — the runtime accepts
    // any TypedArray as a body.
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': bytes.byteLength.toString(),
      },
    });
  } catch (err) {
    return handleUnexpected(err);
  }
}
