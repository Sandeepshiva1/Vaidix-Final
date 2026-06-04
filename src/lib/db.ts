// ════════════════════════════════════════════════════════════════════════════
// Prisma Client Singleton
// ════════════════════════════════════════════════════════════════════════════
// Pattern: one PrismaClient per process (not per request).
// In dev, Next.js hot-reload would spawn multiple clients without the global cache.
//
// Connection pool (HARDENING-PLAN item #9): pool size is configured via the
// DATABASE_URL query string (`connection_limit`, `pool_timeout`). Keep prod at
// ≥30 per app instance; ensure Postgres `max_connections` is sized for app +
// workers + admin tooling combined. See `.env.example` for guidance.

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

export type { PrismaClient } from '@prisma/client';
