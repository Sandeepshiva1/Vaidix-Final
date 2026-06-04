import { db } from '../src/lib/db';
import IORedis from 'ioredis';
(async () => {
  const docs = await db.document.findMany({
    where: { route: 'PROMO_TEASER_VIDEO' },
    select: { id: true, title: true, status: true, createdAt: true, s3Key: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('PROMO_TEASER_VIDEO docs:');
  for (const d of docs) console.log('  ' + d.id + ' | ' + d.status + ' | ' + d.createdAt.toISOString() + ' | ' + d.title);

  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const r = new IORedis(url, { maxRetriesPerRequest: 1 });
  try {
    const Q = 'bull:promo-pipeline';
    const keys = await r.keys(Q + '*');
    console.log('\n' + Q + '* keys (' + keys.length + '):');
    for (const k of keys.slice(0, 30)) console.log('  ' + k);
    const wait = await r.llen(Q + ':wait').catch(() => 0);
    const active = await r.llen(Q + ':active').catch(() => 0);
    const delayed = await r.zcard(Q + ':delayed').catch(() => 0);
    const failed = await r.zcard(Q + ':failed').catch(() => 0);
    const completed = await r.zcard(Q + ':completed').catch(() => 0);
    console.log('\nstats — wait=' + wait + ' active=' + active + ' delayed=' + delayed + ' completed=' + completed + ' failed=' + failed);

    // Inspect every job hash (the named keys ending with the documentId)
    const jobKeys = keys.filter((k) => k.includes('promo-teaser-render-'));
    console.log('\njob hashes (' + jobKeys.length + ' found):');
    for (const k of jobKeys) {
      const data = await r.hgetall(k);
      console.log('  ' + k);
      console.log('    name=' + data.name + ' attemptsMade=' + data.attemptsMade + ' processedOn=' + data.processedOn + ' finishedOn=' + data.finishedOn);
      if (data.failedReason) console.log('    failedReason=' + data.failedReason);
      if (data.stacktrace) console.log('    stack=' + data.stacktrace.substring(0, 500));
    }

    if (failed > 0) {
      const failedIds = await r.zrange(Q + ':failed', 0, 4);
      console.log('\nfailed-set ids: ' + JSON.stringify(failedIds));
    }
    if (wait > 0 || active > 0) {
      const waitIds = await r.lrange(Q + ':wait', 0, 4);
      const activeIds = await r.lrange(Q + ':active', 0, 4);
      console.log('\npending job ids: wait=', waitIds, 'active=', activeIds);
    }
  } catch (e) { console.error('Redis err:', (e as Error).message); }
  await r.quit();
  await db.$disconnect();
})();
