'use client'

import { useState, useTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart, Bookmark, Share2, GraduationCap, ChevronDown, ChevronUp, Check, Gem, Quote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { togglePearlLikeAction, toggleBookmarkAction } from '@/app/(platform)/pearls/actions'

export interface SessionPearl {
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
  likeCount: number
  likedByMe: boolean
  bookmarkedByMe: boolean
}

const difficultyStyle: Record<string, string> = {
  beginner: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  intermediate: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  advanced: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
}

const bloomsLabels: Record<number, string> = {
  1: 'Remember', 2: 'Understand', 3: 'Apply', 4: 'Analyze', 5: 'Evaluate', 6: 'Create',
}

interface OptimisticState {
  likedByMe: boolean
  likeCount: number
  bookmarkedByMe: boolean
}

interface Props {
  pearls: SessionPearl[]
}

export function SessionPearlsTab({ pearls }: Props) {
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, OptimisticState>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const stateFor = (p: SessionPearl): OptimisticState =>
    overrides[p.id] ?? { likedByMe: p.likedByMe, likeCount: p.likeCount, bookmarkedByMe: p.bookmarkedByMe }

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleLike(p: SessionPearl) {
    const cur = stateFor(p)
    const next = { ...cur, likedByMe: !cur.likedByMe, likeCount: cur.likedByMe ? cur.likeCount - 1 : cur.likeCount + 1 }
    setOverrides((s) => ({ ...s, [p.id]: next }))
    startTransition(async () => {
      try { await togglePearlLikeAction(p.id) }
      catch { setOverrides((s) => ({ ...s, [p.id]: cur })) }
    })
  }

  function handleBookmark(p: SessionPearl) {
    const cur = stateFor(p)
    const next = { ...cur, bookmarkedByMe: !cur.bookmarkedByMe }
    setOverrides((s) => ({ ...s, [p.id]: next }))
    startTransition(async () => {
      try { await toggleBookmarkAction('PEARL', p.id) }
      catch { setOverrides((s) => ({ ...s, [p.id]: cur })) }
    })
  }

  async function handleShare(p: SessionPearl) {
    const url = `${window.location.origin}/pearls#${p.id}`
    try {
      if (navigator.share) await navigator.share({ title: 'Vaidix Pearl', text: p.question, url })
      else {
        await navigator.clipboard.writeText(url)
        setCopiedId(p.id)
        window.setTimeout(() => setCopiedId((cur) => (cur === p.id ? null : cur)), 2000)
      }
    } catch { /* user cancelled */ }
  }

  if (pearls.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex items-center justify-center rounded-full bg-primary/10 p-4">
          <Gem className="size-6 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">No pearls yet for this session</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Clinical pearls linked to this topic will appear here after AI processing.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{pearls.length}</span> pearl{pearls.length !== 1 ? 's' : ''} from this session topic
      </p>
      {pearls.map((pearl, idx) => {
        const isRevealed = revealedIds.has(pearl.id)
        const s = stateFor(pearl)
        return (
          <motion.div
            key={pearl.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            {/* Pearl header */}
            <div className="space-y-2.5 p-4">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
                  difficultyStyle[pearl.difficulty] ?? 'bg-muted text-muted-foreground'
                )}>
                  {pearl.difficulty}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                  <GraduationCap className="size-2.5" />
                  {bloomsLabels[pearl.bloomsLevel] ?? `L${pearl.bloomsLevel}`}
                </span>
              </div>

              <p className="text-[14px] font-semibold italic leading-snug text-foreground">
                &ldquo;{pearl.question}&rdquo;
              </p>
              <p className="text-[11px] font-medium text-muted-foreground">{pearl.condition}</p>

              <div className="flex flex-wrap gap-1">
                {pearl.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-0.5">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleLike(pearl)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                      s.likedByMe
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <Heart className={cn('size-3', s.likedByMe && 'fill-current')} />
                    <span className="tabular-nums">{s.likeCount}</span>
                  </button>
                  <button
                    onClick={() => handleBookmark(pearl)}
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-full border transition-colors',
                      s.bookmarkedByMe
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <Bookmark className={cn('size-3', s.bookmarkedByMe && 'fill-current')} />
                  </button>
                  <button
                    onClick={() => handleShare(pearl)}
                    className="inline-flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
                  >
                    {copiedId === pearl.id ? <Check className="size-3 text-primary" /> : <Share2 className="size-3" />}
                  </button>
                </div>
                <button
                  onClick={() => toggleReveal(pearl.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    isRevealed
                      ? 'bg-primary/10 text-primary hover:bg-primary/15'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  )}
                >
                  {isRevealed ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {isRevealed ? 'Hide' : 'Reveal'}
                </button>
              </div>
            </div>

            {/* Reveal panel */}
            <AnimatePresence initial={false}>
              {isRevealed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="border-t border-border/60 bg-muted/30 px-4 py-4 space-y-3">
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">Answer</p>
                      <p className="text-sm font-semibold leading-relaxed">{pearl.answer}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mechanism</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{pearl.mechanism}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <Quote className="mt-0.5 size-3 shrink-0 text-muted-foreground/50" />
                        <div className="space-y-0.5">
                          <p className="text-[10px] leading-relaxed text-foreground">
                            {pearl.citation.authors}. <span className="italic">{pearl.citation.journal}</span>.{' '}
                            <span className="font-bold">{pearl.citation.year}</span>.
                          </p>
                          {pearl.citation.doi && (
                            <p className="text-[9px] text-muted-foreground">DOI: {pearl.citation.doi}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )
      })}
    </div>
  )
}
