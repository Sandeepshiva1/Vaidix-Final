import { redirect } from 'next/navigation'
import { Lightbulb } from 'lucide-react'
import { auth } from '@/auth'
import { getPearlLikeState, getBookmarkState } from '@/server/services/engagement-service'
import { PageTransition, StaggerItem } from '@/lib/motion'
import { PearlsList, type PearlCard } from './pearls-list'
import pearlsData from '@/mock-data/pearls.json'

interface MockPearl {
  id: string
  question: string
  answer: string
  mechanism: string
  condition: string
  subspecialty: string
  category: string
  citation: { authors: string; title: string; journal: string; year: number; doi: string }
  bloomsLevel: number
  tags: string[]
  difficulty: string
}

export default async function PearlsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  // Pearls content currently lives in mock-data/pearls.json. The DB has the
  // same IDs (seeded via prisma/seed.ts), so engagement state (likes,
  // bookmarks) joins cleanly on `pearl.id`. When richer pearl content lives
  // in the Pearl table itself (W9), this read will switch to db.pearl.findMany.
  const pearls = pearlsData as MockPearl[]
  const ids = pearls.map((p) => p.id)

  const [likeState, bookmarkSet] = await Promise.all([
    getPearlLikeState({ pearlIds: ids, userId: session.user.id }),
    getBookmarkState({ userId: session.user.id, targetType: 'PEARL', targetIds: ids }),
  ])

  const cards: PearlCard[] = pearls.map((p) => ({
    id: p.id,
    question: p.question,
    answer: p.answer,
    mechanism: p.mechanism,
    condition: p.condition,
    subspecialty: p.subspecialty,
    category: p.category,
    citation: p.citation,
    bloomsLevel: p.bloomsLevel,
    tags: p.tags,
    difficulty: p.difficulty,
    likeCount: likeState.likeCounts.get(p.id) ?? 0,
    likedByMe: likeState.likedByMe.has(p.id),
    bookmarkedByMe: bookmarkSet.has(p.id),
  }))

  return (
    <PageTransition className="space-y-6">
      <StaggerItem>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center rounded-lg bg-amber-500/10 p-2">
            <Lightbulb className="size-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Clinical Pearls</h1>
            <p className="text-sm text-muted-foreground">
              Bite-sized wisdom from faculty teaching rounds
            </p>
          </div>
        </div>
      </StaggerItem>

      <PearlsList pearls={cards} />
    </PageTransition>
  )
}
