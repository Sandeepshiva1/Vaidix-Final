'use client'

import { useState } from 'react'
import {
  ScanEye,
  Target,
  CheckCircle2,
  XCircle,
  Clock,
  Trophy,
  Eye,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import {
  PageTransition,
  StaggerItem,
  motion,
  staggerContainer,
  staggerItem,
} from '@/lib/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Difficulty = 'Easy' | 'Medium' | 'Hard'
type Modality = 'FFA' | 'OCT' | 'IRAF' | 'Ultra-Widefield'

interface Challenge {
  id: string
  title: string
  modality: Modality
  imagePlaceholder: string
  question: string
  options: [string, string, string, string]
  correctAnswer: number
  explanation: string
  difficulty: Difficulty
}

// ---------------------------------------------------------------------------
// Mock challenges (12 total, 3 per tab)
// ---------------------------------------------------------------------------

const challenges: Challenge[] = [
  // FFA
  {
    id: 'ffa-1',
    title: 'Identify the Pattern \u2014 FFA Case 1',
    modality: 'FFA',
    imagePlaceholder: 'FFA mid-phase image showing branching perivascular leakage',
    question: 'What pattern do you see?',
    options: [
      'Fern-like pattern',
      'Flower petal pattern',
      'Smoke-stack pattern',
      'Window defect',
    ],
    correctAnswer: 0,
    explanation:
      'The fern-like pattern of perivascular fluorescein leakage indicates active retinal vasculitis with endothelial tight junction breakdown. This branching leakage pattern tracks along the vascular architecture.',
    difficulty: 'Medium',
  },
  {
    id: 'ffa-2',
    title: 'Identify the Pattern \u2014 FFA Case 2',
    modality: 'FFA',
    imagePlaceholder: 'FFA late-phase showing dark non-perfused areas',
    question: 'What pattern do you see?',
    options: [
      'Disc hyperfluorescence',
      'Capillary non-perfusion areas',
      'Pooling in PED',
      'Blocked fluorescence',
    ],
    correctAnswer: 1,
    explanation:
      'Capillary non-perfusion areas appear as dark, hypofluorescent zones surrounded by dilated capillaries and microaneurysms. This pattern is characteristic of occlusive vasculitis and indicates ischemic damage to the retinal microvasculature.',
    difficulty: 'Hard',
  },
  {
    id: 'ffa-3',
    title: 'Identify the Pattern \u2014 FFA Case 3',
    modality: 'FFA',
    imagePlaceholder: 'FFA late-phase showing disc leak and petaloid macular staining',
    question: 'What pattern do you see?',
    options: [
      'Pinpoint leaks at RPE level',
      'Diffuse capillary leakage',
      'Disc hyperfluorescence with petaloid leakage',
      'Arteriovenous shunting',
    ],
    correctAnswer: 2,
    explanation:
      'Disc hyperfluorescence with petaloid (flower-petal) leakage in the macula is the hallmark FFA finding of cystoid macular edema (CME). Fluorescein accumulates in the Henle fiber layer cystoid spaces creating the characteristic petaloid pattern.',
    difficulty: 'Easy',
  },

  // OCT
  {
    id: 'oct-1',
    title: 'Identify the Pattern \u2014 OCT Case 1',
    modality: 'OCT',
    imagePlaceholder: 'OCT B-scan showing round hyperreflective mass with posterior shadowing',
    question: 'What pattern do you see?',
    options: [
      'Subretinal fluid with RPE detachment',
      'Rain-cloud sign',
      'Epiretinal membrane with traction',
      'Macular hole with cuff of fluid',
    ],
    correctAnswer: 1,
    explanation:
      'The rain-cloud sign shows round hyperreflective aggregates with posterior shadowing on OCT, representing compact Candida fungal balls. This is pathognomonic for endogenous fungal (Candida) endophthalmitis.',
    difficulty: 'Medium',
  },
  {
    id: 'oct-2',
    title: 'Identify the Pattern \u2014 OCT Case 2',
    modality: 'OCT',
    imagePlaceholder: 'OCT showing dome-shaped RPE elevation beneath hyperreflective retinal lesion',
    question: 'What pattern do you see?',
    options: [
      'Drusenoid PED',
      'RPE hump beneath retinitis focus',
      'Pachychoroid with shallow SRF',
      'Vitreomacular traction',
    ],
    correctAnswer: 1,
    explanation:
      'The RPE hump sign shows dome-shaped elevation of the RPE beneath an active retinitis lesion, indicating extension of Toxoplasma infection into the choroid. This distinguishes toxoplasma retinochoroiditis from isolated retinitis (CMV, ARN).',
    difficulty: 'Hard',
  },
  {
    id: 'oct-3',
    title: 'Identify the Pattern \u2014 OCT Case 3',
    modality: 'OCT',
    imagePlaceholder: 'OCT showing full-thickness retinal hyperreflectivity with intraretinal hemorrhage',
    question: 'What pattern do you see?',
    options: [
      'Cystoid macular edema',
      'Central serous chorioretinopathy',
      'Full-thickness retinal necrosis with hemorrhage',
      'Diabetic macular edema',
    ],
    correctAnswer: 2,
    explanation:
      'Full-thickness retinal necrosis with intraretinal hemorrhage on OCT is characteristic of CMV retinitis. The necrosis involves all retinal layers with disruption of normal laminar architecture and associated hemorrhagic components.',
    difficulty: 'Medium',
  },

  // IRAF
  {
    id: 'iraf-1',
    title: 'Identify the Pattern \u2014 IRAF Case 1',
    modality: 'IRAF',
    imagePlaceholder: 'IRAF image showing hyperreflective spots on dark background',
    question: 'What pattern do you see?',
    options: [
      'Diffuse hyper-autofluorescence',
      'Inverse leopard spot pattern',
      'Bull\u2019s eye pattern',
      'Ring of hyper-AF',
    ],
    correctAnswer: 1,
    explanation:
      'The inverse leopard spot pattern on IRAF shows hyperreflective spots (melanin clumping) on a hyporeflective background (RPE atrophy). This is highly suggestive of syphilitic posterior placoid chorioretinitis with characteristic RPE melanin redistribution.',
    difficulty: 'Hard',
  },
  {
    id: 'iraf-2',
    title: 'Identify the Pattern \u2014 IRAF Case 2',
    modality: 'IRAF',
    imagePlaceholder: 'Autofluorescence image showing serpiginous borders with hyper-AF edges',
    question: 'What pattern do you see?',
    options: [
      'Geographic atrophy',
      'Hyper-AF serpiginous borders',
      'Vitelliform deposits',
      'Fleck pattern',
    ],
    correctAnswer: 1,
    explanation:
      'Hyper-autofluorescent serpiginous borders indicate the active advancing edge of serpiginous choroiditis. The hyper-AF rim represents stressed but viable RPE at the lesion margin, while the central hypo-AF zone shows completed RPE and choriocapillaris atrophy.',
    difficulty: 'Medium',
  },
  {
    id: 'iraf-3',
    title: 'Identify the Pattern \u2014 IRAF Case 3',
    modality: 'IRAF',
    imagePlaceholder: 'Autofluorescence showing scattered dark lesions across posterior pole',
    question: 'What pattern do you see?',
    options: [
      'Multifocal hypo-AF lesions',
      'Peripapillary atrophy',
      'Central areolar atrophy',
      'Drusen autofluorescence',
    ],
    correctAnswer: 0,
    explanation:
      'Multifocal hypo-autofluorescent lesions scattered across the posterior pole and mid-periphery are characteristic of birdshot chorioretinopathy. These represent areas of choroidal and RPE depigmentation from the chronic autoimmune (HLA-A29-associated) choroidal inflammation.',
    difficulty: 'Easy',
  },

  // Ultra-Widefield
  {
    id: 'uwf-1',
    title: 'Identify the Pattern \u2014 Ultra-Widefield Case 1',
    modality: 'Ultra-Widefield',
    imagePlaceholder: 'UWF image showing peripheral confluent retinal whitening with arteritis',
    question: 'What pattern do you see?',
    options: [
      'Lattice degeneration with holes',
      'Peripheral retinal necrosis with arteritis',
      'Retinoschisis',
      'Paving stone degeneration',
    ],
    correctAnswer: 1,
    explanation:
      'Peripheral retinal necrosis with arteritis is the hallmark of acute retinal necrosis (ARN). The confluent white necrotic retina begins peripherally and progresses posteriorly, with prominent retinal arteritis and vitritis. Caused by HSV or VZV.',
    difficulty: 'Medium',
  },
  {
    id: 'uwf-2',
    title: 'Identify the Pattern \u2014 Ultra-Widefield Case 2',
    modality: 'Ultra-Widefield',
    imagePlaceholder: 'UWF image showing inferior exudative band with peripheral vessel sheathing',
    question: 'What pattern do you see?',
    options: [
      'Peripheral laser scars',
      'Retinal detachment',
      'Snowbanking with peripheral vasculitis',
      'Scleral buckle indentation',
    ],
    correctAnswer: 2,
    explanation:
      'Snowbanking (white exudative accumulation over the pars plana) with peripheral vasculitis is characteristic of pars planitis, the most common form of intermediate uveitis. Ultra-widefield imaging captures the full extent of peripheral pathology.',
    difficulty: 'Easy',
  },
  {
    id: 'uwf-3',
    title: 'Identify the Pattern \u2014 Ultra-Widefield Case 3',
    modality: 'Ultra-Widefield',
    imagePlaceholder: 'UWF image showing diffuse retinal hemorrhages and cotton-wool spots',
    question: 'What pattern do you see?',
    options: [
      'Diabetic retinopathy',
      'Retinal vein occlusion',
      'Diffuse retinal hemorrhages with cotton-wool spots',
      'Hypertensive retinopathy',
    ],
    correctAnswer: 2,
    explanation:
      'Diffuse retinal hemorrhages with cotton-wool spots in an immunocompromised patient is characteristic of CMV retinitis. The widespread hemorrhagic retinitis pattern, especially when extending to the periphery, is best appreciated on ultra-widefield imaging.',
    difficulty: 'Hard',
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const modalities: Modality[] = ['FFA', 'OCT', 'IRAF', 'Ultra-Widefield']

const difficultyColor: Record<Difficulty, string> = {
  Easy: 'bg-green-500/10 text-green-700 dark:text-green-400',
  Medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  Hard: 'bg-red-500/10 text-red-700 dark:text-red-400',
}

const modalityGradient: Record<Modality, string> = {
  FFA: 'from-emerald-950/80 to-zinc-900',
  OCT: 'from-sky-950/80 to-zinc-900',
  IRAF: 'from-violet-950/80 to-zinc-900',
  'Ultra-Widefield': 'from-amber-950/80 to-zinc-900',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ImagingInterpretationPage() {
  const [answers, setAnswers] = useState<Record<string, number>>({})

  const handleAnswer = (challengeId: string, optionIndex: number) => {
    setAnswers((prev) => {
      if (prev[challengeId] !== undefined) return prev
      return { ...prev, [challengeId]: optionIndex }
    })
  }

  const answeredCount = Object.keys(answers).length
  const correctCount = Object.values(answers).filter((selected, i) => {
    const challengeId = Object.keys(answers)[i]
    const challenge = challenges.find((c) => c.id === challengeId)
    return challenge && selected === challenge.correctAnswer
  }).length
  const accuracy =
    answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0

  // Compute best streak
  const answeredChallenges = challenges.filter((c) => answers[c.id] !== undefined)
  let bestStreak = 0
  let currentStreak = 0
  for (const c of answeredChallenges) {
    if (answers[c.id] === c.correctAnswer) {
      currentStreak++
      bestStreak = Math.max(bestStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  }

  // Use mock stats blended with live data
  const statsCompleted = `${Math.min(5 + answeredCount, 12)}/12`
  const statsAccuracy = answeredCount > 0 ? `${accuracy}%` : '78%'
  const statsBestStreak = Math.max(4, bestStreak)

  return (
    <PageTransition className="space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div className="flex items-center gap-2">
          <ScanEye className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Imaging Interpretation
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Train your eye for FFA, OCT, and IRAF patterns
        </p>
      </StaggerItem>

      {/* Stats row */}
      <StaggerItem>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-lg bg-blue-500/10 p-2.5">
                <Target className="size-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Challenges Completed
                </p>
                <p className="text-xl font-bold">{statsCompleted}</p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-lg bg-green-500/10 p-2.5">
                <CheckCircle2 className="size-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Accuracy Rate</p>
                <p className="text-xl font-bold">{statsAccuracy}</p>
              </div>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-lg bg-amber-500/10 p-2.5">
                <Trophy className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Best Streak</p>
                <p className="text-xl font-bold">{statsBestStreak}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </StaggerItem>

      {/* Modality tabs */}
      <StaggerItem>
        <Tabs defaultValue="FFA">
          <TabsList>
            {modalities.map((m) => (
              <TabsTrigger key={m} value={m}>
                {m}
              </TabsTrigger>
            ))}
          </TabsList>

          {modalities.map((modality) => {
            const tabChallenges = challenges.filter(
              (c) => c.modality === modality,
            )

            return (
              <TabsContent key={modality} value={modality}>
                <motion.div
                  className="grid grid-cols-1 gap-5 md:grid-cols-2"
                  initial="hidden"
                  animate="visible"
                  variants={staggerContainer}
                >
                  {tabChallenges.map((challenge) => {
                    const selectedAnswer = answers[challenge.id]
                    const hasAnswered = selectedAnswer !== undefined
                    const isCorrect =
                      hasAnswered && selectedAnswer === challenge.correctAnswer

                    return (
                      <motion.div
                        key={challenge.id}
                        variants={staggerItem}
                        whileHover={{ y: -3, transition: { duration: 0.2 } }}
                      >
                        <Card className="flex flex-col">
                      <CardContent className="flex flex-1 flex-col space-y-4 pt-5">
                        {/* Image placeholder */}
                        <div
                          className={`flex h-[250px] items-center justify-center rounded-lg bg-gradient-to-br ${modalityGradient[modality]}`}
                        >
                          <div className="flex flex-col items-center gap-2 text-zinc-400">
                            <Eye className="size-12 opacity-60" />
                            <span className="max-w-[200px] text-center text-xs">
                              {challenge.imagePlaceholder}
                            </span>
                          </div>
                        </div>

                        {/* Title & meta */}
                        <div className="space-y-2">
                          <h3 className="text-base font-semibold leading-snug">
                            {challenge.title}
                          </h3>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-xs ${difficultyColor[challenge.difficulty]}`}
                            >
                              {challenge.difficulty}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="text-xs text-muted-foreground"
                            >
                              <Clock className="mr-1 size-3" />
                              60 seconds
                            </Badge>
                          </div>
                        </div>

                        {/* Question */}
                        <p className="text-sm font-medium">
                          {challenge.question}
                        </p>

                        {/* Options */}
                        <div className="grid gap-2">
                          {challenge.options.map((option, idx) => {
                            let variant:
                              | 'outline'
                              | 'default'
                              | 'destructive' = 'outline'
                            let extraClass = ''

                            if (hasAnswered) {
                              if (idx === challenge.correctAnswer) {
                                variant = 'default'
                                extraClass =
                                  'bg-green-600 hover:bg-green-600 text-white border-green-600'
                              } else if (
                                idx === selectedAnswer &&
                                idx !== challenge.correctAnswer
                              ) {
                                variant = 'destructive'
                                extraClass =
                                  'bg-red-600 hover:bg-red-600 text-white border-red-600'
                              }
                            }

                            return (
                              <Button
                                key={idx}
                                variant={variant}
                                size="sm"
                                className={`justify-start text-left h-auto py-2.5 px-3 whitespace-normal ${extraClass}`}
                                onClick={() =>
                                  handleAnswer(challenge.id, idx)
                                }
                                disabled={hasAnswered}
                              >
                                <span className="mr-2 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                                  {String.fromCharCode(65 + idx)}
                                </span>
                                {option}
                              </Button>
                            )
                          })}
                        </div>

                        {/* Result */}
                        {hasAnswered && (
                          <div
                            className={`rounded-lg p-3 text-sm ${
                              isCorrect
                                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                                : 'bg-red-500/10 text-red-700 dark:text-red-400'
                            }`}
                          >
                            <div className="mb-1 flex items-center gap-1.5 font-semibold">
                              {isCorrect ? (
                                <>
                                  <CheckCircle2 className="size-4" />
                                  Correct!
                                </>
                              ) : (
                                <>
                                  <XCircle className="size-4" />
                                  Incorrect
                                </>
                              )}
                            </div>
                            <p className="leading-relaxed">
                              {challenge.explanation}
                            </p>
                          </div>
                        )}
                        </CardContent>
                      </Card>
                    </motion.div>
                    )
                  })}
                </motion.div>
              </TabsContent>
            )
          })}
        </Tabs>
      </StaggerItem>
    </PageTransition>
  )
}
