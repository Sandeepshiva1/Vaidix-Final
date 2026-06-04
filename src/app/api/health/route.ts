// /api/health — process-level liveness probe.
// Cheap: no I/O. Returns 200 as long as the Node process is responsive.
// Use this for k8s livenessProbe / load balancer health.
//
// For dependency checks (DB / Redis / S3 / LiveKit), use /api/ready instead.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'vaidix',
      ts: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } }
  );
}
