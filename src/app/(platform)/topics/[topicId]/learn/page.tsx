'use client'

import Link from 'next/link'
import { useParams, notFound } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Clock,
  GraduationCap,
  Sparkles,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TOPIC_BY_ID } from '@/lib/constants'
import { getLearnSubTopics } from '@/lib/learn-content'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'
import { cn } from '@/lib/utils'

export default function LearnIndexPage() {
  const params = useParams<{ topicId: string }>()
  const topicId = params.topicId
  const topic = TOPIC_BY_ID[topicId]

  if (!topic) {
    notFound()
  }

  const subTopics = getLearnSubTopics(topicId)

  return (
    <PageTransition className="space-y-6">
      {/* Back link */}
      <StaggerItem>
        <Link
          href={`/topics/${topicId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to {topic.shortLabel}
        </Link>
      </StaggerItem>

      {/* Hero */}
      <StaggerItem>
        <div className={cn('relative overflow-hidden rounded-2xl border-2 p-6', topic.border)}>
          <div className={cn('pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-20 blur-3xl', topic.bg)} />
          <div className="relative flex items-start gap-4">
            <div className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl', topic.bg)}>
              <GraduationCap className={cn('size-7', topic.color)} />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Learn mode</p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {topic.label}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a sub-topic below. Each module has reading content from authoritative international sources,
                an interactive game, quiz, pearls, and clinical cases — in that order.
              </p>
            </div>
          </div>
        </div>
      </StaggerItem>

      {/* Sub-topic cards */}
      {subTopics.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subTopics.map((st, i) => (
            <Link key={st.id} href={`/topics/${topicId}/learn/${st.id}`} className="group block">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -3 }}
              >
                <Card className="relative h-full overflow-hidden border-2 transition-all hover:border-teal-500/40 hover:shadow-lg">
                  {/* Decorative blob */}
                  <div className={cn('pointer-events-none absolute -right-8 -top-8 size-24 rounded-full opacity-25 blur-2xl', topic.bg)} />

                  <CardContent className="relative flex h-full flex-col gap-3 pt-1">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className={cn('flex size-11 items-center justify-center rounded-xl', topic.bg)}>
                        <BookOpen className={cn('size-5', topic.color)} />
                      </div>
                      <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </div>

                    {/* Title + desc */}
                    <div>
                      <h3 className="text-base font-bold text-foreground">{st.label}</h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{st.description}</p>
                    </div>

                    {/* Meta badges */}
                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Clock className="size-2.5" /> ~{st.readMinutes} min read
                      </Badge>
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Sparkles className="size-2.5" /> Game + Quiz
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">{st.read.length} sections</Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </Link>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl border border-dashed border-border/60 py-12 text-center"
        >
          <GraduationCap className="mx-auto mb-3 size-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">Content is being authored</p>
          <p className="mt-1 text-xs text-muted-foreground">Sub-topic modules for {topic.shortLabel} are on the way. Check back soon.</p>
        </motion.div>
      )}
    </PageTransition>
  )
}
