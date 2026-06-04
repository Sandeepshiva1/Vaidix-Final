-- Subscribable per-user iCal feed token
ALTER TABLE "users" ADD COLUMN "icalFeedToken" TEXT;
CREATE UNIQUE INDEX "users_icalFeedToken_key" ON "users"("icalFeedToken");
