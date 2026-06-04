// ════════════════════════════════════════════════════════════════════════════
// Redis Client Singleton (ioredis)
// ════════════════════════════════════════════════════════════════════════════
// Used for: BullMQ job queue, rate limiting, session cache.
// BullMQ requires a dedicated connection per worker — see lib/queue.ts

import Redis from 'ioredis';
import { env } from './env';

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,      // required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

export function makeRedisConnection() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
