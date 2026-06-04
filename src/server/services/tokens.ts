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
