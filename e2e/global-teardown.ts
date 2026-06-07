// Playwright global teardown — delete everything global-setup created.

import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* optional */ }

export default async function globalTeardown() {
  if (!existsSync('e2e/.state.json')) return
  const state = JSON.parse(readFileSync('e2e/.state.json', 'utf8')) as { sessionIds: string[] }
  const db = new PrismaClient()
  for (const sid of state.sessionIds ?? []) {
    await db.liveHookResponse.deleteMany({ where: { hook: { sessionId: sid } } }).catch(() => {})
    await db.liveHook.deleteMany({ where: { sessionId: sid } }).catch(() => {})
    await db.sessionParticipant.deleteMany({ where: { sessionId: sid } }).catch(() => {})
    await db.preSessionQuestion.deleteMany({ where: { sessionId: sid } }).catch(() => {})
    await db.sessionTranscript.deleteMany({ where: { sessionId: sid } }).catch(() => {})
  }
  await db.teachingSession.deleteMany({ where: { id: { in: state.sessionIds ?? [] } } }).catch(() => {})
  await db.$disconnect()
  try { unlinkSync('e2e/.state.json') } catch { /* noop */ }
  console.log('[global-teardown] cleaned up')
}
