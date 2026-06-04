-- ============================================================================
-- W9 Promo Share
-- ============================================================================
-- Adds promo_shares table for the public flyer/WA/IG landing page at /p/[token].
-- Mirrors recording_shares: tokenHash-only lookup (raw token never persisted),
-- expiresAt for auto-expiry, revokedAt for explicit speaker revocation,
-- access counters for analytics.

CREATE TABLE "promo_shares" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promo_shares_tokenHash_key" ON "promo_shares"("tokenHash");
CREATE INDEX "promo_shares_sessionId_idx" ON "promo_shares"("sessionId");
CREATE INDEX "promo_shares_expiresAt_idx" ON "promo_shares"("expiresAt");

ALTER TABLE "promo_shares" ADD CONSTRAINT "promo_shares_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "promo_shares" ADD CONSTRAINT "promo_shares_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "promo_shares" ADD CONSTRAINT "promo_shares_revokedById_fkey"
    FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
