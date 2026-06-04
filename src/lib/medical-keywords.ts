/**
 * VAIDIX MEDICAL KEYWORD GLOSSARY
 *
 * Per-topic vocabulary lists used to bias the speech-to-text engine
 * (Deepgram Nova-2 Medical) toward correct medical terminology.
 *
 * IMPORTANT: This is *biasing*, not *correcting*. We never rewrite the
 * resident's answer with an LLM — that would mask their actual knowledge
 * gaps in a graded test. We only nudge the STT model to prefer these
 * terms when audio is acoustically ambiguous.
 *
 * Deepgram `keywords` quirks (Nova-2):
 *  - Single-token terms only. Multi-word phrases get split; that's fine —
 *    each token still gets boosted individually.
 *  - Intensity scale 0-10. Default 1. Higher = more aggressive bias.
 *  - Reserve high intensities (5+) for terms that are both common in the
 *    domain AND acoustically confusable with everyday words
 *    (e.g. "drusen" → "doozen", "RPE" → "RPI").
 *  - Acronyms that are spelled letter-by-letter (R-P-E) are recognized
 *    better when listed in uppercase.
 */

export interface KeywordEntry {
  /** The token to bias toward. Single word, no spaces. */
  term: string
  /** Boost intensity 1-10. Default 2. */
  intensity?: number
}

// ---------------------------------------------------------------------------
// RETINA & VITREORETINAL
// ---------------------------------------------------------------------------
const RETINA_KEYWORDS: KeywordEntry[] = [
  // Anatomy
  { term: 'retina' },
  { term: 'macula', intensity: 3 },
  { term: 'fovea', intensity: 3 },
  { term: 'foveola' },
  { term: 'RPE', intensity: 5 },
  { term: 'choroid', intensity: 3 },
  { term: 'sclera' },
  { term: 'vitreous', intensity: 3 },
  { term: 'ILM', intensity: 4 },
  { term: 'Bruch', intensity: 4 },
  { term: 'photoreceptor' },
  { term: 'photoreceptors' },
  { term: 'ganglion' },

  // Age-related macular degeneration
  { term: 'AMD', intensity: 4 },
  { term: 'drusen', intensity: 6 },
  { term: 'CNV', intensity: 4 },
  { term: 'CNVM', intensity: 5 },
  { term: 'neovascular', intensity: 3 },
  { term: 'neovascularization', intensity: 3 },
  { term: 'geographic', intensity: 2 },
  { term: 'atrophy', intensity: 3 },

  // Diabetic retinopathy
  { term: 'diabetic', intensity: 3 },
  { term: 'retinopathy', intensity: 4 },
  { term: 'NPDR', intensity: 5 },
  { term: 'PDR', intensity: 5 },
  { term: 'DME', intensity: 5 },
  { term: 'CSME', intensity: 5 },
  { term: 'microaneurysm', intensity: 4 },
  { term: 'microaneurysms', intensity: 4 },
  { term: 'exudate', intensity: 3 },
  { term: 'exudates', intensity: 3 },

  // Vascular occlusions
  { term: 'CRVO', intensity: 5 },
  { term: 'BRVO', intensity: 5 },
  { term: 'CRAO', intensity: 5 },
  { term: 'BRAO', intensity: 5 },

  // Detachment / vitreoretinal interface
  { term: 'detachment', intensity: 3 },
  { term: 'rhegmatogenous', intensity: 5 },
  { term: 'tractional', intensity: 3 },
  { term: 'lattice', intensity: 3 },
  { term: 'PVD', intensity: 4 },
  { term: 'ERM', intensity: 4 },
  { term: 'VMT', intensity: 4 },
  { term: 'VMA', intensity: 4 },

  // Inherited / inflammatory
  { term: 'CSCR', intensity: 5 },
  { term: 'CSR', intensity: 4 },
  { term: 'Stargardt', intensity: 4 },
  { term: 'pigmentosa', intensity: 4 },
  { term: 'toxoplasmosis', intensity: 3 },
  { term: 'endophthalmitis', intensity: 4 },

  // ROP
  { term: 'ROP', intensity: 4 },
  { term: 'prematurity', intensity: 3 },

  // Imaging
  { term: 'OCT', intensity: 4 },
  { term: 'OCTA', intensity: 4 },
  { term: 'FFA', intensity: 4 },
  { term: 'ICG', intensity: 4 },
  { term: 'autofluorescence', intensity: 3 },
  { term: 'FAF', intensity: 3 },
  { term: 'ERG', intensity: 4 },
  { term: 'fundus', intensity: 4 },

  // Treatment
  { term: 'VEGF', intensity: 5 },
  { term: 'ranibizumab', intensity: 5 },
  { term: 'aflibercept', intensity: 5 },
  { term: 'bevacizumab', intensity: 5 },
  { term: 'brolucizumab', intensity: 5 },
  { term: 'faricimab', intensity: 5 },
  { term: 'intravitreal', intensity: 4 },
  { term: 'photocoagulation', intensity: 4 },
  { term: 'PRP', intensity: 4 },
  { term: 'vitrectomy', intensity: 4 },
  { term: 'PPV', intensity: 4 },
  { term: 'cryotherapy', intensity: 3 },
  { term: 'tamponade', intensity: 3 },
  { term: 'silicone' },
]

// ---------------------------------------------------------------------------
// TOPIC → KEYWORDS MAP
// Add other topic glossaries here as the demo expands. For now retina is
// the only fully-built one — other topics fall back to a small shared
// general-ophthalmology stub so the bias list is never empty.
// ---------------------------------------------------------------------------
const GENERAL_OPHTHALMOLOGY: KeywordEntry[] = [
  { term: 'cornea', intensity: 3 },
  { term: 'sclera' },
  { term: 'conjunctiva' },
  { term: 'iris' },
  { term: 'pupil' },
  { term: 'lens' },
  { term: 'IOL', intensity: 4 },
  { term: 'IOP', intensity: 4 },
  { term: 'glaucoma', intensity: 3 },
  { term: 'cataract', intensity: 3 },
  { term: 'phacoemulsification', intensity: 4 },
  { term: 'slit-lamp' },
  { term: 'fundoscopy' },
  { term: 'visual', intensity: 2 },
  { term: 'acuity', intensity: 3 },
  { term: 'diopter' },
  { term: 'refraction' },
  { term: 'astigmatism', intensity: 3 },
  { term: 'myopia', intensity: 3 },
  { term: 'hyperopia', intensity: 3 },
]

const KEYWORDS_BY_TOPIC: Record<string, KeywordEntry[]> = {
  retina: RETINA_KEYWORDS,
}

/**
 * Returns the bias-keyword list for a topic. Falls back to a general
 * ophthalmology glossary so we always send *something* — better than
 * letting the model run un-biased on medical audio.
 */
export function getKeywordsForTopic(topicId: string | undefined | null): KeywordEntry[] {
  if (!topicId) return GENERAL_OPHTHALMOLOGY
  const specific = KEYWORDS_BY_TOPIC[topicId]
  if (specific) return [...specific, ...GENERAL_OPHTHALMOLOGY]
  return GENERAL_OPHTHALMOLOGY
}

/**
 * Format the keyword list as Deepgram query-string params.
 * Returns an array of "term:intensity" strings (one per keyword) that the
 * route handler appends as separate `keywords=` query parameters.
 *
 * Deepgram requires each keyword to be its own query param — comma-joining
 * does NOT work.
 */
export function formatDeepgramKeywords(entries: KeywordEntry[]): string[] {
  return entries.map((e) => {
    const intensity = e.intensity ?? 2
    return `${e.term}:${intensity}`
  })
}
