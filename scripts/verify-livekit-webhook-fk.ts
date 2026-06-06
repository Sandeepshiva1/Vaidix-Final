// ════════════════════════════════════════════════════════════════════════════
// Verification: LiveKit webhook participant FK regression
// ════════════════════════════════════════════════════════════════════════════
// Reproduces and proves the fix for the production log spam:
//   P2003 — Foreign key constraint violated on `session_participants_sessionId_fkey`
//   on `event: participant_joined`
//
// Root cause: breakout child rooms are named `session-<sessionId>-bk-<breakoutId>`.
// The webhook's roomToSessionId() used to strip only the `session-` prefix,
// yielding the bogus id `<sessionId>-bk-<breakoutId>` which has no TeachingSession
// row → the participant upsert failed the sessionId FK on every breakout join.
//
// This script drives the REAL handler (handleRoomLifecycleEvent) against the
// REAL database — the only thing bypassed is the HTTP signature check, which is
// POST()'s concern and unrelated to this bug. Fixtures are throwaway and removed
// at the end (cascade delete).
//
// Run: npx tsx --env-file=.env.local scripts/verify-livekit-webhook-fk.ts
import { db } from '../src/lib/db';
import {
  roomToSessionId,
  handleRoomLifecycleEvent,
} from '../src/app/api/classroom/webhooks/livekit/route';

const MARKER = 'fkverify';
let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`, extra !== undefined ? extra : '');
  }
}

// Build a minimal participant_joined / participant_left event. Cast to the
// handler's event type — the handler only reads .event / .room / .participant.
function ev(eventType: string, roomName: string, identity?: string) {
  return {
    event: eventType,
    room: { name: roomName, sid: 'RM_test' },
    participant: identity ? { identity } : undefined,
  } as unknown as Parameters<typeof handleRoomLifecycleEvent>[0];
}

async function runHandler(label: string, event: ReturnType<typeof ev>): Promise<{ result?: string; threw?: unknown }> {
  try {
    const result = await handleRoomLifecycleEvent(event);
    return { result };
  } catch (threw) {
    const e = threw as { code?: string; meta?: { constraint?: string }; message?: string };
    console.log(`     (handler threw on ${label}: ${e?.code ?? ''} ${e?.meta?.constraint ?? e?.message ?? String(threw)})`);
    return { threw };
  }
}

async function main() {
  console.log('━━━ Part 1: roomToSessionId() parser (unit) ━━━');
  check('normal session room → sessionId', roomToSessionId('session-abc123') === 'abc123');
  check('breakout child room → null', roomToSessionId('session-abc123-bk-xyz789') === null,
    roomToSessionId('session-abc123-bk-xyz789'));
  check('non-session room → null', roomToSessionId('lobby-123') === null);
  check('undefined → null', roomToSessionId(undefined) === null);
  check('bare "session-" prefix only → empty (not a breakout)', roomToSessionId('session-') === '');

  console.log('\n━━━ Setup: throwaway fixtures (reusing an existing user + program) ━━━');
  const joiner = await db.user.findFirst({ select: { id: true, role: true } });
  const program = await db.program.findFirst({ select: { id: true } });
  if (!joiner || !program) throw new Error('Need at least one existing user + program to build fixtures');

  // Window in the PAST so maybeFlipToLive() short-circuits (OUT_OF_WINDOW) and
  // produces no side effects on our throwaway session.
  const start = new Date(Date.now() - 2 * 24 * 3600_000);
  const end = new Date(start.getTime() + 3600_000);
  const sess = await db.teachingSession.create({
    data: {
      title: `${MARKER}-throwaway-session`,
      sessionType: 'LECTURE',
      hostId: joiner.id,
      proposedBy: joiner.id,
      status: 'SCHEDULED',
      scheduledStart: start,
      scheduledEnd: end,
      programId: program.id,
    },
    select: { id: true, status: true },
  });
  console.log(`  created session ${sess.id}, joiner ${joiner.id}`);

  const where = { sessionId_userId: { sessionId: sess.id, userId: joiner.id } };
  const breakoutRoom = `session-${sess.id}-bk-cfakebreakoutid0000000000`;
  const normalRoom = `session-${sess.id}`;

  try {
    console.log('\n━━━ Part 2: breakout participant_joined must NOT FK-error (the bug) ━━━');
    const b = await runHandler('breakout join', ev('participant_joined', breakoutRoom, joiner.id));
    check('breakout join did not throw', !b.threw);
    check('breakout join returned no-op', b.result === 'no-op', b.result);
    const breakoutRow = await db.sessionParticipant.findUnique({ where });
    check('no SessionParticipant row written for breakout join', breakoutRow === null);

    console.log('\n━━━ Part 3: normal participant_joined still works (no regression) ━━━');
    const n = await runHandler('normal join', ev('participant_joined', normalRoom, joiner.id));
    check('normal join did not throw', !n.threw);
    check('normal join returned ok', n.result === 'ok', n.result);
    const joinedRow = await db.sessionParticipant.findUnique({ where });
    check('SessionParticipant row created on normal join', !!joinedRow);
    check('joinedAt set, leftAt null', !!joinedRow?.joinedAt && joinedRow?.leftAt === null);

    console.log('\n━━━ Part 4: re-join clears a prior leftAt (idempotent upsert) ━━━');
    await db.sessionParticipant.update({ where, data: { leftAt: new Date() } });
    await runHandler('re-join', ev('participant_joined', normalRoom, joiner.id));
    const rejoined = await db.sessionParticipant.findUnique({ where });
    check('re-join cleared leftAt', rejoined?.leftAt === null);

    console.log('\n━━━ Part 5: participant_left stamps leftAt ━━━');
    await runHandler('leave', ev('participant_left', normalRoom, joiner.id));
    const left = await db.sessionParticipant.findUnique({ where });
    check('participant_left set leftAt', !!left?.leftAt);

    console.log('\n━━━ Part 6: defensive guard — unknown/hard-deleted session no-ops, no FK error ━━━');
    const unknownRoom = 'session-cunknownsession000000000000';
    const d = await runHandler('unknown session join', ev('participant_joined', unknownRoom, joiner.id));
    check('unknown session did not throw (no P2003)', !d.threw);
    check('unknown session returned ok (dispatched, guarded inside)', d.result === 'ok', d.result);
    const ghost = await db.sessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId: 'cunknownsession000000000000', userId: joiner.id } },
    });
    check('no row written for unknown session', ghost === null);
  } finally {
    console.log('\n━━━ Cleanup ━━━');
    await db.teachingSession.delete({ where: { id: sess.id } }); // cascade removes participants
    console.log(`  deleted throwaway session ${sess.id}`);
    await db.$disconnect();
  }

  console.log(`\n━━━ RESULT: ${pass} passed, ${fail} failed ━━━`);
  if (fail > 0) process.exit(1);
  console.log('All checks passed — FK regression is fixed and no behavior regressed. ✅');
  // Exit explicitly: importing the route pulls in the BullMQ queue module,
  // whose ioredis client keeps retrying and holds the event loop open.
  process.exit(0);
}

main().catch(async (e) => { console.error('FATAL', e); await db.$disconnect(); process.exit(1); });
