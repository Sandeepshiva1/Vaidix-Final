import { db } from '../src/lib/db';
(async () => {
  const docs = await db.document.findMany({
    where: { route: 'PROMO_TEASER_VIDEO' },
    select: {
      id: true, title: true, status: true, sizeBytes: true,
      rejectionReason: true, createdAt: true, updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 6,
  });
  console.log('Recent PROMO_TEASER_VIDEO docs:');
  for (const d of docs) {
    console.log(
      '  ' + d.id +
      '\n    created=' + d.createdAt.toISOString() +
      '\n    updated=' + d.updatedAt.toISOString() +
      '\n    bytes=' + d.sizeBytes +
      '\n    status=' + d.status +
      '\n    rejectionReason=' + (d.rejectionReason ?? 'NULL')
    );
  }
  await db.$disconnect();
})();
