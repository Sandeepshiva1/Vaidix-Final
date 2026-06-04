// ════════════════════════════════════════════════════════════════════════════
// Engagement Service — likes & bookmarks
// ════════════════════════════════════════════════════════════════════════════
// Toggle + count helpers for PearlLike (pearl-specific likes) and Bookmark
// (generic — pearls, recordings, atlas, documents). Server-only.
//
// Bookmarks are user-scoped private favourites. Likes are public counters
// (the count is shown to all users; the per-user "did I like this" is shown
// only to the requesting user).

import { db } from '@/lib/db'

export type BookmarkTargetType =
  | 'PEARL'
  | 'RECORDING'
  | 'COURSE_ITEM'
  | 'ATLAS_IMAGE'
  | 'DOCUMENT'

// ────────────────────────────────────────────────────────────────────────────
// Pearl likes
// ────────────────────────────────────────────────────────────────────────────

export async function togglePearlLike(args: { pearlId: string; userId: string }) {
  const existing = await db.pearlLike.findUnique({
    where: { pearlId_userId: { pearlId: args.pearlId, userId: args.userId } },
  })
  if (existing) {
    await db.pearlLike.delete({ where: { id: existing.id } })
    return { liked: false }
  }
  await db.pearlLike.create({
    data: { pearlId: args.pearlId, userId: args.userId },
  })
  return { liked: true }
}

export async function getPearlLikeState(args: { pearlIds: string[]; userId: string }) {
  if (args.pearlIds.length === 0) return { likeCounts: new Map<string, number>(), likedByMe: new Set<string>() }
  const [counts, mine] = await Promise.all([
    db.pearlLike.groupBy({
      by: ['pearlId'],
      where: { pearlId: { in: args.pearlIds } },
      _count: { _all: true },
    }),
    db.pearlLike.findMany({
      where: { userId: args.userId, pearlId: { in: args.pearlIds } },
      select: { pearlId: true },
    }),
  ])
  return {
    likeCounts: new Map(counts.map((c) => [c.pearlId, c._count._all])),
    likedByMe: new Set(mine.map((m) => m.pearlId)),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Bookmarks (generic)
// ────────────────────────────────────────────────────────────────────────────

export async function toggleBookmark(args: {
  userId: string
  targetType: BookmarkTargetType
  targetId: string
  note?: string | null
}) {
  const existing = await db.bookmark.findFirst({
    where: { userId: args.userId, targetType: args.targetType, targetId: args.targetId },
  })
  if (existing) {
    await db.bookmark.delete({ where: { id: existing.id } })
    return { bookmarked: false }
  }
  await db.bookmark.create({
    data: {
      userId: args.userId,
      targetType: args.targetType,
      targetId: args.targetId,
      note: args.note ?? null,
    },
  })
  return { bookmarked: true }
}

export async function getBookmarkState(args: {
  userId: string
  targetType: BookmarkTargetType
  targetIds: string[]
}) {
  if (args.targetIds.length === 0) return new Set<string>()
  const rows = await db.bookmark.findMany({
    where: {
      userId: args.userId,
      targetType: args.targetType,
      targetId: { in: args.targetIds },
    },
    select: { targetId: true },
  })
  return new Set(rows.map((r) => r.targetId))
}
