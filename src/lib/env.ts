// ════════════════════════════════════════════════════════════════════════════
// Type-safe environment variable access + production safety gates
// ════════════════════════════════════════════════════════════════════════════
// Usage: import { env } from '@/lib/env'
// Fails fast at startup if any required env var is missing/malformed.
// Production gates: refuse to boot if a misconfigured
// production deploy would leak patient data to external services.

import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // NextAuth
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32),

  // Email
  EMAIL_HOST: z.string(),
  EMAIL_PORT: z.coerce.number(),
  EMAIL_USER: z.string(),
  EMAIL_PASSWORD: z.string(),
  EMAIL_FROM: z.string(),

  // LiveKit
  // Scheme is validated to be ws:// or wss:// here; the production gate below
  // additionally REFUSES ws:// at runtime so the LiveKit join token (carried in
  // the wss:// URL query string) and all A/V media can never traverse cleartext.
  LIVEKIT_URL: z
    .string()
    .url()
    .refine((u) => /^wss?:\/\//i.test(u), 'LIVEKIT_URL must be a ws:// or wss:// URL'),
  LIVEKIT_API_KEY: z.string(),
  LIVEKIT_API_SECRET: z.string().min(16),

  // MinIO / S3 — S3_ENDPOINT is what the Next.js host process (or any
  // worker running on the host) uses to reach object storage; for local dev
  // that's localhost:9000. OMIT it entirely for real AWS S3 so the SDK targets
  // the region's default endpoint (bucket.s3.<region>.amazonaws.com).
  S3_ENDPOINT: z.string().url().optional(),
  // S3_PUBLIC_ENDPOINT is the browser-reachable URL for the same storage.
  // In production MinIO is only on Docker's internal network (minio:9000),
  // proxied publicly at https://s3.vaidix.lvpei.org via nginx. Presigned
  // PUT/GET URLs are signed against this host so browsers can actually reach
  // them. Defaults to S3_ENDPOINT so local dev needs no extra config.
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_REGION: z.string().default('us-east-1'),
  // Object-storage addressing mode. MinIO needs path-style URLs
  // (endpoint/bucket/key); AWS S3 needs virtual-host style
  // (bucket.s3.<region>.amazonaws.com). Defaults to path-style so existing
  // MinIO deploys are unchanged — set "false" when migrating to AWS S3.
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  // EGRESS_S3_ENDPOINT is the same MinIO seen FROM INSIDE the LiveKit
  // egress container, where `localhost` would mean the egress container
  // itself. In dev, that's the Docker service name `http://minio:9000`.
  // In production this typically equals S3_ENDPOINT (one canonical URL).
  EGRESS_S3_ENDPOINT: z.string().url().default('http://minio:9000'),

  // AI providers
  SARVAM_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  /// Image generation model (router: aiGenerateImage). "Nano Banana" /
  /// Gemini 2.5 Flash Image. Override to imagen-3.0-generate-002 for
  /// higher-quality medical illustrations at higher cost.
  GEMINI_IMAGE_MODEL: z.string().default('gemini-2.5-flash-image'),
  SARVAM_STT_MODEL: z.string().default('saaras:v3'),
  // Deepgram — live captions for English-only sessions (Phase 1).
  // Indic / code-mix sessions still route to Sarvam Saaras (Phase 2).
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().default('nova-3'),
  // Anthropic Claude — multi-model routing.
  // ANTHROPIC_MODEL is the default fallback (legacy callers like
  // post-session content). New code uses the router (`./router.ts`) which
  // picks ANTHROPIC_OPUS_MODEL for reasoning ops (clinical review, content
  // depth) and ANTHROPIC_SONNET_MODEL for design/structure ops.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  ANTHROPIC_OPUS_MODEL: z.string().default('claude-opus-4-7'),
  ANTHROPIC_SONNET_MODEL: z.string().default('claude-sonnet-4-6'),
  // DeepSeek — second-tier fallback when Anthropic is unreachable (no key,
  // no credit). 'deepseek-chat' (V3) is the cheap reasoning model;
  // 'deepseek-reasoner' (R1) trades latency for harder reasoning. We default
  // to V3 because forge/review needs throughput, not chain-of-thought.
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),

  // Provider selectors
  TRANSCRIPTION_PROVIDER: z.enum(['sarvam', 'self_hosted']).default('sarvam'),
  SELF_HOSTED_TRANSCRIPTION_URL: z.string().url().optional(),
  AI_PROVIDER: z.enum(['gemini', 'vaidix_core']).default('gemini'),

  // WhatsApp Business API
  WHATSAPP_API_URL: z.string().url().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // Live captions LiveKit Agent shared secret
  LIVE_CAPTIONS_INGEST_SECRET: z.string().min(16).optional(),

  // Limits & paths
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(500),
  VAIDIX_DATA_ROOT: z.string(),

  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed. Check .env.local');
}

export const env = parsed.data;

// ─── Production safety gates ───────────────────────────────────────────────
// These run once at module load. Failure throws and refuses to boot in prod.
// Reference: internal design notes, the video architecture notes
//
// IMPORTANT: gates apply to RUNTIME only — `next build` runs with
// NODE_ENV=production but is a compilation step, not a deploy. Skip during
// build phase. Also allow an explicit escape hatch (VAIDIX_DISABLE_PROD_GATE)
// for staging-with-Sarvam scenarios LVPEI explicitly approves in writing.

const NEXT_PHASE = process.env.NEXT_PHASE;
const isBuildPhase = NEXT_PHASE === 'phase-production-build';
const gateDisabled = process.env.VAIDIX_DISABLE_PROD_GATE === 'true';

if (env.NODE_ENV === 'production' && !isBuildPhase && !gateDisabled) {
  const violations: string[] = [];

  // Gate 1: transcription provider must be self_hosted in production AND no Sarvam key in env.
  if (env.TRANSCRIPTION_PROVIDER === 'sarvam') {
    violations.push(
      "TRANSCRIPTION_PROVIDER=sarvam is not allowed in production. Set TRANSCRIPTION_PROVIDER=self_hosted and provide SELF_HOSTED_TRANSCRIPTION_URL."
    );
  }
  if (env.SARVAM_API_KEY) {
    violations.push(
      "SARVAM_API_KEY must NOT be present in production env. Patient audio cannot leave LVPEI infrastructure. Remove the key."
    );
  }

  // Gate 2: when AI_PROVIDER=vaidix_core (Phase B), GEMINI_API_KEY must be absent.
  if (env.AI_PROVIDER === 'vaidix_core' && env.GEMINI_API_KEY) {
    violations.push(
      "AI_PROVIDER=vaidix_core but GEMINI_API_KEY is still set. Remove GEMINI_API_KEY from prod env."
    );
  }

  // Gate 3: NEXTAUTH_SECRET must be a strong production secret (≥64 chars).
  if (env.NEXTAUTH_SECRET.length < 64) {
    violations.push(
      `NEXTAUTH_SECRET must be ≥64 chars in production (currently ${env.NEXTAUTH_SECRET.length}). Generate with: openssl rand -hex 32`
    );
  }

  // Gate 4: DATABASE_URL must not point to localhost in production.
  if (/(?:^|@|\/\/)(?:localhost|127\.0\.0\.1)/i.test(env.DATABASE_URL)) {
    violations.push("DATABASE_URL points to localhost in production. Refusing to boot.");
  }

  // Gate 5: self-hosted transcription requires its URL.
  if (env.TRANSCRIPTION_PROVIDER === 'self_hosted' && !env.SELF_HOSTED_TRANSCRIPTION_URL) {
    violations.push("TRANSCRIPTION_PROVIDER=self_hosted requires SELF_HOSTED_TRANSCRIPTION_URL.");
  }

  // Gate 6b: LIVEKIT_URL must be wss:// in production. The LiveKit join JWT is
  // carried in the WebSocket URL query string (browser WS handshakes can't use
  // headers); ws:// would put that token AND all patient-visible A/V media on
  // the wire in cleartext. TLS (wss) makes the whole URL, query string included,
  // confidential in transit. Refuse to boot otherwise.
  if (/^ws:\/\//i.test(env.LIVEKIT_URL)) {
    violations.push(
      `LIVEKIT_URL=${env.LIVEKIT_URL} uses cleartext ws:// in production. ` +
      `The join token + all media would be unencrypted on the wire. Use wss://.`
    );
  }

  // Gate 6: NEXTAUTH_URL must not be localhost in production. Invitation,
  // password-reset, and welcome emails embed this URL; if it points to
  // localhost, recipients get unclickable links pointing back to the dev box.
  if (/(?:^|\/\/)(?:localhost|127\.0\.0\.1)/i.test(env.NEXTAUTH_URL)) {
    violations.push(
      `NEXTAUTH_URL=${env.NEXTAUTH_URL} points to localhost in production. ` +
      `Email links would be broken. Set NEXTAUTH_URL to the public URL of the deployment (e.g. https://vaidix.lvpei.org).`
    );
  }

  if (violations.length > 0) {
    console.error('❌ Production env gate failed. Refusing to boot:');
    for (const v of violations) console.error(`  • ${v}`);
    throw new Error(
      `Production env gate failed (${violations.length} violation${violations.length === 1 ? '' : 's'}). See logs.`
    );
  }
}

// ─── Provider helpers (read by services to pick the right adapter) ────────
export const isSelfHostedTranscription = env.TRANSCRIPTION_PROVIDER === 'self_hosted';
export const isVaidixCoreAi = env.AI_PROVIDER === 'vaidix_core';
