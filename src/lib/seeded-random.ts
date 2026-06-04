/**
 * Mulberry32 — small, fast, deterministic seeded PRNG.
 *
 * Used to make Vaidix Review tests reproducibly different per session.
 * When 10 team members take the same topic test, each gets a unique seed
 * (their session ID + timestamp), so item order, generated-question
 * variants, and noise placement all differ across attempts. This prevents
 * the cohort effect where everyone memorises the same questions.
 *
 * The same seed always produces the same sequence — useful for the
 * training queue (so faculty can reproduce what the learner saw).
 */

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic Fisher-Yates shuffle using a seeded PRNG.
 */
export function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed)
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Generate a session seed from the current timestamp + a random nonce.
 * Stable for the lifetime of one Review session, unique across sessions.
 */
export function generateSessionSeed(): number {
  return ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}
