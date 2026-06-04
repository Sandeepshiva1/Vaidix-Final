'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageTransition, StaggerItem, motion } from '@/lib/motion'
import {
  NotebookPen,
  Plus,
  Smile,
  Meh,
  Brain,
  Frown,
  BookOpen,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mood = 'positive' | 'neutral' | 'contemplative' | 'challenged'

interface JournalEntry {
  id: string
  title: string
  date: string
  mood: Mood
  sentimentScore: number // -1 to 1
  content: string
  caseId?: string
  caseTitle?: string
  tags: string[]
}

// ---------------------------------------------------------------------------
// Mood config
// ---------------------------------------------------------------------------

const MOOD_CONFIG: Record<Mood, { icon: typeof Smile; label: string; color: string }> = {
  positive: { icon: Smile, label: 'Positive', color: 'text-emerald-500' },
  neutral: { icon: Meh, label: 'Neutral', color: 'text-amber-500' },
  contemplative: { icon: Brain, label: 'Contemplative', color: 'text-blue-500' },
  challenged: { icon: Frown, label: 'Challenged', color: 'text-rose-500' },
}

function sentimentColor(score: number): string {
  if (score >= 0.3) return 'bg-emerald-500'
  if (score >= -0.3) return 'bg-amber-400'
  return 'bg-rose-500'
}

function sentimentWidth(score: number): number {
  // Map -1..1 to 10..100
  return Math.round(((score + 1) / 2) * 90 + 10)
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const journalEntries: JournalEntry[] = [
  {
    id: 'journal-001',
    title: 'Finding Balance in Difficult News',
    date: '2026-03-30',
    mood: 'contemplative',
    sentimentScore: -0.1,
    content:
      'Today I had to explain to Mrs. Reddy that her macular degeneration had progressed despite treatment. I struggled with how much hope to give versus being realistic. I noticed my voice was steady, but internally I felt the weight of her disappointment. There is a fine line between compassion and clinical detachment that I am still learning to walk. I kept reminding myself that honesty, delivered gently, is itself an act of care.',
    caseId: 'case-001',
    caseTitle: 'Wet AMD with Subfoveal CNV',
    tags: ['empathy', 'breaking-bad-news', 'patient-communication'],
  },
  {
    id: 'journal-002',
    title: "The Weight of a Child's Fear",
    date: '2026-03-27',
    mood: 'challenged',
    sentimentScore: -0.4,
    content:
      "Working with the 6-year-old strabismus patient today was harder than I expected. She cried when I tried to examine her, and I felt completely unprepared. I tried distraction techniques but nothing worked initially. It took me ten minutes of sitting at her level and talking about her favourite cartoon before she let me even hold the penlight. I realise I need to build a much stronger paediatric communication toolkit. The technical knowledge is necessary but insufficient when your patient is terrified.",
    caseId: 'case-008',
    caseTitle: 'Childhood Strabismus',
    tags: ['paediatrics', 'communication', 'clinical-challenge'],
  },
  {
    id: 'journal-003',
    title: 'Growth Through Uncertainty',
    date: '2026-03-24',
    mood: 'positive',
    sentimentScore: 0.6,
    content:
      "I surprised myself today during the case discussion. When Dr. Sharma asked for differential diagnoses, I was able to articulate three possibilities with reasoning rather than just guessing. I've been reviewing retinal conditions each morning for the past two weeks and the spaced repetition seems to be paying off. I still feel uncertain often, but today I recognised that uncertainty paired with structured reasoning is far better than false confidence. I'm growing, even when it doesn't always feel like it.",
    tags: ['self-improvement', 'confidence', 'differential-diagnosis'],
  },
  {
    id: 'journal-004',
    title: 'Connecting Diagnosis to the Person',
    date: '2026-03-20',
    mood: 'contemplative',
    sentimentScore: 0.2,
    content:
      "Mr. Krishnamurthy came in today with advanced open-angle glaucoma. His visual fields were severely constricted, yet he was remarkably calm. He told me he'd been a philosophy teacher and quoted Marcus Aurelius: 'The impediment to action advances action. What stands in the way becomes the way.' I found myself thinking about his words long after the consultation. Sometimes patients teach us more about resilience than any textbook ever could. I want to remember to see the person, not just the pressure readings.",
    caseId: 'case-005',
    caseTitle: 'Primary Open Angle Glaucoma',
    tags: ['patient-perspective', 'holistic-care', 'glaucoma'],
  },
  {
    id: 'journal-005',
    title: "What I Learned from Mrs. Menon's Trust",
    date: '2026-03-16',
    mood: 'positive',
    sentimentScore: 0.7,
    content:
      "Mrs. Menon returned for her post-operative follow-up after the intravitreal injection for endophthalmitis. Her vision had improved from counting fingers to 6/18. When she thanked me, I realised she wasn't thanking me for the medical outcome alone; she was thanking me for sitting with her the night before the procedure and explaining every step. She said, 'You made me feel like I mattered, not just my eye.' That single sentence reminded me why I chose ophthalmology. Trust is built in the small moments of genuine presence.",
    caseId: 'case-010',
    caseTitle: 'Post-surgical Endophthalmitis',
    tags: ['trust', 'patient-relationship', 'outcomes'],
  },
  {
    id: 'journal-006',
    title: "When Knowledge Isn't Enough",
    date: '2026-03-12',
    mood: 'challenged',
    sentimentScore: -0.5,
    content:
      "Today was one of the hardest days of my residency. The premature infant with retinopathy of prematurity needed urgent intervention, but the parents were hesitant about treatment. I knew the evidence, I could cite the ETROP study, I understood the staging perfectly. But none of that mattered when the mother looked at me with tears and said, 'Will my baby see?' I stumbled. I gave a textbook answer when she needed a human one. I need to learn how to hold space for a family's fear while still advocating for timely treatment. Knowledge without emotional intelligence is incomplete medicine.",
    caseId: 'case-004',
    caseTitle: 'Retinopathy of Prematurity',
    tags: ['emotional-intelligence', 'family-counselling', 'neonatal'],
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function JournalPage() {
  return (
    <PageTransition className="mx-auto max-w-4xl space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <NotebookPen className="size-6 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Reflection Journal
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Develop your HEART domain through structured reflection
            </p>
          </div>
          <Link href="/journal/new">
            <Button className="bg-teal-600 hover:bg-teal-700 text-white">
              <Plus className="size-4" />
              New Entry
            </Button>
          </Link>
        </div>
      </StaggerItem>

      {/* Journal entries */}
      <StaggerItem>
        <div className="space-y-4">
          {journalEntries.map((entry, index) => {
            const moodCfg = MOOD_CONFIG[entry.mood]
            const MoodIcon = moodCfg.icon
            const truncated =
              entry.content.length > 180
                ? entry.content.slice(0, 180) + '...'
                : entry.content

            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  ease: [0.22, 1, 0.36, 1],
                  delay: 0.15 + index * 0.07,
                }}
              >
                <Link
                  href={`/journal/${entry.id}`}
                  className="block"
                >
                  <Card className="transition-colors hover:bg-muted/30 cursor-pointer">
                    <CardContent className="space-y-3">
                      {/* Top row: date + mood */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.date).toLocaleDateString('en-IN', {
                            weekday: 'short',
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <MoodIcon className={`size-4 ${moodCfg.color}`} />
                          <span
                            className={`text-xs font-medium ${moodCfg.color}`}
                          >
                            {moodCfg.label}
                          </span>
                        </div>
                      </div>

                      {/* Title */}
                      <h3 className="text-base font-semibold text-foreground leading-snug">
                        {entry.title}
                      </h3>

                      {/* Sentiment bar */}
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          Sentiment
                        </span>
                        <div className="h-1.5 flex-1 max-w-40 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-all ${sentimentColor(entry.sentimentScore)}`}
                            style={{
                              width: `${sentimentWidth(entry.sentimentScore)}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Content preview */}
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {truncated}
                      </p>

                      {/* Bottom row: case badge + tags */}
                      <div className="flex flex-wrap items-center gap-2">
                        {entry.caseTitle && (
                          <Badge
                            variant="secondary"
                            className="gap-1 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                          >
                            <BookOpen className="size-3" />
                            {entry.caseTitle}
                          </Badge>
                        )}
                        {entry.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[11px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            )
          })}
        </div>
      </StaggerItem>
    </PageTransition>
  )
}
