// /api/ready — dependency readiness probe.
// Pings Postgres, Redis, MinIO, and LiveKit with strict per-dep timeouts.
// 200 only when all four respond healthy; 503 with a structured failure list
// otherwise. Intended for k8s readinessProbe and load-balancer drain checks.
//
// Public route (allowed in auth.config.ts) — must not require a session.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { s3, BUCKET } from '@/lib/storage';
import { roomClient } from '@/lib/livekit';
import { HeadBucketCommand } from '@aws-sdk/client-s3';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEP_TIMEOUT_MS = 1500;

interface DepResult {
  name: 'postgres' | 'redis' | 'minio' | 'livekit';
  ok: boolean;
  latencyMs: number;
  error?: string;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function check(name: DepResult['name'], fn: () => Promise<unknown>): Promise<DepResult> {
  const t0 = Date.now();
  try {
    await withTimeout(fn(), DEP_TIMEOUT_MS, name);
    return { name, ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return {
      name,
      ok: false,
      latencyMs: Date.now() - t0,
      error: (err as Error).message,
    };
  }
}

export async function GET() {
  const deps = await Promise.all([
    check('postgres', () => db.$queryRaw`SELECT 1`),
    check('redis', () => redis.ping()),
    check('minio', () => s3.send(new HeadBucketCommand({ Bucket: BUCKET }))),
    check('livekit', () => roomClient.listRooms()),
  ]);

  const allOk = deps.every((d) => d.ok);
  return NextResponse.json(
    {
      ok: allOk,
      service: 'vaidix',
      ts: new Date().toISOString(),
      deps,
    },
    {
      status: allOk ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    }
  );
}
