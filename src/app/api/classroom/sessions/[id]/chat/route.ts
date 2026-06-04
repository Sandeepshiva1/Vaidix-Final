// Hybrid chat: LiveKit data channels for realtime, DB for persistence + scrollback
import { jsonOk, jsonError, requireAuth, parseBody, handleUnexpected } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { getEffectiveSessionRole } from '@/server/services/session-service';
import { presignDownload } from '@/lib/storage';
import { z } from 'zod';

// Either content, attachment, or both. The attachment must already be
// finalised (sha256 set) and uploaded by the same user — enforced below.
const postSchema = z
  .object({
    content: z.string().max(2000).default(''),
    attachmentId: z.string().cuid().optional(),
  })
  .refine((d) => d.content.trim().length > 0 || d.attachmentId, {
    message: 'Message must have content or an attachment',
  });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { id: sessionId } = await ctx.params;

    const role = await getEffectiveSessionRole(sessionId, gate.user.id, gate.user.role);
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403);

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 200);

    const messages = await db.sessionChatMessage.findMany({
      where: { sessionId },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
        attachment: {
          select: {
            id: true,
            name: true,
            mimeType: true,
            sizeBytes: true,
            s3Key: true,
            sha256: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    // Strip s3Key from the wire response (server-only) and replace with a
    // short-lived signed URL. Skip attachments not yet finalised.
    const withUrls = await Promise.all(
      messages.map(async (m) => {
        const att = m.attachment;
        if (!att || !att.sha256) {
          return { ...m, attachment: null };
        }
        const downloadUrl = await presignDownload(att.s3Key, 3600);
        return {
          ...m,
          attachment: {
            id: att.id,
            name: att.name,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            downloadUrl,
          },
        };
      })
    );
    return jsonOk({ messages: withUrls.reverse() });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const body = await parseBody(req, postSchema);
    if (!body.ok) return body.response;

    const { id: sessionId } = await ctx.params;
    const role = await getEffectiveSessionRole(sessionId, gate.user.id, gate.user.role);
    if (!role || role === 'VIEWER') {
      return jsonError('FORBIDDEN', 'No chat permission', 403);
    }

    // Validate the attachment if present: must belong to this session, this
    // user, and be finalised. Reject otherwise — silently dropping would let
    // a stuck upload appear in chat as a broken link forever.
    if (body.data.attachmentId) {
      const att = await db.sessionFile.findUnique({
        where: { id: body.data.attachmentId },
        select: { sessionId: true, uploadedById: true, sha256: true },
      });
      if (!att || att.sessionId !== sessionId) {
        return jsonError('NOT_FOUND', 'Attachment not found', 404);
      }
      if (att.uploadedById !== gate.user.id) {
        return jsonError('FORBIDDEN', 'Attachment was uploaded by someone else', 403);
      }
      if (!att.sha256) {
        return jsonError('PRECONDITION_FAILED', 'Attachment upload not finalised', 412);
      }
    }

    const message = await db.sessionChatMessage.create({
      data: {
        sessionId,
        userId: gate.user.id,
        content: body.data.content,
        attachmentId: body.data.attachmentId ?? null,
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
        attachment: {
          select: { id: true, name: true, mimeType: true, sizeBytes: true, s3Key: true },
        },
      },
    });
    const att = message.attachment;
    const attPayload = att
      ? {
          id: att.id,
          name: att.name,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          downloadUrl: await presignDownload(att.s3Key, 3600),
        }
      : null;
    return jsonOk({ message: { ...message, attachment: attPayload } }, { status: 201 });
  } catch (err) {
    return handleUnexpected(err);
  }
}
