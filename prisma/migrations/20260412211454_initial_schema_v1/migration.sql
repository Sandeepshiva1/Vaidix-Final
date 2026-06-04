-- CreateEnum
CREATE TYPE "Role" AS ENUM ('RESIDENT', 'FACULTY', 'PROGRAM_DIRECTOR', 'ADMIN', 'EXTERNAL_LEARNER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_INVITE', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('LECTURE', 'GRAND_ROUNDS', 'CASE_CONFERENCE', 'JOURNAL_CLUB', 'SKILLS_WORKSHOP', 'ASSESSMENT');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('RECORDING', 'RECORDING_PARTIAL', 'RECORDING_FAILED', 'TRANSCODING', 'TRANSCODING_FAILED', 'TRANSCRIBING', 'TRANSCRIBING_FAILED', 'AI_PROCESSING', 'AI_PROCESSING_FAILED', 'READY', 'ARCHIVED', 'EXPUNGED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'SCANNING_PHI', 'PENDING_REVIEW', 'PRIVATE_FACULTY', 'PUBLIC_WITH_SESSION', 'REJECTED', 'EXPUNGED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PPT', 'PDF', 'DOC', 'MARKDOWN', 'IMAGE', 'VIDEO', 'AUDIO', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentRoute" AS ENUM ('DECK_FORGE', 'REFERENCE', 'CASE_NOTE', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "CaseStage" AS ENUM ('PATIENT_STORY', 'OBSERVATION', 'HYPOTHESIS', 'INVESTIGATION', 'REFLECTION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "ScoringSource" AS ENUM ('CASE_CONVERSATION', 'DOPS', 'MINI_CEX', 'COURSE_QUIZ', 'CHALLENGE', 'SIMULATOR', 'FACULTY_MANUAL');

-- CreateEnum
CREATE TYPE "ScoringHead" AS ENUM ('HEAD', 'HEART', 'HANDS');

-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeckForgeStatus" AS ENUM ('QUEUED', 'EXTRACTING', 'GENERATING_SLIDES', 'REVIEW_PENDING', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "EscalationSeverity" AS ENUM ('TIER_1_DIRECT', 'TIER_2_INDIRECT', 'TIER_3_ROLEPLAY');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('DETECTED', 'NOTIFIED', 'ACKNOWLEDGED', 'DELIVERY_FAILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DpdpaRequestType" AS ENUM ('ACCESS', 'ERASURE', 'CORRECTION', 'EXPORT', 'CONSENT_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "DpdpaRequestStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SLACK', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "CourseFormat" AS ENUM ('VIDEO', 'READING', 'QUIZ', 'INTERACTIVE', 'MIXED');

-- CreateEnum
CREATE TYPE "CourseProgress" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CERTIFIED');

-- CreateEnum
CREATE TYPE "AssessmentOutcome" AS ENUM ('PASSED', 'BORDERLINE', 'NOT_YET_COMPETENT');

-- CreateEnum
CREATE TYPE "EpaLevel" AS ENUM ('LEVEL_1_OBSERVATION', 'LEVEL_2_DIRECT_SUPERVISION', 'LEVEL_3_INDIRECT_SUPERVISION', 'LEVEL_4_INDEPENDENT', 'LEVEL_5_SUPERVISING_OTHERS');

-- CreateEnum
CREATE TYPE "VcceItemKind" AS ENUM ('SAFETY_PROBE', 'CLINICAL_MCQ', 'HALLUCINATION_PROBE', 'BIAS_PROBE', 'INDIAN_CONTEXT_PROBE', 'LANGUAGE_PROBE');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('PATIENT_RECORDING', 'RESIDENT_PLATFORM', 'PHI_PROCESSING', 'AI_TRAINING_OPTIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "passwordVersion" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'RESIDENT',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_INVITE',
    "avatarUrl" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "token" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousRole" "Role",
    "newRole" "Role" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subspecialty" TEXT,
    "description" TEXT,
    "parentTopicId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "levels" (
    "id" TEXT NOT NULL,
    "levelNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minMastery" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_level_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "masteryScore" INTEGER NOT NULL DEFAULT 0,
    "unlockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_level_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "topicId" TEXT,
    "title" TEXT NOT NULL,
    "patientAgeYears" INTEGER,
    "patientSex" TEXT,
    "presentingComplaint" TEXT,
    "currentStage" "CaseStage" NOT NULL DEFAULT 'PATIENT_STORY',
    "status" "CaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "difficultyLevel" INTEGER NOT NULL DEFAULT 1,
    "caseNotes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_stage_history" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromStage" "CaseStage",
    "toStage" "CaseStage" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "CaseStage" NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "senderRole" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "aiModelVersion" TEXT,
    "tokenCount" INTEGER,
    "metadata" JSONB,
    "flaggedSafety" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_events" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "sourceType" "ScoringSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "caseId" TEXT,
    "headClinicalReasoning" INTEGER,
    "headEvidenceBase" INTEGER,
    "headDifferentialBuilding" INTEGER,
    "headInvestigationChoice" INTEGER,
    "heartEmpathy" INTEGER,
    "heartCommunication" INTEGER,
    "heartCulturalCompetence" INTEGER,
    "heartProfessionalism" INTEGER,
    "handsProcedure" INTEGER,
    "handsExamTechnique" INTEGER,
    "handsInstrumentation" INTEGER,
    "handsSafetyHabits" INTEGER,
    "headScore" DECIMAL(4,2),
    "heartScore" DECIMAL(4,2),
    "handsScore" DECIMAL(4,2),
    "reviewerId" TEXT,
    "comments" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "tags" TEXT[],
    "caseId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_items" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "easinessFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastQuality" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pearls" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "topicId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceRecordingId" TEXT,
    "sourceDocumentId" TEXT,
    "extractedByAi" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pearls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pearl_likes" (
    "id" TEXT NOT NULL,
    "pearlId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pearl_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atlas_images" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "topicId" TEXT,
    "uploadedById" TEXT,
    "caption" TEXT,
    "anatomicalRegion" TEXT,
    "modality" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atlas_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atlas_tags" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "atlas_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_collections" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "vectorStore" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL DEFAULT 'bge-m3',
    "dimensions" INTEGER NOT NULL DEFAULT 1024,
    "docCount" INTEGER NOT NULL DEFAULT 0,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "lastIndexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_documents" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "indexedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_chunks_meta" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "qdrantId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "textPreview" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_chunks_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkMetaId" TEXT,
    "url" TEXT,
    "title" TEXT,
    "author" TEXT,
    "publishedYear" INTEGER,
    "confidence" DECIMAL(3,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulators" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "modality" TEXT NOT NULL,
    "topicId" TEXT,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulator_runs" (
    "id" TEXT NOT NULL,
    "simulatorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" DECIMAL(4,2),
    "durationSec" INTEGER,
    "answers" JSONB NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulator_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "topicId" TEXT,
    "payload" JSONB NOT NULL,
    "answerKey" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_attempts" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "score" DECIMAL(4,2),
    "correct" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dops_assessments" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "assessorId" TEXT NOT NULL,
    "procedureName" TEXT NOT NULL,
    "procedureCode" TEXT,
    "outcome" "AssessmentOutcome" NOT NULL,
    "location" TEXT,
    "comments" TEXT,
    "artifacts" JSONB,
    "scoringEventId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dops_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mini_cex_assessments" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "assessorId" TEXT NOT NULL,
    "encounterType" TEXT NOT NULL,
    "complexity" INTEGER NOT NULL DEFAULT 1,
    "outcome" "AssessmentOutcome" NOT NULL,
    "domainScores" JSONB NOT NULL,
    "comments" TEXT,
    "scoringEventId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mini_cex_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epa_records" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "epaCode" TEXT NOT NULL,
    "epaName" TEXT NOT NULL,
    "currentLevel" "EpaLevel" NOT NULL,
    "lastRecalcAt" TIMESTAMP(3),
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "epa_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "epa_recalc_events" (
    "id" TEXT NOT NULL,
    "epaRecordId" TEXT NOT NULL,
    "previousLevel" "EpaLevel",
    "newLevel" "EpaLevel" NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epa_recalc_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcce_items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "VcceItemKind" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "prompt" TEXT NOT NULL,
    "expectedBehavior" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "tags" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vcce_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vcce_results" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "userId" TEXT,
    "passed" BOOLEAN NOT NULL,
    "aiResponse" TEXT,
    "scoringNotes" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vcce_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sessionType" "SessionType" NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "liveKitRoomSid" TEXT,
    "maxParticipants" INTEGER NOT NULL DEFAULT 100,
    "breakoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "consentRequired" BOOLEAN NOT NULL DEFAULT true,
    "hlsBroadcast" BOOLEAN NOT NULL DEFAULT false,
    "topicId" TEXT,
    "tags" TEXT[],
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participants" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "role" TEXT NOT NULL,
    "livekitIdentity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_chat_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_bans" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "bannedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_bans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'RECORDING',
    "pipelineStage" "RecordingStatus" NOT NULL DEFAULT 'RECORDING',
    "rawS3Key" TEXT,
    "hlsPath" TEXT,
    "durationSec" INTEGER,
    "sizeBytes" BIGINT,
    "mimeType" TEXT,
    "thumbnailUrl" TEXT,
    "egressJobId" TEXT,
    "bullmqJobId" TEXT,
    "transcodeStartedAt" TIMESTAMP(3),
    "transcodeFinishedAt" TIMESTAMP(3),
    "transcribeStartedAt" TIMESTAMP(3),
    "transcribeFinishedAt" TIMESTAMP(3),
    "aiProcessStartedAt" TIMESTAMP(3),
    "aiProcessFinishedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "expungedAt" TIMESTAMP(3),
    "expungedBy" TEXT,
    "expungeReason" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_stage_events" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "stage" "RecordingStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "success" BOOLEAN,
    "errorMessage" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "recording_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'sarvam',
    "modelVersion" TEXT,
    "content" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "diarized" BOOLEAN NOT NULL DEFAULT false,
    "piiRedacted" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_items" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestampSec" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_reactions" (
    "id" TEXT NOT NULL,
    "qaItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clips" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT,
    "startSec" INTEGER NOT NULL,
    "endSec" INTEGER NOT NULL,
    "s3Key" TEXT,
    "hlsPath" TEXT,
    "shareToken" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "route" "DocumentRoute" NOT NULL DEFAULT 'UNCLASSIFIED',
    "aiSuggestedRoute" "DocumentRoute",
    "aiConfidence" DECIMAL(3,2),
    "s3Key" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "visibility" "DocumentStatus" NOT NULL DEFAULT 'PRIVATE_FACULTY',
    "phiScanStatus" TEXT,
    "phiScanResult" JSONB,
    "deckForgeJobId" TEXT,
    "rejectionReason" TEXT,
    "expungedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_tags" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "document_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_session_links" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "visibleAfterSession" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_session_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deck_forge_jobs" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "DeckForgeStatus" NOT NULL DEFAULT 'QUEUED',
    "inputTitle" TEXT,
    "template" TEXT,
    "outputS3Key" TEXT,
    "extractedPearls" JSONB,
    "slideCount" INTEGER,
    "errorMessage" TEXT,
    "phiBlocked" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deck_forge_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseModel" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lora_adapters" (
    "id" TEXT NOT NULL,
    "baseModelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "trainingDataSize" INTEGER,
    "vcceRunId" TEXT,
    "vccePassed" BOOLEAN,
    "deployedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "s3Key" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lora_adapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fine_tune_runs" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "datasetSize" INTEGER,
    "hyperparams" JSONB,
    "lossCurve" JSONB,
    "outputAdapterId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fine_tune_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_queue_items" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "included" BOOLEAN,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "feedback" TEXT NOT NULL,
    "reason" TEXT,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_escalations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "severity" "EscalationSeverity" NOT NULL,
    "language" TEXT NOT NULL,
    "matchedPattern" TEXT,
    "inputPreview" TEXT,
    "status" "EscalationStatus" NOT NULL DEFAULT 'DETECTED',
    "webhookFiredAt" TIMESTAMP(3),
    "notificationSentAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_failures" (
    "id" TEXT NOT NULL,
    "escalationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rag_reindex_jobs" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "docsProcessed" INTEGER NOT NULL DEFAULT 0,
    "chunksCreated" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_reindex_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "track" "ScoringHead" NOT NULL,
    "format" "CourseFormat" NOT NULL DEFAULT 'MIXED',
    "topicId" TEXT,
    "estimatedMinutes" INTEGER,
    "prerequisites" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_items" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "kind" "CourseFormat" NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "estimatedMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_enrollments" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "progress" "CourseProgress" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "percentComplete" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_completions" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certificateId" TEXT,
    "score" DECIMAL(4,2),
    "cmeCredits" DECIMAL(4,1),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerId" TEXT,
    "weakSubscore" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "dismissedAt" TIMESTAMP(3),
    "outcomeType" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "courseTitle" TEXT NOT NULL,
    "completionDate" TIMESTAMP(3) NOT NULL,
    "cmeCredits" DECIMAL(4,1),
    "certificateNumber" TEXT NOT NULL,
    "pdfS3Key" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mciRegNumber" TEXT,
    "yearOfResidency" INTEGER,
    "subspecialty" TEXT,
    "affiliation" TEXT,
    "bio" TEXT,
    "languages" TEXT[],
    "timezone" TEXT DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "browserNotifications" BOOLEAN NOT NULL DEFAULT false,
    "dailyDigestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiMemoryOptIn" BOOLEAN NOT NULL DEFAULT true,
    "trainingDataOptIn" BOOLEAN NOT NULL DEFAULT false,
    "uiTheme" TEXT NOT NULL DEFAULT 'light',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "casesCompleted" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "totalStudyMinutes" INTEGER NOT NULL DEFAULT 0,
    "lastStudyAt" TIMESTAMP(3),
    "pearlsBookmarked" INTEGER NOT NULL DEFAULT 0,
    "qaAsked" INTEGER NOT NULL DEFAULT 0,
    "totalScore" DECIMAL(6,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gamification_points" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gamification_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "purpose" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_records" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "JobStage" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveryStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cme_credits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "credits" DECIMAL(4,1) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "certificateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cme_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_index" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "tags" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_actions" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpdpa_requests" (
    "id" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "kind" "DpdpaRequestType" NOT NULL,
    "status" "DpdpaRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "description" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetSlaAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "handledById" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dpdpa_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expunge_jobs" (
    "id" TEXT NOT NULL,
    "dpdpaRequestId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "s3DeletedAt" TIMESTAMP(3),
    "dbDeletedAt" TIMESTAMP(3),
    "ragDeletedAt" TIMESTAMP(3),
    "auditEventId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expunge_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_exports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "s3Key" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "archiveAfterDays" INTEGER,
    "legalHoldExceptions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consentType" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "sourceIp" TEXT,
    "evidenceBlob" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phi_scan_results" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "detectedEntities" JSONB NOT NULL,
    "severity" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "scannerVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phi_scan_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_records" (
    "id" TEXT NOT NULL,
    "adapterId" TEXT,
    "modelVersion" TEXT NOT NULL,
    "vcceRunId" TEXT,
    "vccePassed" BOOLEAN NOT NULL,
    "silencePassed" BOOLEAN NOT NULL,
    "deployedById" TEXT NOT NULL,
    "deploymentTarget" TEXT NOT NULL,
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "rolledBackAt" TIMESTAMP(3),
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "silence_test_runs" (
    "id" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "adapterId" TEXT,
    "totalProbes" INTEGER NOT NULL,
    "passedCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "languagesCovered" TEXT[],
    "passed" BOOLEAN NOT NULL,
    "runByUserId" TEXT,
    "environment" TEXT NOT NULL,
    "logS3Key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "silence_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_audit_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "targetUserId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_records" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emr_integrations_stub" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "config" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emr_integrations_stub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emr_mappings_stub" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "localField" TEXT NOT NULL,
    "externalField" TEXT NOT NULL,
    "transformJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emr_mappings_stub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_providers_stub" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "metadataUrl" TEXT,
    "config" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sso_providers_stub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_groups_stub" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "membersJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scim_groups_stub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "auth_accounts_userId_idx" ON "auth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_provider_providerAccountId_key" ON "auth_accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_sessionToken_key" ON "auth_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions"("userId");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_status_idx" ON "invitations"("status");

-- CreateIndex
CREATE INDEX "invitations_token_idx" ON "invitations"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "rate_limits_blockedUntil_idx" ON "rate_limits"("blockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_bucketKey_key" ON "rate_limits"("bucketKey");

-- CreateIndex
CREATE INDEX "user_role_history_userId_idx" ON "user_role_history"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "topics_slug_key" ON "topics"("slug");

-- CreateIndex
CREATE INDEX "topics_parentTopicId_idx" ON "topics"("parentTopicId");

-- CreateIndex
CREATE INDEX "topics_subspecialty_idx" ON "topics"("subspecialty");

-- CreateIndex
CREATE UNIQUE INDEX "levels_levelNumber_key" ON "levels"("levelNumber");

-- CreateIndex
CREATE INDEX "user_level_progress_userId_idx" ON "user_level_progress"("userId");

-- CreateIndex
CREATE INDEX "user_level_progress_topicId_idx" ON "user_level_progress"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "user_level_progress_userId_topicId_levelId_key" ON "user_level_progress"("userId", "topicId", "levelId");

-- CreateIndex
CREATE INDEX "cases_residentId_idx" ON "cases"("residentId");

-- CreateIndex
CREATE INDEX "cases_topicId_idx" ON "cases"("topicId");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_currentStage_idx" ON "cases"("currentStage");

-- CreateIndex
CREATE INDEX "case_stage_history_caseId_idx" ON "case_stage_history"("caseId");

-- CreateIndex
CREATE INDEX "conversations_caseId_idx" ON "conversations"("caseId");

-- CreateIndex
CREATE INDEX "conversations_userId_idx" ON "conversations"("userId");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- CreateIndex
CREATE INDEX "messages_userId_idx" ON "messages"("userId");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");

-- CreateIndex
CREATE INDEX "scoring_events_residentId_createdAt_idx" ON "scoring_events"("residentId", "createdAt");

-- CreateIndex
CREATE INDEX "scoring_events_sourceType_sourceId_idx" ON "scoring_events"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "scoring_events_caseId_idx" ON "scoring_events"("caseId");

-- CreateIndex
CREATE INDEX "journal_entries_userId_idx" ON "journal_entries"("userId");

-- CreateIndex
CREATE INDEX "journal_entries_caseId_idx" ON "journal_entries"("caseId");

-- CreateIndex
CREATE INDEX "journal_entries_sessionId_idx" ON "journal_entries"("sessionId");

-- CreateIndex
CREATE INDEX "bookmarks_userId_idx" ON "bookmarks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "bookmarks_userId_targetType_targetId_key" ON "bookmarks"("userId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "reviews_userId_idx" ON "reviews"("userId");

-- CreateIndex
CREATE INDEX "review_items_reviewId_idx" ON "review_items"("reviewId");

-- CreateIndex
CREATE INDEX "review_items_nextDueAt_idx" ON "review_items"("nextDueAt");

-- CreateIndex
CREATE INDEX "pearls_topicId_idx" ON "pearls"("topicId");

-- CreateIndex
CREATE INDEX "pearls_approved_idx" ON "pearls"("approved");

-- CreateIndex
CREATE INDEX "pearls_sourceRecordingId_idx" ON "pearls"("sourceRecordingId");

-- CreateIndex
CREATE INDEX "pearl_likes_pearlId_idx" ON "pearl_likes"("pearlId");

-- CreateIndex
CREATE UNIQUE INDEX "pearl_likes_pearlId_userId_key" ON "pearl_likes"("pearlId", "userId");

-- CreateIndex
CREATE INDEX "atlas_images_topicId_idx" ON "atlas_images"("topicId");

-- CreateIndex
CREATE INDEX "atlas_images_modality_idx" ON "atlas_images"("modality");

-- CreateIndex
CREATE INDEX "atlas_tags_tag_idx" ON "atlas_tags"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "atlas_tags_imageId_tag_key" ON "atlas_tags"("imageId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "rag_collections_slug_key" ON "rag_collections"("slug");

-- CreateIndex
CREATE INDEX "rag_documents_collectionId_idx" ON "rag_documents"("collectionId");

-- CreateIndex
CREATE INDEX "rag_documents_sourceType_sourceId_idx" ON "rag_documents"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "rag_chunks_meta_qdrantId_key" ON "rag_chunks_meta"("qdrantId");

-- CreateIndex
CREATE INDEX "rag_chunks_meta_documentId_idx" ON "rag_chunks_meta"("documentId");

-- CreateIndex
CREATE INDEX "citations_sourceType_sourceId_idx" ON "citations"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "simulators_slug_key" ON "simulators"("slug");

-- CreateIndex
CREATE INDEX "simulator_runs_simulatorId_idx" ON "simulator_runs"("simulatorId");

-- CreateIndex
CREATE INDEX "simulator_runs_userId_idx" ON "simulator_runs"("userId");

-- CreateIndex
CREATE INDEX "challenge_attempts_userId_idx" ON "challenge_attempts"("userId");

-- CreateIndex
CREATE INDEX "dops_assessments_residentId_idx" ON "dops_assessments"("residentId");

-- CreateIndex
CREATE INDEX "dops_assessments_assessorId_idx" ON "dops_assessments"("assessorId");

-- CreateIndex
CREATE INDEX "mini_cex_assessments_residentId_idx" ON "mini_cex_assessments"("residentId");

-- CreateIndex
CREATE INDEX "epa_records_residentId_idx" ON "epa_records"("residentId");

-- CreateIndex
CREATE UNIQUE INDEX "epa_records_residentId_epaCode_key" ON "epa_records"("residentId", "epaCode");

-- CreateIndex
CREATE INDEX "epa_recalc_events_epaRecordId_idx" ON "epa_recalc_events"("epaRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "vcce_items_code_key" ON "vcce_items"("code");

-- CreateIndex
CREATE INDEX "vcce_items_kind_idx" ON "vcce_items"("kind");

-- CreateIndex
CREATE INDEX "vcce_items_language_idx" ON "vcce_items"("language");

-- CreateIndex
CREATE INDEX "vcce_results_runId_idx" ON "vcce_results"("runId");

-- CreateIndex
CREATE INDEX "vcce_results_itemId_idx" ON "vcce_results"("itemId");

-- CreateIndex
CREATE INDEX "vcce_results_passed_idx" ON "vcce_results"("passed");

-- CreateIndex
CREATE INDEX "teaching_sessions_hostId_idx" ON "teaching_sessions"("hostId");

-- CreateIndex
CREATE INDEX "teaching_sessions_status_idx" ON "teaching_sessions"("status");

-- CreateIndex
CREATE INDEX "teaching_sessions_scheduledStart_idx" ON "teaching_sessions"("scheduledStart");

-- CreateIndex
CREATE INDEX "session_participants_sessionId_idx" ON "session_participants"("sessionId");

-- CreateIndex
CREATE INDEX "session_participants_userId_idx" ON "session_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_participants_sessionId_userId_key" ON "session_participants"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "session_chat_messages_sessionId_createdAt_idx" ON "session_chat_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "session_bans_sessionId_idx" ON "session_bans"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "session_bans_sessionId_userId_key" ON "session_bans"("sessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_sessionId_key" ON "recordings"("sessionId");

-- CreateIndex
CREATE INDEX "recordings_status_idx" ON "recordings"("status");

-- CreateIndex
CREATE INDEX "recordings_pipelineStage_idx" ON "recordings"("pipelineStage");

-- CreateIndex
CREATE INDEX "recording_stage_events_recordingId_idx" ON "recording_stage_events"("recordingId");

-- CreateIndex
CREATE INDEX "transcripts_recordingId_idx" ON "transcripts"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "transcripts_recordingId_language_key" ON "transcripts"("recordingId", "language");

-- CreateIndex
CREATE INDEX "qa_items_recordingId_timestampSec_idx" ON "qa_items"("recordingId", "timestampSec");

-- CreateIndex
CREATE INDEX "qa_items_userId_idx" ON "qa_items"("userId");

-- CreateIndex
CREATE INDEX "qa_reactions_qaItemId_idx" ON "qa_reactions"("qaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "qa_reactions_qaItemId_userId_kind_key" ON "qa_reactions"("qaItemId", "userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "clips_shareToken_key" ON "clips"("shareToken");

-- CreateIndex
CREATE INDEX "clips_recordingId_idx" ON "clips"("recordingId");

-- CreateIndex
CREATE INDEX "clips_createdById_idx" ON "clips"("createdById");

-- CreateIndex
CREATE INDEX "documents_uploadedById_idx" ON "documents"("uploadedById");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_route_idx" ON "documents"("route");

-- CreateIndex
CREATE INDEX "document_tags_tag_idx" ON "document_tags"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "document_tags_documentId_tag_key" ON "document_tags"("documentId", "tag");

-- CreateIndex
CREATE INDEX "document_session_links_sessionId_idx" ON "document_session_links"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "document_session_links_documentId_sessionId_key" ON "document_session_links"("documentId", "sessionId");

-- CreateIndex
CREATE INDEX "deck_forge_jobs_documentId_idx" ON "deck_forge_jobs"("documentId");

-- CreateIndex
CREATE INDEX "deck_forge_jobs_status_idx" ON "deck_forge_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_slug_key" ON "ai_models"("slug");

-- CreateIndex
CREATE INDEX "lora_adapters_baseModelId_idx" ON "lora_adapters"("baseModelId");

-- CreateIndex
CREATE INDEX "fine_tune_runs_modelId_idx" ON "fine_tune_runs"("modelId");

-- CreateIndex
CREATE INDEX "fine_tune_runs_status_idx" ON "fine_tune_runs"("status");

-- CreateIndex
CREATE INDEX "training_queue_items_status_idx" ON "training_queue_items"("status");

-- CreateIndex
CREATE INDEX "training_queue_items_sourceType_sourceId_idx" ON "training_queue_items"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "training_feedback_userId_idx" ON "training_feedback"("userId");

-- CreateIndex
CREATE INDEX "training_feedback_sourceType_sourceId_idx" ON "training_feedback"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "safety_escalations_userId_idx" ON "safety_escalations"("userId");

-- CreateIndex
CREATE INDEX "safety_escalations_severity_idx" ON "safety_escalations"("severity");

-- CreateIndex
CREATE INDEX "safety_escalations_status_idx" ON "safety_escalations"("status");

-- CreateIndex
CREATE INDEX "escalation_failures_escalationId_idx" ON "escalation_failures"("escalationId");

-- CreateIndex
CREATE INDEX "rag_reindex_jobs_collectionId_idx" ON "rag_reindex_jobs"("collectionId");

-- CreateIndex
CREATE INDEX "rag_reindex_jobs_status_idx" ON "rag_reindex_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_track_idx" ON "courses"("track");

-- CreateIndex
CREATE INDEX "courses_topicId_idx" ON "courses"("topicId");

-- CreateIndex
CREATE INDEX "course_modules_courseId_idx" ON "course_modules"("courseId");

-- CreateIndex
CREATE INDEX "course_items_moduleId_idx" ON "course_items"("moduleId");

-- CreateIndex
CREATE INDEX "course_enrollments_userId_idx" ON "course_enrollments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "course_enrollments_courseId_userId_key" ON "course_enrollments"("courseId", "userId");

-- CreateIndex
CREATE INDEX "course_completions_userId_idx" ON "course_completions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "course_completions_courseId_userId_key" ON "course_completions"("courseId", "userId");

-- CreateIndex
CREATE INDEX "recommendations_residentId_idx" ON "recommendations"("residentId");

-- CreateIndex
CREATE INDEX "recommendations_targetType_targetId_idx" ON "recommendations"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificateNumber_key" ON "certificates"("certificateNumber");

-- CreateIndex
CREATE INDEX "certificates_userId_idx" ON "certificates"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_stats_userId_key" ON "user_stats"("userId");

-- CreateIndex
CREATE INDEX "gamification_points_userId_idx" ON "gamification_points"("userId");

-- CreateIndex
CREATE INDEX "gamification_points_createdAt_idx" ON "gamification_points"("createdAt");

-- CreateIndex
CREATE INDEX "files_ownerId_idx" ON "files"("ownerId");

-- CreateIndex
CREATE INDEX "files_purpose_idx" ON "files"("purpose");

-- CreateIndex
CREATE INDEX "job_records_queueName_status_idx" ON "job_records"("queueName", "status");

-- CreateIndex
CREATE INDEX "job_records_jobId_idx" ON "job_records"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_slug_key" ON "webhooks"("slug");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_idx" ON "webhook_deliveries"("webhookId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries"("status");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_kind_idx" ON "notifications"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_kind_channel_key" ON "notification_preferences"("userId", "kind", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_tokenHash_key" ON "api_keys"("tokenHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE INDEX "cme_credits_userId_idx" ON "cme_credits"("userId");

-- CreateIndex
CREATE INDEX "search_index_entityType_idx" ON "search_index"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "search_index_entityType_entityId_key" ON "search_index"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_eventType_createdAt_idx" ON "audit_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "admin_actions_actorId_idx" ON "admin_actions"("actorId");

-- CreateIndex
CREATE INDEX "admin_actions_actionType_idx" ON "admin_actions"("actionType");

-- CreateIndex
CREATE INDEX "dpdpa_requests_subjectUserId_idx" ON "dpdpa_requests"("subjectUserId");

-- CreateIndex
CREATE INDEX "dpdpa_requests_status_idx" ON "dpdpa_requests"("status");

-- CreateIndex
CREATE INDEX "expunge_jobs_status_idx" ON "expunge_jobs"("status");

-- CreateIndex
CREATE INDEX "expunge_jobs_targetType_targetId_idx" ON "expunge_jobs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "data_exports_userId_idx" ON "data_exports"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_entityType_key" ON "retention_policies"("entityType");

-- CreateIndex
CREATE INDEX "consent_records_userId_consentType_idx" ON "consent_records"("userId", "consentType");

-- CreateIndex
CREATE INDEX "phi_scan_results_targetType_targetId_idx" ON "phi_scan_results"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "deployment_records_adapterId_idx" ON "deployment_records"("adapterId");

-- CreateIndex
CREATE INDEX "deployment_records_deploymentTarget_idx" ON "deployment_records"("deploymentTarget");

-- CreateIndex
CREATE INDEX "silence_test_runs_modelVersion_idx" ON "silence_test_runs"("modelVersion");

-- CreateIndex
CREATE INDEX "silence_test_runs_createdAt_idx" ON "silence_test_runs"("createdAt");

-- CreateIndex
CREATE INDEX "session_audit_events_sessionId_idx" ON "session_audit_events"("sessionId");

-- CreateIndex
CREATE INDEX "compliance_records_kind_idx" ON "compliance_records"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "sso_providers_stub_slug_key" ON "sso_providers_stub"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "scim_groups_stub_externalId_key" ON "scim_groups_stub"("externalId");

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_history" ADD CONSTRAINT "user_role_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_parentTopicId_fkey" FOREIGN KEY ("parentTopicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_level_progress" ADD CONSTRAINT "user_level_progress_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_stage_history" ADD CONSTRAINT "case_stage_history_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_events" ADD CONSTRAINT "scoring_events_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_events" ADD CONSTRAINT "scoring_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pearls" ADD CONSTRAINT "pearls_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pearl_likes" ADD CONSTRAINT "pearl_likes_pearlId_fkey" FOREIGN KEY ("pearlId") REFERENCES "pearls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atlas_images" ADD CONSTRAINT "atlas_images_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atlas_tags" ADD CONSTRAINT "atlas_tags_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "atlas_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "rag_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rag_chunks_meta" ADD CONSTRAINT "rag_chunks_meta_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "rag_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulator_runs" ADD CONSTRAINT "simulator_runs_simulatorId_fkey" FOREIGN KEY ("simulatorId") REFERENCES "simulators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulator_runs" ADD CONSTRAINT "simulator_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dops_assessments" ADD CONSTRAINT "dops_assessments_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dops_assessments" ADD CONSTRAINT "dops_assessments_assessorId_fkey" FOREIGN KEY ("assessorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_cex_assessments" ADD CONSTRAINT "mini_cex_assessments_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_cex_assessments" ADD CONSTRAINT "mini_cex_assessments_assessorId_fkey" FOREIGN KEY ("assessorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epa_records" ADD CONSTRAINT "epa_records_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epa_recalc_events" ADD CONSTRAINT "epa_recalc_events_epaRecordId_fkey" FOREIGN KEY ("epaRecordId") REFERENCES "epa_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcce_results" ADD CONSTRAINT "vcce_results_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "vcce_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vcce_results" ADD CONSTRAINT "vcce_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_sessions" ADD CONSTRAINT "teaching_sessions_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_chat_messages" ADD CONSTRAINT "session_chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_chat_messages" ADD CONSTRAINT "session_chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_bans" ADD CONSTRAINT "session_bans_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_bans" ADD CONSTRAINT "session_bans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_stage_events" ADD CONSTRAINT "recording_stage_events_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_items" ADD CONSTRAINT "qa_items_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_items" ADD CONSTRAINT "qa_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_reactions" ADD CONSTRAINT "qa_reactions_qaItemId_fkey" FOREIGN KEY ("qaItemId") REFERENCES "qa_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_reactions" ADD CONSTRAINT "qa_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clips" ADD CONSTRAINT "clips_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_tags" ADD CONSTRAINT "document_tags_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_session_links" ADD CONSTRAINT "document_session_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_session_links" ADD CONSTRAINT "document_session_links_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_forge_jobs" ADD CONSTRAINT "deck_forge_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_forge_jobs" ADD CONSTRAINT "deck_forge_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lora_adapters" ADD CONSTRAINT "lora_adapters_baseModelId_fkey" FOREIGN KEY ("baseModelId") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fine_tune_runs" ADD CONSTRAINT "fine_tune_runs_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_feedback" ADD CONSTRAINT "training_feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_escalations" ADD CONSTRAINT "safety_escalations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_items" ADD CONSTRAINT "course_items_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_completions" ADD CONSTRAINT "course_completions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_completions" ADD CONSTRAINT "course_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gamification_points" ADD CONSTRAINT "gamification_points_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cme_credits" ADD CONSTRAINT "cme_credits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpdpa_requests" ADD CONSTRAINT "dpdpa_requests_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expunge_jobs" ADD CONSTRAINT "expunge_jobs_dpdpaRequestId_fkey" FOREIGN KEY ("dpdpaRequestId") REFERENCES "dpdpa_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_audit_events" ADD CONSTRAINT "session_audit_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
