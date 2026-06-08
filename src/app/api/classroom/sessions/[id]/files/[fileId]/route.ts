// GET /api/classroom/sessions/[id]/files/[fileId]
//   Returns a short-lived presigned download URL for a single session file.
//   Used by pre-conference Q&A attachments and any other consumer that needs
//   to link directly to one file without loading the full file list.

import {
  handleUnexpected,
  jsonError,
  jsonOk,
  requireAuth,
} from '@/server/services/api-helpers'
import { db } from '@/lib/db'
import { getEffectiveSessionRole } from '@/server/services/session-service'
import { presignDownload, isLocalStorageBackend } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const { id: sessionId, fileId } = await ctx.params

    const role = await getEffectiveSessionRole(sessionId, auth.user.id, auth.user.role)
    if (!role) return jsonError('FORBIDDEN', 'No access to this session', 403)

    const file = await db.sessionFile.findUnique({ where: { id: fileId } })
    if (!file || file.sessionId !== sessionId) {
      return jsonError('NOT_FOUND', 'File not found', 404)
    }
    if (!file.sha256) {
      return jsonError('PRECONDITION_FAILED', 'File upload not finalised yet', 412)
    }

    const downloadUrl = isLocalStorageBackend()
      ? `/api/uploads/local/${file.id}`
      : await presignDownload(file.s3Key, 3600)

    return jsonOk({
      file: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        downloadUrl,
      },
    })
  } catch (err) {
    return handleUnexpected(err)
  }
}
