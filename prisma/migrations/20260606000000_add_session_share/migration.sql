-- Public session share — a no-login landing page at /s/[token]. Mirrors the
-- recording_shares / promo_shares security shape (sha256 tokenHash lookup,
-- encrypted token at rest, revocable, expiring, access-counted).

CREATE TABLE "session_shares" (
  "id"           TEXT NOT NULL,
  "sessionId"    TEXT NOT NULL,
  "token"        TEXT NOT NULL,
  "tokenHash"    TEXT NOT NULL,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdById"  TEXT NOT NULL,
  "revokedAt"    TIMESTAMP(3),
  "accessCount"  INTEGER NOT NULL DEFAULT 0,
  "lastAccessAt" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_shares_tokenHash_key" ON "session_shares"("tokenHash");
CREATE INDEX "session_shares_sessionId_idx" ON "session_shares"("sessionId");
CREATE INDEX "session_shares_expiresAt_idx" ON "session_shares"("expiresAt");

ALTER TABLE "session_shares"
  ADD CONSTRAINT "session_shares_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
