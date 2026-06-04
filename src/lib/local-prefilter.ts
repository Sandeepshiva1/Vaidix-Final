/**
 * VAIDIX LOCAL PRE-FILTER
 *
 * Cheap rule-based check that runs BEFORE we call Gemini. Catches obviously
 * vague, empty, or off-topic answers and asks a clarifying follow-up directly,
 * without burning a Gemini API call.
 *
 * Substantive answers (those that pass the pre-filter) are then sent to
 * Gemini for nuanced multi-axis grading.
 *
 * This saves ~80% of Gemini calls and keeps the demo snappy even with
 * a slow network.
 */

export type PrefilterReason =
  | 'empty'
  | 'too_short'
  | 'one_word_generic'
  | 'placeholder_phrase'
  | 'off_topic'
  | 'looks_substantive'

export interface PrefilterVerdict {
  /** True = skip Gemini, ask follow-up directly */
  shouldSkipGemini: boolean
  reason: PrefilterReason
  /** Clarifying question to show the resident if shouldSkipGemini is true */
  followUp: string | null
}

const SINGLE_WORD_FILLERS = new Set([
  'yes', 'no', 'ok', 'okay', 'fine', 'sure', 'maybe', 'idk', 'dunno',
  'hmm', 'um', 'uh', 'whatever', 'none', 'nothing',
])

const PLACEHOLDER_PHRASES = [
  'get test',
  'order tests',
  'order test',
  'do investigations',
  'get reports',
  'get test reports',
  "i don't know",
  "i dont know",
  'idk',
  'not sure',
  'check labs',
  'order labs',
  'do tests',
  'send for tests',
  'consult senior',
  'refer to senior',
  'i would refer',
  'check everything',
  'do everything',
]

// Medical/clinical vocabulary — if NONE of these appear and the answer is
// long enough to have something, it's almost certainly off-topic
const MEDICAL_VOCAB =
  /\b(eye|vision|retina|fundus|patient|diabet|glaucoma|cataract|macula|optic|cornea|iris|lens|vitreous|inject|drop|surger|exam|test|OCT|FFA|VEGF|hypopyon|edema|laser|treat|diagn|symptom|disease|history|family|medication|drug|risk|fever|pain|loss|swell|red|red eye|pressure|IOP|tear|sight|sees?|seeing|blur|floater|flash|curtain|night|day|examin|investigat|cell|tissue|bleed|hemorr|nerve|muscle|skin|child|elder|year|age|medic|hospit|clinic|condition|chronic|acute|infect|inflam|tumor|mass|degener|atrophy|necro|ischa|isch|vasc|scler|chor|conjunct|orbit|periorbit|lid|eyelid|brow|tear|lacrim|punctum|sclera|drug|pill|tablet|cream|ointment|antibiot|steroid|topical|systemic|oral|IV|operate|operation|excise|remove|graft|implant|prosthe|aware|asleep|local|general|anaes|anesth)\b/i

/**
 * Run the cheap local check on a free-text answer.
 * Items where shouldSkipGemini is true should be handled with the
 * built-in followUp string and never reach the Gemini grader.
 */
export function localPrefilter(answer: string): PrefilterVerdict {
  const trimmed = answer.trim()
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  const lower = trimmed.toLowerCase()

  // Empty
  if (wordCount === 0) {
    return {
      shouldSkipGemini: true,
      reason: 'empty',
      followUp: 'You need to give me a real answer for me to score it. Try once more.',
    }
  }

  // Ultra-short (1-2 words) — almost always not enough
  if (wordCount < 3) {
    return {
      shouldSkipGemini: true,
      reason: 'too_short',
      followUp:
        'That is too brief for me to understand what you are thinking. Can you give me at least one full sentence?',
    }
  }

  // Single-word fillers / no-confidence answers
  const firstWord = lower.split(/\s+/)[0].replace(/[^a-z]/g, '')
  if (wordCount < 6 && SINGLE_WORD_FILLERS.has(firstWord)) {
    return {
      shouldSkipGemini: true,
      reason: 'one_word_generic',
      followUp:
        'I need a real clinical answer here, not a one-word reply. What would you actually do for this patient?',
    }
  }

  // Generic placeholders ("get tests", "do investigations")
  const isPlaceholder = PLACEHOLDER_PHRASES.some((p) => lower.includes(p))
  if (isPlaceholder && wordCount < 14) {
    return {
      shouldSkipGemini: true,
      reason: 'placeholder_phrase',
      followUp:
        'Be specific — which exact tests or investigations would you order, and what are you looking for in each one?',
    }
  }

  // Off-topic / gibberish — long enough to have content but no medical vocab
  if (wordCount > 6 && !MEDICAL_VOCAB.test(lower)) {
    return {
      shouldSkipGemini: true,
      reason: 'off_topic',
      followUp:
        'I think we may have lost the thread. Can you answer the clinical question above directly?',
    }
  }

  // Looks like a real clinical answer — let Gemini grade it
  return {
    shouldSkipGemini: false,
    reason: 'looks_substantive',
    followUp: null,
  }
}
