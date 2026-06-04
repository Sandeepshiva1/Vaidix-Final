'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  LayoutGrid,
  Search,
  ArrowRight,
  Eye,
  Flame,
  Droplet,
  Aperture,
  Circle,
  Baby,
  Brain,
  Scissors,
  Ribbon,
  Sparkles,
  CircleDot,
  Stethoscope,
  EyeOff,
  Dna,
  AlertTriangle,
  BookOpen,
  ScanEye,
  Lock,
  type LucideIcon,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { TOPICS } from '@/lib/constants'
import { PageTransition, StaggerItem, AnimatedCounter, motion } from '@/lib/motion'
import { cn } from '@/lib/utils'
import casesData from '@/mock-data/cases.json'
import pearlsData from '@/mock-data/pearls.json'
import atlasData from '@/mock-data/signs-atlas.json'
import type { ClinicalCase, Pearl, AtlasSign } from '@/lib/types'

const cases = casesData as unknown as ClinicalCase[]
const pearls = pearlsData as unknown as Pearl[]
const atlas = atlasData as unknown as AtlasSign[]

const ICON_MAP: Record<string, LucideIcon> = {
  Eye, Flame, Droplet, Aperture, Circle, Baby, Brain, Scissors,
  Ribbon, Sparkles, CircleDot, Stethoscope, EyeOff, Dna, AlertTriangle,
}

// Top gradient wash for each topic card's header panel
const CARD_GRADIENT: Record<string, string> = {
  retina:           'from-rose-500/20 to-rose-500/5',
  uvea:             'from-orange-500/20 to-orange-500/5',
  glaucoma:         'from-blue-500/20 to-blue-500/5',
  cornea:           'from-cyan-500/20 to-cyan-500/5',
  cataract:         'from-amber-500/20 to-amber-500/5',
  pediatric:        'from-pink-500/20 to-pink-500/5',
  neuro:            'from-purple-500/20 to-purple-500/5',
  oculoplasty:      'from-indigo-500/20 to-indigo-500/5',
  oncology:         'from-fuchsia-500/20 to-fuchsia-500/5',
  refractive:       'from-violet-500/20 to-violet-500/5',
  'contact-lens':   'from-teal-500/20 to-teal-500/5',
  comprehensive:    'from-emerald-500/20 to-emerald-500/5',
  'low-vision':     'from-slate-500/20 to-slate-500/5',
  genetics:         'from-lime-500/20 to-lime-500/5',
  prosthesis:       'from-stone-500/20 to-stone-500/5',
  emergency:        'from-red-500/20 to-red-500/5',
}

// Hover shadow glow per topic
const CARD_SHADOW: Record<string, string> = {
  retina:           'group-hover:shadow-rose-500/15',
  uvea:             'group-hover:shadow-orange-500/15',
  glaucoma:         'group-hover:shadow-blue-500/15',
  cornea:           'group-hover:shadow-cyan-500/15',
  cataract:         'group-hover:shadow-amber-500/15',
  pediatric:        'group-hover:shadow-pink-500/15',
  neuro:            'group-hover:shadow-purple-500/15',
  oculoplasty:      'group-hover:shadow-indigo-500/15',
  oncology:         'group-hover:shadow-fuchsia-500/15',
  refractive:       'group-hover:shadow-violet-500/15',
  'contact-lens':   'group-hover:shadow-teal-500/15',
  comprehensive:    'group-hover:shadow-emerald-500/15',
  'low-vision':     'group-hover:shadow-slate-500/15',
  genetics:         'group-hover:shadow-lime-500/15',
  prosthesis:       'group-hover:shadow-stone-500/15',
  emergency:        'group-hover:shadow-red-500/15',
}

const FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'posterior', label: 'Posterior' },
  { id: 'anterior',  label: 'Anterior' },
  { id: 'neuro',     label: 'Neuro & Plasty' },
  { id: 'special',   label: 'Specialty' },
  { id: 'empty',     label: 'Coming Soon' },
]

const TOPIC_CATEGORY: Record<string, string> = {
  retina: 'posterior', uvea: 'posterior', glaucoma: 'posterior',
  cornea: 'anterior', cataract: 'anterior', 'contact-lens': 'anterior', refractive: 'anterior',
  neuro: 'neuro', oculoplasty: 'neuro',
  oncology: 'special', genetics: 'special', 'low-vision': 'special',
  prosthesis: 'special', emergency: 'special', pediatric: 'special', comprehensive: 'special',
}

interface Counted { cases: number; pearls: number; atlas: number }

export default function TopicsIndexPage() {
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')

  const counts: Record<string, Counted> = useMemo(() => {
    const out: Record<string, Counted> = {}
    TOPICS.forEach((t) => (out[t.id] = { cases: 0, pearls: 0, atlas: 0 }))
    cases.forEach((c) => {
      const tid = c.topic ?? 'comprehensive'
      if (out[tid]) out[tid].cases++
    })
    pearls.forEach((p) => {
      const tid = p.topic ?? 'uvea'
      if (out[tid]) out[tid].pearls++
    })
    atlas.forEach((s) => {
      const tid = s.topic ?? 'comprehensive'
      if (out[tid]) out[tid].atlas++
    })
    return out
  }, [])

  const visibleTopics = useMemo(() => {
    const q = query.trim().toLowerCase()
    return TOPICS.filter((t) => {
      const matchesQuery =
        !q ||
        t.label.toLowerCase().includes(q) ||
        t.shortLabel.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      const c = counts[t.id]
      const isEmpty = c.cases + c.pearls + c.atlas === 0
      const matchesFilter =
        activeFilter === 'all' ||
        (activeFilter === 'empty' && isEmpty) ||
        TOPIC_CATEGORY[t.id] === activeFilter
      return matchesQuery && matchesFilter
    })
  }, [query, activeFilter, counts])

  const totalCases  = cases.length
  const totalPearls = pearls.length
  const totalAtlas  = atlas.length

  return (
    <PageTransition className="space-y-5">

      {/* ── Hero band ─────────────────────────────────────────────────────── */}
      <StaggerItem>
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-linear-to-br from-teal-500/8 via-background/80 to-violet-500/8 p-5">
          {/* Decorative orbs */}
          <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-teal-400/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/2 size-32 rounded-full bg-violet-400/8 blur-2xl" />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Icon + title */}
            <div className="flex flex-1 items-center gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-teal-500 to-blue-600 shadow-lg shadow-teal-500/25">
                <LayoutGrid className="size-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Topics</h1>
                <p className="text-sm text-muted-foreground">
                  Choose a subspecialty to study cases, pearls, signs and simulators together
                </p>
              </div>
            </div>

            {/* Animated stat counters */}
            <div className="flex shrink-0 items-center gap-5">
              {([
                { label: 'Cases',  value: totalCases,  Icon: BookOpen,  bg: 'bg-blue-500/10',    text: 'text-blue-600 dark:text-blue-400'    },
                { label: 'Pearls', value: totalPearls, Icon: Sparkles,  bg: 'bg-amber-500/10',   text: 'text-amber-600 dark:text-amber-400'   },
                { label: 'Signs',  value: totalAtlas,  Icon: ScanEye,   bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
              ] as const).map(({ label, value, Icon, bg, text }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={cn('flex size-9 items-center justify-center rounded-xl', bg)}>
                    <Icon className={cn('size-4', text)} />
                  </div>
                  <div>
                    <p className="text-[11px] leading-none text-muted-foreground mb-0.5">{label}</p>
                    <p className="text-lg font-bold tabular-nums leading-none text-foreground">
                      <AnimatedCounter value={value} />
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </StaggerItem>

      {/* ── Search + Filter pills ─────────────────────────────────────────── */}
      <StaggerItem>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search */}
          <div className="relative w-full max-w-xs shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search topics..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-all duration-200',
                  activeFilter === f.id
                    ? 'bg-teal-600 text-white shadow-sm shadow-teal-600/30'
                    : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </StaggerItem>

      {/* ── Topic grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visibleTopics.map((topic, i) => {
          const Icon    = ICON_MAP[topic.icon] ?? Eye
          const c       = counts[topic.id]
          const isEmpty = c.cases + c.pearls + c.atlas === 0
          const gradient = CARD_GRADIENT[topic.id] ?? 'from-muted/20 to-transparent'
          const shadow   = CARD_SHADOW[topic.id]   ?? ''

          return (
            <Link key={topic.id} href={`/topics/${topic.id}`} className="group block">
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -6, transition: { duration: 0.18, ease: 'easeOut' } }}
                className="h-full"
              >
                <div
                  className={cn(
                    'relative flex h-full flex-col overflow-hidden rounded-2xl border-2 bg-card',
                    'shadow-md shadow-black/10',
                    'transition-all duration-300',
                    'group-hover:shadow-xl',
                    shadow,
                    topic.border,
                    isEmpty && 'opacity-55'
                  )}
                >
                  {/* ── Colored gradient top panel ── */}
                  <div className={cn('relative flex items-center justify-center py-6 bg-linear-to-b', gradient)}>
                    {/* Soft glow blob behind icon */}
                    <div className={cn(
                      'pointer-events-none absolute -right-4 -top-4 size-16 rounded-full blur-xl opacity-60',
                      topic.bg
                    )} />

                    {/* Icon badge */}
                    <div className={cn(
                      'relative flex size-12 items-center justify-center rounded-2xl shadow-md',
                      'transition-transform duration-200 group-hover:scale-110',
                      topic.bg
                    )}>
                      {isEmpty
                        ? <Lock className={cn('size-5 opacity-50', topic.color)} />
                        : <Icon className={cn('size-5', topic.color)} />
                      }
                    </div>
                  </div>

                  {/* ── Body ── */}
                  <div className="flex flex-1 flex-col gap-2 p-3 pt-2.5">
                    {/* Title + description */}
                    <div>
                      <h3 className="text-sm font-bold leading-snug text-foreground">
                        {topic.label}
                      </h3>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                        {topic.description}
                      </p>
                    </div>

                    {/* Resource pills */}
                    <div className="mt-auto flex flex-wrap gap-1 pt-1">
                      {isEmpty ? (
                        <span className="text-[10px] italic text-muted-foreground">Coming soon</span>
                      ) : (
                        <>
                          {c.cases > 0 && (
                            <span className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              topic.bg, topic.color
                            )}>
                              <BookOpen className="size-2.5" />
                              {c.cases} case{c.cases !== 1 && 's'}
                            </span>
                          )}
                          {c.pearls > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                              <Sparkles className="size-2.5" />
                              {c.pearls} pearl{c.pearls !== 1 && 's'}
                            </span>
                          )}
                          {c.atlas > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                              <Eye className="size-2.5" />
                              {c.atlas} sign{c.atlas !== 1 && 's'}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Hover CTA row */}
                    {!isEmpty && (
                      <div className={cn(
                        'flex items-center justify-end gap-0.5 pt-0.5 text-[11px] font-semibold',
                        'transition-all duration-200 opacity-0 translate-y-1',
                        'group-hover:opacity-100 group-hover:translate-y-0',
                        topic.color
                      )}>
                        <span>Explore</span>
                        <ArrowRight className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </Link>
          )
        })}
      </div>

      {/* Empty state */}
      {visibleTopics.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl border border-dashed py-14 text-center"
        >
          <p className="text-sm text-muted-foreground">No topics match &ldquo;{query}&rdquo;</p>
        </motion.div>
      )}
    </PageTransition>
  )
}
