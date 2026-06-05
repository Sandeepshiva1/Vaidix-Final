// ════════════════════════════════════════════════════════════════════════════
// secure-id — reversible, tamper-evident, opaque encoding for database IDs in URLs
// ════════════════════════════════════════════════════════════════════════════
//
// Why this exists:
//   Database IDs (cuids) appear verbatim in URLs like /session/clx8k2p9q0000.
//   That makes the URL "readable" and trivially enumerable/tamperable. This
//   module turns a raw id into an opaque, keyed token for URLs, and back again.
//
//   The real access-control boundary is still server-side authorization — every
//   route MUST check the user is allowed to see the decoded id. Opaque URLs are
//   defense-in-depth (no casual reading, no enumeration), NOT a substitute for
//   authz.
//
// Design goals:
//   • Reversible & deterministic  → the same id always yields the same token, so
//     URLs stay stable and bookmarkable.
//   • Tamper-evident              → flipping a character makes decode() reject it.
//   • Isomorphic & synchronous    → no node:crypto, no async; runs identically in
//     server components AND client components (which build links inline).
//   • Tolerant decode (IMPORTANT) → decodeId() accepts a raw id and returns it
//     unchanged. This is what makes an incremental, app-wide rollout safe: a link
//     that hasn't been migrated to encodeId() yet still carries the raw id, and
//     the route's decodeId(param) handles both forms. Existing bookmarks keep
//     working too.
//
// Note on strength: ids are not secrets, so this is keyed *obfuscation* (hashids
// class), not AES. Set NEXT_PUBLIC_SECURE_ID_SECRET to key it to your deployment.
// ════════════════════════════════════════════════════════════════════════════

// Public so client bundles can encode links; falls back to a baked key (still
// obfuscates, just not deployment-unique). Keep server + client in agreement by
// using the NEXT_PUBLIC_ value everywhere.
const SECRET =
  process.env.NEXT_PUBLIC_SECURE_ID_SECRET ??
  process.env.SECURE_ID_SECRET ??
  'vaidix-opaque-id-key-v1'

// ── tiny deterministic, isomorphic PRNG primitives ──────────────────────────
// xmur3: string → 32-bit seed generator. mulberry32: 32-bit seed → PRNG.
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) & 0xff
  }
}

// 4-byte salt deterministically derived from (secret, id) — stable per id.
function saltFor(id: string): number[] {
  const r = xmur3(`${SECRET}|salt|${id}`)
  const a = r(), b = r()
  return [a & 0xff, (a >>> 8) & 0xff, b & 0xff, (b >>> 8) & 0xff]
}
function keystream(saltHex: string): () => number {
  return mulberry32(xmur3(`${SECRET}|ks|${saltHex}`)())
}

// ── URL-safe base64 (no padding) ────────────────────────────────────────────
// Uses only Web APIs (btoa/atob/TextEncoder/TextDecoder), available in modern
// Node (18+) AND the Edge runtime — so this module is safe to import from
// middleware. Deliberately no `Buffer` (absent/polyfilled in Edge).
function bytesToB64url(bytes: number[]): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlToBytes(token: string): number[] | null {
  try {
    const bin = atob(token.replace(/-/g, '+').replace(/_/g, '/'))
    const out: number[] = []
    for (let i = 0; i < bin.length; i += 1) out.push(bin.charCodeAt(i) & 0xff)
    return out
  } catch {
    return null
  }
}
function hex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}
function utf8Bytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s))
}
function bytesToUtf8(bytes: number[]): string {
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

/**
 * Encode a raw database id into an opaque, URL-safe token.
 * Empty/falsy input is returned unchanged (so optional ids stay optional).
 */
export function encodeId(id: string): string {
  if (!id) return id
  const salt = saltFor(id)
  const ks = keystream(hex(salt))
  const plain = utf8Bytes(id)
  const cipher = plain.map((p) => p ^ ks())
  return bytesToB64url([...salt, ...cipher])
}

/**
 * Decode an opaque token back to the raw id.
 * TOLERANT: if `token` is not a valid token (e.g. it's already a raw id, or it
 * was tampered with), the input is returned unchanged. Callers then look the id
 * up as usual — a genuinely invalid id simply 404s at the DB layer. This is what
 * lets opaque + raw URLs coexist during an incremental rollout.
 */
export function decodeId(token: string): string {
  if (!token) return token
  const bytes = b64urlToBytes(token)
  if (!bytes || bytes.length < 5) return token
  const salt = bytes.slice(0, 4)
  const ks = keystream(hex(salt))
  const plain = bytes.slice(4).map((c) => c ^ ks())
  let id: string
  try {
    id = bytesToUtf8(plain)
  } catch {
    return token
  }
  // Re-derive the salt from the recovered id; a match proves the token was
  // produced by encodeId() with this secret and wasn't tampered with.
  const expect = saltFor(id)
  if (expect[0] === salt[0] && expect[1] === salt[1] && expect[2] === salt[2] && expect[3] === salt[3]) {
    return id
  }
  return token
}

/** True when `token` decodes to a different (i.e. genuinely encoded) value. */
export function isEncodedId(token: string): boolean {
  return decodeId(token) !== token
}
