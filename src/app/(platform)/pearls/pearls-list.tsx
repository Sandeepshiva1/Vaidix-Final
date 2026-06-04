'use client'

import { useState, useMemo, useTransition } from 'react'
import {
  Search,
  ChevronDown,
  ChevronUp,
  Heart,
  Bookmark,
  Share2,
  Quote,
  GraduationCap,
  Check,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { motion } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { togglePearlLikeAction, toggleBookmarkAction } from './actions'

export interface PearlCard {
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

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'infection', label: 'Infections' },
  { key: 'inflammation', label: 'Diagnostics' },
  { key: 'autoimmune', label: 'Clinical Signs' },
  { key: 'pharmacology', label: 'Pharmacology' },
] as const

const DIFFICULTY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'advanced', label: 'Advanced' },
] as const

const categoryStyle: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  infection: { bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-400', ring: 'ring-rose-200 dark:ring-rose-800', label: 'Infection' },
  inflammation: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-400', ring: 'ring-blue-200 dark:ring-blue-800', label: 'Diagnostics' },
  autoimmune: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', ring: 'ring-amber-200 dark:ring-amber-800', label: 'Clinical Signs' },
  pharmacology: { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-400', ring: 'ring-purple-200 dark:ring-purple-800', label: 'Pharmacology' },
  neoplastic: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', ring: 'ring-emerald-200 dark:ring-emerald-800', label: 'Neoplastic' },
}

const difficultyStyle: Record<string, string> = {
  beginner: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  intermediate: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  advanced: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

const bloomsLabels: Record<number, string> = {
  1: 'Remember',
  2: 'Understand',
  3: 'Apply',
  4: 'Analyze',
  5: 'Evaluate',
  6: 'Create',
}

interface Props {
  pearls: PearlCard[]
}

interface OptimisticState {
  likedByMe: boolean
  likeCount: number
  bookmarkedByMe: boolean
}

export function PearlsList({ pearls: initial }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [activeDifficulty, setActiveDifficulty] = useState<string>('all')
  const [savedOnly, setSavedOnly] = useState(false)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, OptimisticState>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const stateFor = (p: PearlCard): OptimisticState =>
    overrides[p.id] ?? {
      likedByMe: p.likedByMe,
      likeCount: p.likeCount,
      bookmarkedByMe: p.bookmarkedByMe,
    }

  const filteredPearls = useMemo(() => {
    return initial.filter((p) => {
      if (activeCategory !== 'all' && p.category !== activeCategory) return false
      if (activeDifficulty !== 'all' && p.difficulty !== activeDifficulty) return false
      if (savedOnly) {
        // Read from optimistic overrides so a just-bookmarked pearl stays
        // visible even before a refresh.
        const cur = overrides[p.id]?.bookmarkedByMe ?? p.bookmarkedByMe
        if (!cur) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return (
          p.question.toLowerCase().includes(q) ||
          p.condition.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.answer.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [initial, searchQuery, activeCategory, activeDifficulty, savedOnly, overrides])

  function toggleReveal(id: string) {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleLike(p: PearlCard) {
    const cur = stateFor(p)
    const next = {
      ...cur,
      likedByMe: !cur.likedByMe,
      likeCount: cur.likedByMe ? cur.likeCount - 1 : cur.likeCount + 1,
    }
    setOverrides((s) => ({ ...s, [p.id]: next }))
    startTransition(async () => {
      try {
        await togglePearlLikeAction(p.id)
      } catch {
        // Revert on failure
        setOverrides((s) => ({ ...s, [p.id]: cur }))
      }
    })
  }

  function handleBookmark(p: PearlCard) {
    const cur = stateFor(p)
    const next = { ...cur, bookmarkedByMe: !cur.bookmarkedByMe }
    setOverrides((s) => ({ ...s, [p.id]: next }))
    startTransition(async () => {
      try {
        await toggleBookmarkAction('PEARL', p.id)
      } catch {
        setOverrides((s) => ({ ...s, [p.id]: cur }))
      }
    })
  }

  async function handleShare(p: PearlCard) {
    const url = `${window.location.origin}/pearls#${p.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Vaidix Pearl', text: p.question, url })
      } else {
        await navigator.clipboard.writeText(url)
        setCopiedId(p.id)
        window.setTimeout(() => setCopiedId((cur) => (cur === p.id ? null : cur)), 2000)
      }
    } catch {
      // user cancelled share or clipboard failed — silent
    }
  }

  const getCatStyle = (cat: string) =>
    categoryStyle[cat] ?? { bg: 'bg-gray-50 dark:bg-gray-900', text: 'text-gray-700 dark:text-gray-300', ring: 'ring-gray-200 dark:ring-gray-700', label: cat }

  return (
    <>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search pearls by question, condition, or tag..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Category:</span>
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveCategory(f.key)}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeCategory === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Difficulty:</span>
          {DIFFICULTY_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveDifficulty(f.key)}
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeDifficulty === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => setSavedOnly((v) => !v)}
            className={cn(
              'ml-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              savedOnly
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            )}
          >
            <Bookmark className={cn('size-3', savedOnly && 'fill-current')} />
            Saved only
          </button>
        </div>
      </div>

      <Separator />

      <p className="text-xs text-muted-foreground">
        Showing <span className="font-semibold text-foreground">{filteredPearls.length}</span>{' '}
        {filteredPearls.length === 1 ? 'pearl' : 'pearls'}
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {filteredPearls.map((pearl, index) => {
          const isRevealed = revealedIds.has(pearl.id)
          const cat = getCatStyle(pearl.category)
          const s = stateFor(pearl)
          return (
            <motion.div
              key={pearl.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <Card id={pearl.id} className="relative">
                <CardContent className="space-y-4 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${cat.bg} ${cat.text} ${cat.ring}`}>
                      {cat.label}
                    </span>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${difficultyStyle[pearl.difficulty] ?? 'bg-gray-100 text-gray-700'}`}>
                      {pearl.difficulty}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[15px] font-semibold leading-relaxed tracking-tight italic text-foreground">
                      &ldquo;{pearl.question}&rdquo;
                    </p>
                    <p className="text-xs font-medium text-muted-foreground">{pearl.condition}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                      <GraduationCap className="size-3" />
                      {bloomsLabels[pearl.bloomsLevel] ?? `Level ${pearl.bloomsLevel}`}
                    </span>
                    {pearl.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Action row — like, bookmark, share, reveal */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleLike(pearl)}
                        disabled={isPending}
                        aria-label={s.likedByMe ? 'Unlike pearl' : 'Like pearl'}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                          s.likedByMe
                            ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted'
                        )}
                      >
                        <Heart className={cn('size-3.5', s.likedByMe && 'fill-current')} />
                        <span className="tabular-nums">{s.likeCount}</span>
                      </button>
                      <button
                        onClick={() => handleBookmark(pearl)}
                        disabled={isPending}
                        aria-label={s.bookmarkedByMe ? 'Remove bookmark' : 'Bookmark'}
                        className={cn(
                          'inline-flex size-7 items-center justify-center rounded-full border transition-colors',
                          s.bookmarkedByMe
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'border-border bg-background text-muted-foreground hover:bg-muted'
                        )}
                      >
                        <Bookmark className={cn('size-3.5', s.bookmarkedByMe && 'fill-current')} />
                      </button>
                      <button
                        onClick={() => handleShare(pearl)}
                        aria-label="Share pearl"
                        className="inline-flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
                      >
                        {copiedId === pearl.id ? <Check className="size-3.5 text-emerald-600" /> : <Share2 className="size-3.5" />}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-400 dark:hover:bg-teal-950/30"
                      onClick={() => toggleReveal(pearl.id)}
                    >
                      {isRevealed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      {isRevealed ? 'Hide' : 'Reveal'}
                    </Button>
                  </div>
                </CardContent>

                <div
                  className="overflow-hidden transition-all duration-300 ease-in-out"
                  style={{ maxHeight: isRevealed ? '800px' : '0px', opacity: isRevealed ? 1 : 0 }}
                >
                  <div className="border-t border-border/60" />
                  <CardContent className="space-y-4 pb-2 pt-4">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Answer</p>
                      <p className="text-sm font-semibold leading-relaxed text-foreground">{pearl.answer}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mechanism</p>
                      <p className="text-sm leading-relaxed text-muted-foreground">{pearl.mechanism}</p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 px-3.5 py-3 dark:bg-muted/10">
                      <div className="flex items-start gap-2.5">
                        <Quote className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-xs leading-relaxed text-foreground">
                            {pearl.citation.authors}. {pearl.citation.title}.{' '}
                            <span className="italic">{pearl.citation.journal}</span>.{' '}
                            <span className="font-bold">{pearl.citation.year}</span>.
                          </p>
                          {pearl.citation.doi && (
                            <p className="text-[11px] text-muted-foreground">DOI: {pearl.citation.doi}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </div>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {filteredPearls.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex items-center justify-center rounded-full bg-muted p-4">
            <Search className="size-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No pearls found</p>
            <p className="text-xs text-muted-foreground">Try adjusting your search or filters</p>
          </div>
        </div>
      )}
    </>
  )
}
