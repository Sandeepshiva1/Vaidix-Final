import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Bookmark, Lightbulb, Video, ArrowRight, Calendar } from 'lucide-react'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageTransition, StaggerItem } from '@/lib/motion'
import pearlsData from '@/mock-data/pearls.json'
import { BookmarkRowActions } from './bookmark-row-actions'

interface MockPearl {
  id: string
  question: string
  condition: string
  category: string
  difficulty: string
}

export default async function BookmarksPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const bookmarks = await db.bookmark.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, targetType: true, targetId: true, note: true, createdAt: true },
  })

  const recordingIds = bookmarks.filter((b) => b.targetType === 'RECORDING').map((b) => b.targetId)

  const pearls = pearlsData as MockPearl[]
  const pearlMap = new Map(pearls.map((p) => [p.id, p]))

  const recordings = recordingIds.length
    ? await db.recording.findMany({
        where: { id: { in: recordingIds } },
        select: {
          id: true,
          durationSec: true,
          session: {
            select: {
              id: true,
              title: true,
              sessionType: true,
              scheduledStart: true,
              host: { select: { name: true } },
            },
          },
        },
      })
    : []
  const recordingMap = new Map(recordings.map((r) => [r.id, r]))

  const pearlBookmarks = bookmarks
    .filter((b) => b.targetType === 'PEARL')
    .map((b) => ({ ...b, pearl: pearlMap.get(b.targetId) ?? null }))

  const recordingBookmarks = bookmarks
    .filter((b) => b.targetType === 'RECORDING')
    .map((b) => ({ ...b, recording: recordingMap.get(b.targetId) ?? null }))

  const totalCount = bookmarks.length

  return (
    <PageTransition className="space-y-6">
      <StaggerItem>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Saved</h1>
          </div>
          <span className="text-xs text-muted-foreground">
            {totalCount} {totalCount === 1 ? 'item' : 'items'}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Your bookmarked pearls and recordings.
        </p>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="size-4 text-amber-600" />
              Pearls
              <span className="text-xs font-normal text-muted-foreground">({pearlBookmarks.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pearlBookmarks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved pearls yet.{' '}
                <Link href="/pearls" className="font-medium text-primary hover:underline">
                  Browse pearls →
                </Link>
              </p>
            ) : (
              <ul className="space-y-2">
                {pearlBookmarks.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  >
                    <Link
                      href={`/pearls#${b.targetId}`}
                      className="min-w-0 flex-1 group"
                    >
                      {b.pearl ? (
                        <>
                          <p className="line-clamp-2 text-sm font-medium italic group-hover:text-primary">
                            &ldquo;{b.pearl.question}&rdquo;
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{b.pearl.condition}</span>
                            <span>·</span>
                            <span className="capitalize">{b.pearl.difficulty}</span>
                            <span>·</span>
                            <span>Saved {new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Pearl no longer available</p>
                      )}
                    </Link>
                    <BookmarkRowActions targetType="PEARL" targetId={b.targetId} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Video className="size-4 text-rose-600" />
              Recordings
              <span className="text-xs font-normal text-muted-foreground">({recordingBookmarks.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recordingBookmarks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No saved recordings yet.{' '}
                <Link href="/classroom" className="font-medium text-primary hover:underline">
                  Browse classroom →
                </Link>
              </p>
            ) : (
              <ul className="space-y-2">
                {recordingBookmarks.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  >
                    <Link
                      href={b.recording ? `/classroom/${b.recording.session.id}/recording` : '/classroom'}
                      className="min-w-0 flex-1 group"
                    >
                      {b.recording ? (
                        <>
                          <p className="truncate text-sm font-semibold group-hover:text-primary">
                            {b.recording.session.title}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{b.recording.session.sessionType.replace(/_/g, ' ').toLowerCase()}</span>
                            {b.recording.session.host?.name && (
                              <>
                                <span>·</span>
                                <span>by {b.recording.session.host.name}</span>
                              </>
                            )}
                            <span>·</span>
                            <Calendar className="size-3" />
                            <span>
                              {new Date(b.recording.session.scheduledStart).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                            {b.recording.durationSec && (
                              <>
                                <span>·</span>
                                <span>{Math.round(b.recording.durationSec / 60)} min</span>
                              </>
                            )}
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">Recording no longer available</p>
                      )}
                    </Link>
                    <div className="flex items-center gap-2">
                      {b.recording && (
                        <Link
                          href={`/classroom/${b.recording.session.id}/recording`}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Watch
                          <ArrowRight className="size-3" />
                        </Link>
                      )}
                      <BookmarkRowActions targetType="RECORDING" targetId={b.targetId} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </StaggerItem>
    </PageTransition>
  )
}
