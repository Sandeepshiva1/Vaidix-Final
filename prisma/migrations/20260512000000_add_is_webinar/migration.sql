-- ============================================================================
-- Add isWebinar to teaching_sessions
-- ============================================================================
-- The field was added to prisma/schema.prisma but a migration was never
-- generated (likely via `prisma db push` during dev), so production RDS
-- lacks the column and `prisma.teachingSession.create()` throws P2022.
--
-- W7 Webinar mode: when isWebinar=true, sessions surface a public
-- registration page (/webinar/[id]/register) and registrants are auto-issued
-- a SessionInvite granting VIEWER role.

ALTER TABLE "teaching_sessions" ADD COLUMN "isWebinar" BOOLEAN NOT NULL DEFAULT false;
