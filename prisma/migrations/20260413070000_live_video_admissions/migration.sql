-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('PENDING', 'ADMITTED', 'DENIED', 'EXPIRED');

-- AlterTable
ALTER TABLE "teaching_sessions"
  ADD COLUMN "shareToken" TEXT,
  ADD COLUMN "shareTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "teaching_sessions_shareToken_key" ON "teaching_sessions"("shareToken");

-- CreateTable
CREATE TABLE "session_admissions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'PENDING',
    "displayName" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "denyReason" TEXT,

    CONSTRAINT "session_admissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_admissions_sessionId_userId_key" ON "session_admissions"("sessionId", "userId");
CREATE INDEX "session_admissions_sessionId_status_idx" ON "session_admissions"("sessionId", "status");
CREATE INDEX "session_admissions_userId_idx" ON "session_admissions"("userId");

-- AddForeignKey
ALTER TABLE "session_admissions" ADD CONSTRAINT "session_admissions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_admissions" ADD CONSTRAINT "session_admissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_admissions" ADD CONSTRAINT "session_admissions_decidedBy_fkey" FOREIGN KEY ("decidedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
