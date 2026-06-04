// Stamp rejectionReason on every PROMO_TEASER_VIDEO doc whose render failed
// (sizeBytes=0 + older than 30 sec) but never got the failure recorded.
// One-shot cleanup for the 3 docs created before the worker fix landed.

import { db } from '../src/lib/db';

(async () => {
  const cutoff = new Date(Date.now() - 30_000);
  const stuck = await db.document.findMany({
    where: {
      route: 'PROMO_TEASER_VIDEO',
      sizeBytes: BigInt(0),
      rejectionReason: null,
      createdAt: { lt: cutoff },
    },
    select: { id: true, title: true },
  });
  console.log(`Found ${stuck.length} stuck doc(s):`);
  for (const d of stuck) console.log('  ' + d.id + ' | ' + d.title);
  if (stuck.length === 0) {
    await db.$disconnect();
    return;
  }
  const reason =
    '[teaser] spawn ffmpeg ENOENT — FFmpeg is not installed on this machine. Install it (winget install Gyan.FFmpeg) and restart `npm run workers`, then retry.';
  const r = await db.document.updateMany({
    where: { id: { in: stuck.map((d) => d.id) } },
    data: { rejectionReason: reason },
  });
  console.log(`Stamped ${r.count} doc(s) with rejectionReason.`);
  await db.$disconnect();
})();
