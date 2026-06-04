import { notFound, redirect } from 'next/navigation'
import { Prisma, Role, DocumentRoute } from '@prisma/client'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { presignDownload } from '@/lib/storage'
import { loadSessionView } from '@/lib/medlearn/session-view'
import {
  PromoClient,
  type PromoBootstrap,
  type PromoMeta,
  type PromoAsset,
  type PromoTemplate,
} from './promo-client'

export const dynamic = 'force-dynamic'

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN]

const TEMPLATES: PromoTemplate[] = ['flyer', 'whatsapp_banner', 'instagram_card']

interface PageProps {
  params: Promise<{ id: string }>
}

// ── Saved select/approve/sent flags (TeachingSession.metadata.promoAssets) ────
// Mirrors readPromoMeta in the route so the first paint matches GET exactly.
function readPromoMeta(metadata: Prisma.JsonValue | null): PromoMeta {
  const empty: PromoMeta = { selected: [], approved: [], sent: false, updatedAt: '' }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return empty
  const raw = (metadata as Record<string, unknown>).promoAssets
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty
  const r = raw as Record<string, unknown>
  const asTemplates = (v: unknown): PromoTemplate[] =>
    Array.isArray(v) ? v.filter((x): x is PromoTemplate => (TEMPLATES as string[]).includes(x as string)) : []
  return {
    selected: asTemplates(r.selected),
    approved: asTemplates(r.approved),
    sent: r.sent === true,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  }
}

function templateOfTitle(title: string): PromoTemplate | null {
  const lower = title.toLowerCase()
  if (lower.includes('flyer')) return 'flyer'
  if (lower.includes('whatsapp')) return 'whatsapp_banner'
  if (lower.includes('instagram')) return 'instagram_card'
  return null
}

// ── Real generated assets (PROMO_ASSET Documents) with presigned SVG URLs ─────
// Same query/logic the route's GET uses, called directly here for first paint.
// Storage being offline (network-blocked env) must NOT 500 the page — degrade
// to empty assets + a storageOffline flag so the client shows the offline state.
async function loadBootstrap(sessionId: string, metadata: Prisma.JsonValue | null): Promise<PromoBootstrap> {
  const meta = readPromoMeta(metadata)
  try {
    const docs = await db.document.findMany({
      where: {
        route: DocumentRoute.PROMO_ASSET,
        deletedAt: null,
        sessionLinks: { some: { sessionId } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, s3Key: true, createdAt: true },
    })
    const latest = new Map<PromoTemplate, (typeof docs)[number]>()
    for (const d of docs) {
      const t = templateOfTitle(d.title)
      if (t && !latest.has(t)) latest.set(t, d)
    }
    const assets: PromoAsset[] = []
    for (const template of TEMPLATES) {
      const d = latest.get(template)
      if (!d) continue
      const svgUrl = await presignDownload(d.s3Key, 60 * 30)
      assets.push({ template, documentId: d.id, title: d.title, svgUrl, createdAt: d.createdAt.toISOString() })
    }
    return { meta, assets, storageOffline: false }
  } catch {
    // Object store unreachable → keep saved flags, drop the (unrenderable) assets.
    return { meta, assets: [], storageOffline: true }
  }
}

export default async function PromoPage({ params }: PageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect(`/login?next=/session/${id}/promo`)

  const view = await loadSessionView(id)
  if (!view) notFound()

  // Promo authoring is host / faculty-only.
  const isHost = view.hostId === session.user.id
  if (!isHost && !FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard')

  // Load saved promo flags + any real generated assets (route GET logic).
  const row = await db.teachingSession.findFirst({
    where: { id, deletedAt: null },
    select: { metadata: true },
  })
  const bootstrap = await loadBootstrap(id, row?.metadata ?? null)

  return <PromoClient session={view} bootstrap={bootstrap} />
}
