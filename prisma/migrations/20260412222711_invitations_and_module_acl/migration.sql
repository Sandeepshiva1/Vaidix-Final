-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "acceptedUserId" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "lastResentAt" TIMESTAMP(3),
ADD COLUMN     "mciRegNumber" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "moduleOverrides" JSONB,
ADD COLUMN     "resendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revokedReason" TEXT,
ADD COLUMN     "subspecialty" TEXT,
ADD COLUMN     "yearOfResidency" INTEGER;

-- CreateTable
CREATE TABLE "user_module_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "grantedBy" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_module_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_module_permissions_userId_idx" ON "user_module_permissions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_module_permissions_userId_moduleKey_key" ON "user_module_permissions"("userId", "moduleKey");

-- AddForeignKey
ALTER TABLE "user_module_permissions" ADD CONSTRAINT "user_module_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
