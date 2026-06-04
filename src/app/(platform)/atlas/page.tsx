'use client'

import { useState } from 'react'
import {
  Scan,
  Search,
  Eye,
  ChevronDown,
  ChevronUp,
  Microscope,
  Info,
  FlaskConical,
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'
import signsData from '@/mock-data/signs-atlas.json'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Sign {
  id: string
  name: string
  description: string
  mechanism: string
  conditions: string[]
  imagingModality: string
  clinicalSignificance: string
  category: string
  tags: string[]
}

const signs: Sign[] = signsData as Sign[]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const categories = ['All', 'Infection', 'Inflammation', 'Autoimmune', 'Retinal'] as const

const categoryColor: Record<string, string> = {
  infection: 'bg-red-500/10 text-red-700 dark:text-red-400',
  inflammation: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  autoimmune: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  retinal: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SignsAtlasPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const filteredSigns = signs.filter((sign) => {
    const matchesCategory =
      activeCategory === 'All' ||
      sign.category.toLowerCase() === activeCategory.toLowerCase()

    if (!matchesCategory) return false

    if (!searchQuery.trim()) return true

    const query = searchQuery.toLowerCase()
    return (
      sign.name.toLowerCase().includes(query) ||
      sign.description.toLowerCase().includes(query) ||
      sign.conditions.some((c) => c.toLowerCase().includes(query))
    )
  })

  const conditionCount = new Set(signs.flatMap((s) => s.conditions)).size

  return (
    <PageTransition className="space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div className="flex items-center gap-2">
          <Scan className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Signs &amp; Patterns Atlas
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Master the visual language of ophthalmology. DB-backed catalog is coming soon.
        </p>
        <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{signs.length} Signs</span>
          <span>|</span>
          <span className="font-medium text-foreground">
            Across {conditionCount} conditions
          </span>
        </div>
      </StaggerItem>

      {/* preview banner — atlas reads mock JSON until /api/atlas + AtlasImage upload land */}
      <StaggerItem>
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 pt-6">
            <FlaskConical className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-medium">Not yet available.</p>
              <p className="mt-1 text-muted-foreground">
                The atlas currently reads from{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">mock-data/signs-atlas.json</code>.
                The <span className="font-medium">AtlasImage</span> +{' '}
                <span className="font-medium">AtlasTag</span> tables exist in the schema
                but no upload route or DB query route has shipped yet — admin upload, faculty
                review, and the <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/atlas</code>{' '}
                read endpoint are not yet wired. Engagement (bookmarks via{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">targetType=ATLAS_IMAGE</code>)
                already reuses the existing engagement service — no new infra needed when the catalog goes live.
              </p>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Search & filter */}
      <StaggerItem className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search signs by name, condition, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? 'default' : 'outline'}
              size="sm"
              className="rounded-full"
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      </StaggerItem>

      {/* Signs grid */}
      <StaggerItem>
      {filteredSigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Search className="size-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            No signs match your search criteria.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {filteredSigns.map((sign, index) => {
            const isExpanded = expandedIds.has(sign.id)

            return (
              <motion.div
                key={sign.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
              >
              <Card className="flex flex-col">
                <CardHeader className="pb-3">
                  <h2 className="text-xl font-bold tracking-tight">
                    {sign.name}
                  </h2>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col space-y-4">
                  {/* Image placeholder */}
                  <div className="flex h-[200px] items-center justify-center rounded-lg bg-zinc-800 dark:bg-zinc-900">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Eye className="size-10" />
                      <span className="text-sm font-medium">Clinical Image</span>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {sign.description}
                  </p>

                  {/* Seen In + Imaging row */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Seen In:
                      </span>
                      {sign.conditions.map((condition) => (
                        <Badge
                          key={condition}
                          variant="secondary"
                          className="text-xs"
                        >
                          {condition}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Imaging:
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs"
                      >
                        <Microscope className="mr-1 size-3" />
                        {sign.imagingModality}
                      </Badge>
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1">
                    {sign.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          categoryColor[sign.category] ??
                          'bg-muted text-muted-foreground'
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Expand / Collapse */}
                  {isExpanded && (
                    <>
                      <Separator />

                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <Info className="size-3.5 text-primary" />
                            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                              Mechanism
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {sign.mechanism}
                          </p>
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <Microscope className="size-3.5 text-primary" />
                            <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                              Clinical Significance
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {sign.clinicalSignificance}
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full mt-auto"
                    onClick={() => toggleExpand(sign.id)}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="mr-1.5 size-4" />
                        Show Less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="mr-1.5 size-4" />
                        Show Mechanism &amp; Significance
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
              </motion.div>
            )
          })}
        </div>
      )}
      </StaggerItem>
    </PageTransition>
  )
}
