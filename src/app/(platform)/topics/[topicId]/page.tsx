'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, notFound } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Lightbulb,
  Scan,
  ScanEye,
  Microscope,
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
  Play,
  GraduationCap,
  Zap,
  Target,
  Quote,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { TOPIC_BY_ID } from '@/lib/constants'
import { PageTransition, StaggerItem, motion, AnimatedBar } from '@/lib/motion'
import { cn } from '@/lib/utils'
import casesData from '@/mock-data/cases.json'
import pearlsData from '@/mock-data/pearls.json'
import atlasData from '@/mock-data/signs-atlas.json'
import type { ClinicalCase, Pearl, AtlasSign } from '@/lib/types'

const ICON_MAP: Record<string, LucideIcon> = {
  Eye, Flame, Droplet, Aperture, Circle, Baby, Brain, Scissors,
  Ribbon, Sparkles, CircleDot, Stethoscope, EyeOff, Dna, AlertTriangle,
}

type Mode = 'learn' | 'refresh' | 'review'

export default function TopicDetailPage() {
  const params = useParams<{ topicId: string }>()
  const topicId = params.topicId
  const topic = TOPIC_BY_ID[topicId]
  const [mode, setMode] = useState<Mode | null>(null)
  const [refreshTab, setRefreshTab] = useState<string | number>('pearls')

  if (!topic) {
    notFound()
  }

  const Icon = ICON_MAP[topic.icon] ?? Eye

  // Filter resources for this topic
  const topicCases = useMemo(
    () => (casesData as unknown as ClinicalCase[]).filter((c) => c.topic === topicId),
    [topicId]
  )
  const topicPearls = useMemo(
    () => (pearlsData as unknown as Pearl[]).filter((p) => p.topic === topicId),
    [topicId]
  )
  const topicAtlas = useMemo(
    () => (atlasData as unknown as AtlasSign[]).filter((s) => s.topic === topicId),
    [topicId]
  )

  const simulators: Record<string, { id: string; name: string; description: string }[]> = {
    retina: [
      { id: 'fundoscopy', name: 'Indirect Ophthalmoscopy', description: 'Practice indirect fundoscopy on virtual fundus images with adjustable lens power and illumination.' },
      { id: 'laser-pascal', name: 'PASCAL Laser Simulator', description: 'Pattern scan laser photocoagulation — titrate power, duration, and spacing for PRP and focal treatment.' },
      { id: 'oct-scan', name: 'OCT Acquisition Trainer', description: 'Learn to position scans over the fovea, recognise artefacts, and interpret en-face B-scans.' },
      { id: 'vitrectomy', name: 'Virtual Vitrectomy', description: 'Core vitrectomy, membrane peel, and ILM peel drills on a 25-gauge platform.' },
    ],
    glaucoma: [
      { id: 'tonometry', name: 'Goldmann Tonometry', description: 'Applanation technique with force feedback on virtual eyes of varying corneal biomechanics.' },
      { id: 'gonioscopy', name: 'Gonioscopy Trainer', description: 'Identify angle structures and grade narrow angles on interactive Shaffer views.' },
    ],
    cornea: [
      { id: 'slit-lamp', name: 'Slit Lamp Examination', description: 'Master slit beam manipulation — diffuse, parallelepiped, optic section, retro-illumination.' },
      { id: 'corneal-cross', name: 'Corneal Cross-Linking', description: 'Riboflavin protocol timing and UV dosimetry for progressive keratoconus.' },
    ],
    uvea: [
      { id: 'flare-meter', name: 'Anterior Chamber Grading', description: 'SUN-criteria cell and flare grading across a sequence of slit-lamp clips.' },
    ],
    oncology: [
      { id: 'tumor-biometry', name: 'Tumour Biometry', description: 'A-scan and B-scan ultrasonography for choroidal melanoma height and reflectivity.' },
    ],
  }
  const topicSimulators = simulators[topicId] ?? []

  // Inline imaging drills per topic — small curated set rendered directly
  // in the Refresh > Imaging tab so the user sees content without navigating.
  const imagingDrills: Record<
    string,
    { id: string; modality: string; title: string; description: string }[]
  > = {
    retina: [
      { id: 'oct-1', modality: 'OCT', title: 'Intraretinal vs. Subretinal Fluid', description: 'Distinguish DME cysts from neurosensory detachment on SD-OCT.' },
      { id: 'ffa-1', modality: 'FFA', title: 'Leakage Patterns in CSCR vs. CNV', description: 'Smokestack and inkblot leak vs. lacy hyperfluorescence.' },
      { id: 'icga-1', modality: 'ICGA', title: 'Polypoidal Choroidal Vasculopathy', description: 'Polyps and branching vascular network on late ICGA frames.' },
      { id: 'bscan-1', modality: 'B-scan', title: 'Funnel RD vs. PVD', description: 'After-movement, insertion at disc, and membrane thickness.' },
    ],
    glaucoma: [
      { id: 'oct-rnfl', modality: 'OCT', title: 'RNFL Thickness Map', description: 'Red/yellow/green sector analysis and hemifield comparison.' },
      { id: 'vf-1', modality: 'Visual Field', title: 'Early Glaucomatous Defects', description: 'Nasal steps, paracentral scotomas, and arcuate patterns.' },
    ],
    cornea: [
      { id: 'topo-1', modality: 'Topography', title: 'Keratoconus Screening', description: 'Inferior steepening, skewed axes, and ectasia risk.' },
      { id: 'asoct-1', modality: 'AS-OCT', title: 'Epithelial Thickness Mapping', description: 'Thinning over the cone, thickening in contralateral quadrant.' },
    ],
    uvea: [
      { id: 'faf-1', modality: 'FAF', title: 'Birdshot Lesion Mapping', description: 'Hypoautofluorescent spots beyond the visible cream lesions.' },
    ],
    oncology: [
      { id: 'us-1', modality: 'US-B', title: 'Choroidal Melanoma', description: 'Collar-button sign and low internal reflectivity on A-scan.' },
    ],
  }
  const topicImaging = imagingDrills[topicId] ?? []

  // Mock: user's mastery in this topic
  const mastery = 67

  return (
    <PageTransition className="space-y-6">
      {/* Back link */}
      <StaggerItem>
        <Link
          href="/topics"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All Topics
        </Link>
      </StaggerItem>

      {/* Topic hero */}
      <StaggerItem>
        <div className={cn('relative overflow-hidden rounded-2xl border-2 p-6', topic.border)}>
          <div className={cn('pointer-events-none absolute -right-10 -top-10 size-40 rounded-full opacity-20 blur-3xl', topic.bg)} />
          <div className="relative flex items-start gap-4">
            <div className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl', topic.bg)}>
              <Icon className={cn('size-7', topic.color)} />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {topic.label}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{topic.description}</p>
              <div className="mt-4 max-w-md">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your mastery</span>
                  <span className="text-xs font-bold tabular-nums text-foreground">{mastery}%</span>
                </div>
                <AnimatedBar value={mastery} barClassName={topic.bg.replace('/10', '')} className="h-2" />
              </div>
            </div>
          </div>
        </div>
      </StaggerItem>

      {/* THE 3-MODE HERO — replaces the old tabs */}
      <StaggerItem>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* LEARN — navigates to the dedicated Learn page */}
          <Link href={`/topics/${topicId}/learn`} className="block">
            <ModeCard
              mode="learn"
              active={mode === 'learn'}
              onClick={() => {}}
              icon={GraduationCap}
              iconBg="bg-teal-500/10"
              iconColor="text-teal-600"
              border="border-teal-500/30"
              title="Learn"
              tagline="Read · Play · Quiz · Pearls · Cases"
              duration="~10 min per sub-topic"
              count={`${topicCases.length} case${topicCases.length !== 1 ? 's' : ''}`}
              description="International content with plain-English explanations, interactive games, quizzes, pearls and clinical cases."
            />
          </Link>
          {/* REFRESH */}
          <ModeCard
            mode="refresh"
            active={mode === 'refresh'}
            onClick={() => setMode(mode === 'refresh' ? null : 'refresh')}
            icon={Zap}
            iconBg="bg-amber-500/10"
            iconColor="text-amber-600"
            border="border-amber-500/30"
            title="Refresh"
            tagline="Quick recall, between rounds"
            duration="2-5 min per drill"
            count={`${topicPearls.length + topicAtlas.length + topicImaging.length + topicSimulators.length} drills`}
            description="Pearls, signs, imaging and simulators. Maintain recall in short bursts on your phone."
          />
          {/* REVIEW */}
          <ModeCard
            mode="review"
            active={mode === 'review'}
            onClick={() => setMode(mode === 'review' ? null : 'review')}
            icon={Target}
            iconBg="bg-rose-500/10"
            iconColor="text-rose-600"
            border="border-rose-500/30"
            title="Review"
            tagline="Find your grey areas"
            duration="~12 min adaptive test"
            count="6-axis scoring"
            description="Multi-dimensional adaptive test. Tests knowledge, reasoning, communication, empathy and judgment."
          />
        </div>
      </StaggerItem>

      {/* Mode-specific content rendered below (Learn navigates to a new page) */}
      {mode === 'refresh' && (
        <RefreshPanel
          topicPearls={topicPearls}
          topicAtlas={topicAtlas}
          topicSimulators={topicSimulators}
          topicImaging={topicImaging}
          topicColor={topic.color}
          topicBg={topic.bg}
          activeTab={refreshTab}
          onTabChange={setRefreshTab}
        />
      )}
      {mode === 'review' && (
        <ReviewPanel topic={topic} topicId={topicId} />
      )}

      {/* Hint when no mode selected */}
      {mode === null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-dashed border-border/60 py-8 text-center"
        >
          <p className="text-sm text-muted-foreground">
            Pick a mode above to start. Not sure? <span className="font-medium text-foreground">Learn</span> if it&apos;s new, <span className="font-medium text-foreground">Refresh</span> if you have 5 minutes, <span className="font-medium text-foreground">Review</span> if you want a checkup.
          </p>
        </motion.div>
      )}
    </PageTransition>
  )
}

// ---------------------------------------------------------------------------
// Mode Card
// ---------------------------------------------------------------------------

function ModeCard({
  active,
  onClick,
  icon: Icon,
  iconBg,
  iconColor,
  border,
  title,
  tagline,
  duration,
  count,
  description,
}: {
  mode: Mode
  active: boolean
  onClick: () => void
  icon: LucideIcon
  iconBg: string
  iconColor: string
  border: string
  title: string
  tagline: string
  duration: string
  count: string
  description: string
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border-2 bg-card p-5 text-left transition-all',
        active ? `${border} shadow-lg ring-2 ring-offset-2 ring-offset-background` : 'border-border/50 hover:border-border'
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn('flex size-12 items-center justify-center rounded-xl', iconBg)}>
          <Icon className={cn('size-6', iconColor)} />
        </div>
        <ArrowRight className={cn('size-4 transition-all', active ? 'translate-x-0 opacity-100' : 'opacity-0 group-hover:opacity-60')} />
      </div>
      <div className="mt-4">
        <h3 className="text-lg font-bold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{tagline}</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        <Badge variant="secondary" className="text-[10px]">{duration}</Badge>
        <Badge variant="secondary" className="text-[10px]">{count}</Badge>
      </div>
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// REFRESH PANEL — Pearls / Signs / Imaging / Simulators tabs
// ---------------------------------------------------------------------------

function RefreshPanel({
  topicPearls,
  topicAtlas,
  topicSimulators,
  topicImaging,
  topicColor,
  topicBg,
  activeTab,
  onTabChange,
}: {
  topicPearls: Pearl[]
  topicAtlas: AtlasSign[]
  topicSimulators: { id: string; name: string; description: string }[]
  topicImaging: { id: string; modality: string; title: string; description: string }[]
  topicColor: string
  topicBg: string
  activeTab: string | number
  onTabChange: (v: string | number) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2">
        <Zap className="size-4 text-amber-600" />
        <h2 className="text-base font-bold text-foreground">Refresh — Quick Drills</h2>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => onTabChange(v ?? 'pearls')}>
        <TabsList>
          <TabsTrigger value="pearls">
            <Lightbulb className="size-3.5" />
            Pearls
            {topicPearls.length > 0 && <span className="ml-1 text-[10px] tabular-nums opacity-60">({topicPearls.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="atlas">
            <Scan className="size-3.5" />
            Signs
            {topicAtlas.length > 0 && <span className="ml-1 text-[10px] tabular-nums opacity-60">({topicAtlas.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="imaging">
            <ScanEye className="size-3.5" />
            Imaging
            {topicImaging.length > 0 && <span className="ml-1 text-[10px] tabular-nums opacity-60">({topicImaging.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="simulators">
            <Microscope className="size-3.5" />
            Simulators
            {topicSimulators.length > 0 && <span className="ml-1 text-[10px] tabular-nums opacity-60">({topicSimulators.length})</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pearls">
          {topicPearls.length > 0 ? (
            <div className="space-y-3">
              {topicPearls.slice(0, 8).map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Card>
                    <CardContent className="space-y-2 pt-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold italic leading-relaxed text-foreground">
                          &ldquo;{p.question}&rdquo;
                        </p>
                        <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                          {p.difficulty}
                        </Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{p.answer}</p>
                      <div className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground">
                        <Quote className="size-3" />
                        <span>{p.citation.authors} · {p.citation.journal} ({p.citation.year})</span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
              {topicPearls.length > 8 && (
                <Link href="/pearls" className="block">
                  <Button variant="outline" className="w-full">
                    View all {topicPearls.length} pearls <ArrowRight className="ml-2 size-4" />
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <EmptyState icon={Lightbulb} text="No pearls yet for this topic" />
          )}
        </TabsContent>

        <TabsContent value="atlas">
          {topicAtlas.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {topicAtlas.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Card>
                    <CardContent className="space-y-2 pt-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold text-foreground">{s.name}</h3>
                        <Badge variant="secondary" className="text-[10px]">{s.imagingModality}</Badge>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{s.description}</p>
                      {s.conditions?.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {s.conditions.slice(0, 3).map((cond: string) => (
                            <span key={cond} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                              {cond}
                            </span>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Scan} text="No atlas signs yet for this topic" />
          )}
        </TabsContent>

        <TabsContent value="imaging">
          {topicImaging.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {topicImaging.map((img, i) => (
                  <motion.div
                    key={img.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <Card className="h-full">
                      <CardContent className="space-y-2 pt-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', topicBg)}>
                            <ScanEye className={cn('size-5', topicColor)} />
                          </div>
                          <Badge variant="secondary" className="text-[10px]">{img.modality}</Badge>
                        </div>
                        <h3 className="text-sm font-semibold text-foreground">{img.title}</h3>
                        <p className="text-xs leading-relaxed text-muted-foreground">{img.description}</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
              <Link href="/imaging" className="block">
                <Button variant="outline" className="w-full">
                  Open full Imaging Library <ArrowRight className="ml-2 size-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <EmptyState icon={ScanEye} text="No imaging drills yet for this topic" />
          )}
        </TabsContent>

        <TabsContent value="simulators">
          {topicSimulators.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {topicSimulators.map((sim, i) => (
                <motion.div
                  key={sim.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link href="/simulators">
                    <Card className="cursor-pointer transition-shadow hover:shadow-md">
                      <CardContent className="flex items-start gap-3 pt-1">
                        <div className={cn('flex size-11 items-center justify-center rounded-xl', topicBg)}>
                          <Microscope className={cn('size-5', topicColor)} />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-foreground">{sim.name}</h3>
                          <p className="text-xs text-muted-foreground">{sim.description}</p>
                          <Button variant="outline" size="sm" className="mt-2 gap-1">
                            <Play className="size-3" /> Launch
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Microscope} text="No simulators yet for this topic" />
          )}
        </TabsContent>
      </Tabs>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// REVIEW PANEL — entry to multi-dim adaptive test
// ---------------------------------------------------------------------------

function ReviewPanel({ topicId }: { topic: typeof TOPIC_BY_ID[string]; topicId: string }) {
  const axes = [
    { name: 'Knowledge', desc: 'Factually correct?', icon: Brain, color: 'text-blue-500' },
    { name: 'Reasoning', desc: 'Mechanism explained?', icon: Sparkles, color: 'text-purple-500' },
    { name: 'Communication', desc: 'Right level for audience?', icon: GraduationCap, color: 'text-amber-500' },
    { name: 'Empathy', desc: 'Patient-centered language?', icon: Eye, color: 'text-rose-500' },
    { name: 'Relevance', desc: 'Signal vs noise?', icon: Target, color: 'text-emerald-500' },
    { name: 'Safety', desc: 'Red flags caught?', icon: AlertTriangle, color: 'text-red-500' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2">
        <Target className="size-4 text-rose-600" />
        <h2 className="text-base font-bold text-foreground">Review — Multi-Dimensional Test</h2>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="space-y-5 pt-1">
          <div>
            <p className="text-sm text-muted-foreground">
              Unlike a typical quiz, this test scores you across <span className="font-semibold text-foreground">six independent dimensions</span> and adapts difficulty after each answer. Each question may ask you to explain to a different audience — a patient, a peer, or a senior — testing not just what you know but how you communicate it.
            </p>
          </div>

          {/* 6 axes */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scored across 6 axes</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {axes.map((a, i) => (
                <motion.div
                  key={a.name}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 + i * 0.05 }}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-2"
                >
                  <a.icon className={cn('size-4 shrink-0', a.color)} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-foreground">{a.name}</p>
                    <p className="text-[10px] text-muted-foreground">{a.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Question variants explainer */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-950/20">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Same answer, different demands</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-md bg-card p-2 text-[10px] leading-relaxed">
                <span className="font-bold text-rose-600">A. To a patient&apos;s family</span>
                <p className="mt-0.5 text-muted-foreground">Tests empathy + plain language. Drop jargon.</p>
              </div>
              <div className="rounded-md bg-card p-2 text-[10px] leading-relaxed">
                <span className="font-bold text-blue-600">B. To a peer student</span>
                <p className="mt-0.5 text-muted-foreground">Tests knowledge + reasoning. Show mechanism.</p>
              </div>
              <div className="rounded-md bg-card p-2 text-[10px] leading-relaxed">
                <span className="font-bold text-emerald-600">C. To a senior in 30s</span>
                <p className="mt-0.5 text-muted-foreground">Tests relevance + safety. Compress, surface red flags.</p>
              </div>
            </div>
          </div>

          {/* Test details */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold tabular-nums text-foreground">12</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">questions</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-foreground">~12</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">minutes</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-foreground">Adaptive</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">difficulty</p>
            </div>
          </div>

          {/* Start button */}
          <Link href={`/topics/${topicId}/review`}>
            <Button className="h-12 w-full gap-2 rounded-xl bg-rose-600 text-base font-semibold text-white hover:bg-rose-700">
              <Play className="size-5" />
              Start Multi-Dimensional Review
            </Button>
          </Link>

          <p className="text-center text-[10px] italic text-muted-foreground">
            Your results loop back into Learn at the exact gaps detected.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="rounded-xl border border-dashed py-12 text-center">
      <Icon className="mx-auto size-10 text-muted-foreground/40" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
