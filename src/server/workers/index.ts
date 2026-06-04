// ════════════════════════════════════════════════════════════════════════════
// Worker entrypoint — run separately from Next.js
// ════════════════════════════════════════════════════════════════════════════
// Usage: npm run workers
// Each worker owns a BullMQ queue. Adding a new worker: import + register here.

import { startReminderWorker } from './reminder-worker';
import { startTranscodeWorker } from './transcode-worker';
import { startTranscribeWorker } from './transcribe-worker';
import { startWhatsappWorker } from './whatsapp-worker';
import { startReelRenderWorker } from './reel-render-worker';
import { startPreQuestionClusterWorker } from './pre-question-cluster-worker';
import { startPhiScanWorker } from './phi-scan-worker';
import { startPromoTeaserWorker } from './promo-teaser-worker';
// security hardening sprint
import { startAuditWorker } from './audit-worker';                  // item #14
import { startRetentionWorker } from './retention-worker';          // item #16
import { startDsrExportWorker } from './dsr-export-worker';         // item #17
import { startErasureWorker } from './erasure-worker';              // item #17
import { startDlqWatchers } from './dlq-watcher';                    // item #8
import { startAiHookGeneratorWorker } from './ai-hook-generator-worker';
import { startPostSessionPackWorker } from './post-session-pack-worker';
import { log } from '@/lib/log';

const workers = [
  startReminderWorker(),
  startTranscodeWorker(),
  startTranscribeWorker(),
  startWhatsappWorker(),
  startReelRenderWorker(),
  startPreQuestionClusterWorker(),
  startPhiScanWorker(),
  startPromoTeaserWorker(),
  startAuditWorker(),
  startRetentionWorker(),
  startDsrExportWorker(),
  startErasureWorker(),
  startAiHookGeneratorWorker(),
  startPostSessionPackWorker(),
];

const dlqWatchers = startDlqWatchers();

log.info(
  { workers: workers.map((w) => w.name), dlqWatchers: dlqWatchers.length },
  '[workers] started'
);

async function shutdown(signal: string) {
  log.info({ signal, workers: workers.length, dlqWatchers: dlqWatchers.length }, '[workers] shutting down');
  await Promise.all([
    ...workers.map((w) => w.close()),
    ...dlqWatchers.map((d) => d.close()),
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
