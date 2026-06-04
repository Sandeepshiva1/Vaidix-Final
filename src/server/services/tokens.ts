// ════════════════════════════════════════════════════════════════════════════
// Token Utilities — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

export function mintToken(lengthBytes = 32): string {
  return crypto.randomBytes(lengthBytes).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Reversible token encryption (AES-256-GCM) ──────────────────────────────
// For the rare case where a share token must be re-displayed to its creator
// after the create response (e.g. the promo prep panel re-showing an existing
// link on reload). Storing the raw token would let a DB dump replay the link;
// storing only the hash makes re-display impossible. Encryption keeps both: a
// dump is useless without the key, but the server can decrypt to re-display.
// Key is derived from NEXTAUTH_SECRET so it rotates with the deployment secret.
function tokenCipherKey(): Buffer {
  return crypto.createHash('sha256').update(process.env.NEXTAUTH_SECRET ?? '').digest();
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenCipherKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Versioned, self-describing: v1:<iv>:<tag>:<ciphertext> (all hex).
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** Returns null for legacy/plaintext rows or any value that isn't valid ciphertext. */
export function decryptToken(stored: string): string | null {
  if (!stored.startsWith('v1:')) return null;
  const [, ivHex, tagHex, dataHex] = stored.split(':');
  if (!ivHex || !tagHex || !dataHex) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenCipherKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
