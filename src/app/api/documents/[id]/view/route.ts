// GET /api/documents/[id]/view
//
// Streams the document bytes through the Next.js server.
// Using server-side streaming (not a 302 redirect) means:
//  - MinIO is called server-to-server inside Docker (Linux fs — no Windows colon issue)
//  - The browser never touches the raw MinIO URL
//  - PDFs render natively in <iframe>, images display inline
//  - Works for both local MinIO and production S3

import { requireAuth, jsonError, handleUnexpected } from '@/server/services/api-helpers'
import { db } from '@/lib/db'
import { presignDownload } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { id } = await ctx.params
  try {
    const doc = await db.document.findFirst({
      where: { id, deletedAt: null },
      select: { s3Key: true, mimeType: true, title: true },
    })
    if (!doc?.s3Key) return jsonError('NOT_FOUND', 'Document not found', 404)

    // Generate presigned URL — used server-side only
    const signedUrl = await presignDownload(doc.s3Key, 3600)

    // Fetch from MinIO server-to-server (Docker internal network, Linux FS — no colon issue)
    const upstream = await fetch(signedUrl)
    if (!upstream.ok) {
      console.error(`[document/view] MinIO fetch failed: ${upstream.status} for key=${doc.s3Key}`)
      return jsonError('UPSTREAM_ERROR', 'Could not retrieve document from storage', 502)
    }

    const contentType = doc.mimeType ?? upstream.headers.get('content-type') ?? 'application/octet-stream'
    const filename = (doc.title ?? 'document').replace(/[^a-zA-Z0-9._\- ]/g, '_')

    // Stream bytes to the browser with inline disposition so PDFs render in the iframe
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
        // Needed for iframe in same-origin context
        'X-Frame-Options': 'SAMEORIGIN',
      },
    })
  } catch (err) {
    return handleUnexpected(err)
  }
}
