// ════════════════════════════════════════════════════════════════════════════
// Per-listener caption translation — Gemini Flash w/ Redis cache
// ════════════════════════════════════════════════════════════════════════════
// The captions producer emits text in one source language (English in
// Phase 1). When a listener's chosen UI language differs, the overlay
// requests a translation per finalized segment. This service handles the
// Gemini call + Redis cache so 50 listeners watching the same lecture
// pay for ~1 translation per segment, not 50.
//
// Cache key: sha1(text|from|to). TTL 5min — long enough for everyone
// watching the same live moment to share, short enough that we can
// re-render with a corrected prompt without polluting the cache.

import crypto from 'node:crypto';
import { redis } from '@/lib/redis';
import { geminiGenerate, GeminiUnavailableError, GeminiUnparseableError } from '@/server/services/ai/gemini';

export class TranslateError extends Error {
  constructor(
    public readonly code: 'AI_UNAVAILABLE' | 'AI_UNPARSEABLE' | 'EMPTY_OUTPUT',
    message: string,
  ) {
    super(message);
    this.name = 'TranslateError';
  }
}

export const SUPPORTED_LANGS = ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn', 'ur'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

const LANG_NAMES: Record<SupportedLang, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
  ta: 'Tamil',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
  ur: 'Urdu',
};

const CACHE_TTL_SEC = 5 * 60;

/// Code-mix-preserving prompt: do NOT translate medical English terms,
/// drug names, anatomy, acronyms — those should stay verbatim. The point
/// is fluent target-language *narrative* with English clinical idiom intact,
/// because that's how LVPEI residents and faculty actually speak.
const SYSTEM_PROMPT = `You are a medical-translation specialist for ophthalmology lecture captions at LV Prasad Eye Institute.

TRANSLATE the user-provided utterance from {{FROM}} to {{TO}} with these strict rules:

1. PRESERVE IN ENGLISH (do NOT translate):
   - Medical English terms (e.g. trabeculectomy, aflibercept, NPDR, OCT, IOP, fundus, vitrectomy, DALK, PKP, slit-lamp, gonioscopy)
   - Drug names (timolol, latanoprost, ranibizumab, bevacizumab, etc.)
   - Anatomical terms (macula, optic disc, retina, cornea, iris)
   - Acronyms (AAC, PAC, FFA, ICGA, USG, YAG, SLT, PRP)
   - Numerals and units (10 mmHg, 6/6, 0.5 D, 20 mg)
2. TRANSLATE the connective narrative around them into natural, fluent {{TO}}.
3. Keep the cadence short — these are live captions, not formal translation.
4. Do NOT add explanatory text, footnotes, or commentary.
5. Output ONLY the translated text. No quotes, no preamble, no JSON wrapper.

Example (en→te): "Patient ki IOP 28 mmHg undi, start glaucoma treatment with latanoprost"
Output: "రోగికి IOP 28 mmHg ఉంది, glaucoma treatment with latanoprost మొదలుపెట్టండి"`;

function cacheKey(text: string, from: string, to: string): string {
  const h = crypto.createHash('sha1').update(`${text}|${from}|${to}`).digest('hex').slice(0, 24);
  return `captrx:${from}:${to}:${h}`;
}

export interface TranslateResult {
  translated: string;
  cached: boolean;
}

/**
 * Translate a single live-caption segment. Returns same text untouched if
 * source == target. Returns cached result on hit. Calls Gemini Flash on miss.
 */
export async function translateCaption(args: {
  text: string;
  from: SupportedLang;
  to: SupportedLang;
}): Promise<TranslateResult> {
  const { text, from, to } = args;
  if (from === to) return { translated: text, cached: false };

  const cleaned = text.trim();
  if (!cleaned) return { translated: '', cached: false };

  const key = cacheKey(cleaned, from, to);
  try {
    const hit = await redis.get(key);
    if (hit) return { translated: hit, cached: true };
  } catch {
    // Redis miss → fall through to Gemini. Don't fail-closed on cache lookup;
    // the caller (CAPTIONS_TRANSLATE rate-limit) is the cost ceiling.
  }

  const prompt = SYSTEM_PROMPT.replace(/\{\{FROM\}\}/g, LANG_NAMES[from]).replace(/\{\{TO\}\}/g, LANG_NAMES[to]);

  let raw: string;
  try {
    raw = await geminiGenerate({
      systemInstruction: prompt,
      userParts: [{ text: cleaned }],
      responseMimeType: 'text/plain',
      temperature: 0.2,
    });
  } catch (err) {
    if (err instanceof GeminiUnavailableError) {
      throw new TranslateError('AI_UNAVAILABLE', err.message);
    }
    if (err instanceof GeminiUnparseableError) {
      throw new TranslateError('AI_UNPARSEABLE', err.message);
    }
    throw err;
  }

  const out = raw.trim();
  if (!out) throw new TranslateError('EMPTY_OUTPUT', 'Translation returned no text. Please try again.');

  try {
    await redis.set(key, out, 'EX', CACHE_TTL_SEC);
  } catch {
    // Best-effort cache write; not fatal.
  }
  return { translated: out, cached: false };
}
