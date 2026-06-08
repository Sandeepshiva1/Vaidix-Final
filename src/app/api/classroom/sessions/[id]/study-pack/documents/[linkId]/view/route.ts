// GET /api/classroom/sessions/[id]/study-pack/documents/[linkId]/view
//
// Streams document bytes through the Next.js server (no redirect to MinIO).
// Server-to-server fetch avoids the Windows colon-in-filename issue with local MinIO.

import { requireAuth, jsonError, handleUnexpected } from '@/server/services/api-helpers'
import { db } from '@/lib/db'
import { presignDownload } from '@/lib/storage'
import { userCanSeeSession } from '@/server/services/sessions/visibility'

export const dynamic = 'force-dynamic'

function extFromMime(mime: string): string {
  const base = mime.split(';')[0].trim()
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'text/markdown': '.md',
    'application/zip': '.zip',
    'application/json': '.json',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'audio/webm': '.webm',
  }
  return map[base] ?? ''
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { id: sessionId, linkId } = await ctx.params

  const canSee = await userCanSeeSession({ userId: auth.user.id, role: auth.user.role }, sessionId)
    .catch(() => false)
  if (!canSee) return jsonError('FORBIDDEN', 'Not authorised to view this session', 403)

  try {
    const link = await db.documentSessionLink.findFirst({
      where: { id: linkId, sessionId },
      select: { document: { select: { s3Key: true, mimeType: true, title: true } } },
    })
    if (!link?.document?.s3Key) return jsonError('NOT_FOUND', 'Document not found', 404)

    const signedUrl = await presignDownload(link.document.s3Key, 3600)

    // Server-to-server fetch (Docker Linux FS handles colons fine)
    const upstream = await fetch(signedUrl)
    if (!upstream.ok) {
      console.error(`[study-pack/view] MinIO fetch failed: ${upstream.status}`)
      return jsonError('UPSTREAM_ERROR', 'Could not retrieve document from storage', 502)
    }

    const contentType = link.document.mimeType ?? upstream.headers.get('content-type') ?? 'application/octet-stream'
    const sanitized = (link.document.title ?? 'document').replace(/[^a-zA-Z0-9._\- ]/g, '_')
    const filename = /\.[a-zA-Z0-9]{1,6}$/.test(sanitized)
      ? sanitized
      : `${sanitized}${extFromMime(contentType)}`

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    return handleUnexpected(err)
  }
}
