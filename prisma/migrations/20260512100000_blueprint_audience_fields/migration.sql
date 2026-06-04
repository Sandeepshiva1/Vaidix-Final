-- Enrich Blueprint audience capture. Previously only `learnerLevel` was
-- recorded; the rest of the audience profile (clinical setting, prior
-- knowledge, equipment constraints, session length) had to be inferred by
-- Gemini. All four columns are nullable so existing rows stay valid.

ALTER TABLE "blueprints"
  ADD COLUMN "sessionLengthMinutes"  INTEGER,
  ADD COLUMN "clinicalSetting"       TEXT,
  ADD COLUMN "priorKnowledgeAssumed" TEXT,
  ADD COLUMN "constraints"           TEXT;
