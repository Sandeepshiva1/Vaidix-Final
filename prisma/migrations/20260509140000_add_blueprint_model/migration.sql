-- Curriculum blueprint table — one row per Gemini-generated topic blueprint.
-- Stores the markdown response so faculty can revisit / copy / share a plan
-- without paying for another Gemini call.

CREATE TABLE "blueprints" (
  "id"            TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "topic"         TEXT NOT NULL,
  "learnerLevel"  TEXT,
  "content"       TEXT NOT NULL,
  "source"        TEXT NOT NULL DEFAULT 'gemini',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blueprints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "blueprints_requestedById_idx" ON "blueprints"("requestedById");
CREATE INDEX "blueprints_createdAt_idx" ON "blueprints"("createdAt");

ALTER TABLE "blueprints"
  ADD CONSTRAINT "blueprints_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
