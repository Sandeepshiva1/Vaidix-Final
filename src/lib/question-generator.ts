/**
 * VAIDIX QUESTION GENERATOR
 *
 * Generates review items at runtime by combining knowledge atoms with
 * question templates. The advantage: a small set of validated atoms can
 * yield unlimited unique questions, and we don't need an API to do it.
 *
 * Phase A (now): rule-based template substitution
 * Phase B (planned): Claude API call to generate fresh phrasings + new atoms
 *                    seeded by faculty notes
 *
 * Output items conform to the same shape as static items in review-items.json
 * so the engine and scorers don't need to know if an item was hand-written
 * or generated.
 */

import knowledgeAtomsData from '@/mock-data/knowledge-atoms.json'
import { mulberry32 } from './seeded-random'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeAtom {
  id: string
  topic: string
  subTopic: string
  difficulty: number
  fact: string
  context: string
  mechanism: string
  audienceMatch: ('patient_family' | 'peer' | 'senior')[]
  axesScored: ('knowledge' | 'reasoning' | 'communication' | 'empathy' | 'relevance' | 'safety')[]
  rubric: {
    good: string[]
    poor: string[]
  }
  source: string
}

export interface GeneratedExplainItem {
  id: string
  topic: string
  subTopic: string
  difficulty: number
  type: 'explain-to'
  audience: 'patient_family' | 'peer' | 'senior'
  scenario: string
  prompt: string
  axesScored: ('knowledge' | 'reasoning' | 'communication' | 'empathy' | 'relevance' | 'safety')[]
  rubric: { good: string[]; poor: string[] }
  modelAnswer: string
  generated: true
  sourceAtomId: string
  sourceCitation: string
}

const ALL_ATOMS = knowledgeAtomsData as KnowledgeAtom[]

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION TEMPLATES
//
// Each template is keyed by audience and produces a different cognitive
// demand from the same atom.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES: Record<
  'patient_family' | 'peer' | 'senior',
  ((atom: KnowledgeAtom) => { scenario: string; prompt: string; modelAnswer: string })[]
> = {
  patient_family: [
    (atom) => ({
      scenario: `Your patient is asking about ${atom.context}. They are scared and want a clear, plain-language explanation.`,
      prompt: `Explain what is happening with their condition and what this means for them — without using medical jargon. Address their fear directly.`,
      modelAnswer: `${simplifyForPatient(atom.fact)}. ${simplifyForPatient(atom.mechanism)} The most important thing for you to know is that we have a clear plan and we are going to walk through it together.`,
    }),
    (atom) => ({
      scenario: `A worried family member of a patient with ${atom.subTopic} stops you in the corridor. They ask "what does this mean for my mother / father / wife?"`,
      prompt: `Give a calm, plain-language answer that tells them the truth without overwhelming them.`,
      modelAnswer: `I understand this is a worrying time. ${simplifyForPatient(atom.fact)}. The good news is we caught it and we know what to do next.`,
    }),
  ],
  peer: [
    (atom) => ({
      scenario: `Your PGY-1 colleague asks why ${atom.fact}.`,
      prompt: `Explain the mechanism in 2-3 sentences. Be precise and use the right terminology.`,
      modelAnswer: atom.mechanism,
    }),
    (atom) => ({
      scenario: `You are at a journal club discussion of ${atom.subTopic}. A peer asks you to explain the underlying mechanism behind the standard management.`,
      prompt: `Walk through the mechanism in a few sentences with appropriate clinical reasoning.`,
      modelAnswer: atom.mechanism,
    }),
  ],
  senior: [
    (atom) => ({
      scenario: `You are presenting on rounds. The senior consultant asks: "Tell me in 30 seconds — ${atom.fact}. Why does it matter clinically?"`,
      prompt: `30-second answer. Compressed, clinically relevant, and surface the most important practical implication.`,
      modelAnswer: `${atom.fact}. Practically: ${atom.mechanism.split('.').slice(0, 2).join('.')}.`,
    }),
  ],
}

/**
 * Crude simplification for patient-facing text. Replaces a few common
 * medical terms with plain-language equivalents. Phase B will use Claude
 * to do this properly.
 */
function simplifyForPatient(text: string): string {
  return text
    .replace(/\bCNV\b/g, 'abnormal blood vessels')
    .replace(/\bVEGF\b/g, 'a chemical signal')
    .replace(/\bVEGF-A\b/g, 'a chemical signal')
    .replace(/\bRPE\b/g, 'the cell layer at the back of the eye')
    .replace(/\bphotoreceptor[s]?\b/gi, 'light-sensing cells')
    .replace(/\bvitreous\b/gi, 'the jelly inside the eye')
    .replace(/\bischaemia\b/gi, 'reduced blood supply')
    .replace(/\bischemia\b/gi, 'reduced blood supply')
    .replace(/\bnecrosis\b/gi, 'tissue damage')
    .replace(/\bvasculopathy\b/gi, 'blood vessel problem')
    .replace(/\bperipheral\b/gi, 'around the edges')
    .replace(/\bsubretinal fluid\b/gi, 'fluid under the retina')
    .replace(/\bPED\b/g, 'a small lifted area')
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATOR — main API
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  topic?: string
  count?: number
  audiences?: ('patient_family' | 'peer' | 'senior')[]
  /** Optional seed for deterministic generation in tests */
  seed?: number
}

/**
 * Generate `count` review items for a given topic by sampling atoms and
 * applying compatible templates. If `seed` is provided, the same seed
 * always produces the same items — used so different team members get
 * different generated questions, but each session is reproducible.
 */
export function generateReviewItems(opts: GenerateOptions = {}): GeneratedExplainItem[] {
  const { topic, count = 10, audiences, seed } = opts
  const rng = seed !== undefined ? mulberry32(seed) : Math.random

  // 1. Filter atoms by topic
  const candidateAtoms = topic
    ? ALL_ATOMS.filter((a) => a.topic === topic)
    : ALL_ATOMS

  if (candidateAtoms.length === 0) return []

  // 2. Build (atom × audience) pairs
  type Pair = { atom: KnowledgeAtom; audience: 'patient_family' | 'peer' | 'senior' }
  const pairs: Pair[] = []
  for (const atom of candidateAtoms) {
    const audiencesForAtom = audiences
      ? atom.audienceMatch.filter((a) => audiences.includes(a))
      : atom.audienceMatch
    for (const audience of audiencesForAtom) {
      pairs.push({ atom, audience })
    }
  }

  if (pairs.length === 0) return []

  // 3. Shuffle pairs with the seeded RNG (or Math.random fallback)
  const shuffled = [...pairs].sort(() => rng() - 0.5)
  const selected = shuffled.slice(0, count)

  // 4. Render each pair through a random template for that audience
  const items: GeneratedExplainItem[] = selected.map(({ atom, audience }, i) => {
    const templates = TEMPLATES[audience]
    const template = templates[Math.floor(rng() * templates.length)]
    const rendered = template(atom)

    // Difficulty modulation by audience
    let difficulty = atom.difficulty
    if (audience === 'patient_family') difficulty = Math.max(0.3, difficulty - 0.1)
    if (audience === 'senior') difficulty = Math.min(0.95, difficulty + 0.1)

    // Audience-aware axis loading
    const baseAxes = atom.axesScored
    let axesScored = baseAxes
    if (audience === 'patient_family') {
      axesScored = Array.from(new Set([...baseAxes, 'communication', 'empathy']))
    }
    if (audience === 'senior') {
      axesScored = Array.from(new Set([...baseAxes, 'relevance', 'safety']))
    }

    return {
      id: `gen-${atom.id}-${audience}-${Date.now()}-${i}`,
      topic: atom.topic,
      subTopic: atom.subTopic,
      difficulty,
      type: 'explain-to' as const,
      audience,
      scenario: rendered.scenario,
      prompt: rendered.prompt,
      axesScored,
      rubric: atom.rubric,
      modelAnswer: rendered.modelAnswer,
      generated: true,
      sourceAtomId: atom.id,
      sourceCitation: atom.source,
    }
  })

  return items
}

/**
 * Hybrid pool builder. Returns the static items merged with N freshly
 * generated items for the topic. The engine treats both the same.
 */
export function buildHybridPool<T>(
  staticItems: T[],
  topic: string,
  generatedCount = 8
): (T | GeneratedExplainItem)[] {
  const generated = generateReviewItems({ topic, count: generatedCount })
  return [...staticItems, ...generated]
}
