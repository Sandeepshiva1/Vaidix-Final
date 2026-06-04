import { db } from '../src/lib/db';
(async () => {
  const r = await db.document.update({
    where: { id: 'cmopad7h00085krnw6sgd2yoh' },
    data: {
      rejectionReason:
        '[teaser] spawn ffmpeg ENOENT — FFmpeg is not installed on this machine. Install it (winget install Gyan.FFmpeg) and retry.',
    },
    select: { id: true, rejectionReason: true },
  });
  console.log('Stamped:', r);
  await db.$disconnect();
})();
