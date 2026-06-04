// ════════════════════════════════════════════════════════════════════════════
// recover-local-recording.ts
// ════════════════════════════════════════════════════════════════════════════
// One-shot recovery for recordings whose egress wrote to local disk instead
// of uploading to MinIO (rawS3Key starts with /output/ or output/).
//
// Run AFTER Docker / MinIO is up:
//   npm run workers  (in another terminal — needed for the transcode job)
//   tsx --env-file=.env.local --env-file=.env scripts/recover-local-recording.ts

import { readFile } from 'fs/promises'
import { join } from 'path'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { s3, BUCKET } from '../src/lib/storage'
import { db } from '../src/lib/db'
import { getQueue, QUEUES } from '../src/lib/queue'
import { RecordingStatus } from '@prisma/client'
import { env } from '../src/lib/env'

const LOCAL_OUTPUT_ROOT = join(env.VAIDIX_DATA_ROOT, 'recordings', 'raw', 'recordings')

async function recover() {
  // Find all recordings stuck with a local-path rawS3Key
  const stuck = await db.recording.findMany({
    where: {
      status: RecordingStatus.TRANSCODING,
      rawS3Key: { startsWith: '/output/' },
    },
    select: { id: true, sessionId: true, rawS3Key: true },
  })

  // Also catch without leading slash (if pickEgressFile already stripped it)
  const stuck2 = await db.recording.findMany({
    where: {
      status: RecordingStatus.TRANSCODING,
      rawS3Key: { startsWith: 'output/' },
    },
    select: { id: true, sessionId: true, rawS3Key: true },
  })

  const all = [...stuck, ...stuck2]
  if (all.length === 0) {
    console.log('No stuck local-path recordings found.')
    process.exit(0)
  }

  console.log(`Found ${all.length} stuck recording(s):`)
  for (const r of all) console.log(`  ${r.id}  rawS3Key=${r.rawS3Key}`)

  const queue = getQueue(QUEUES.RECORDING)

  for (const rec of all) {
    // Derive the local filename from rawS3Key.
    // rawS3Key may be "/output/recordings/foo.mp4" or "output/recordings/foo.mp4".
    const withoutPrefix = rec.rawS3Key!.replace(/^\/?output\/recordings\//, '')
    const localPath = join(LOCAL_OUTPUT_ROOT, withoutPrefix)
    const correctS3Key = `recordings/${withoutPrefix}`

    console.log(`\nRecovering ${rec.id}`)
    console.log(`  local: ${localPath}`)
    console.log(`  → MinIO key: ${correctS3Key}`)

    let buf: Buffer
    try {
      buf = await readFile(localPath)
    } catch {
      console.error(`  ERROR: local file not found at ${localPath} — skipping`)
      continue
    }

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: correctS3Key,
      Body: buf,
      ContentType: 'video/mp4',
    }))
    console.log(`  uploaded ${buf.length} bytes to MinIO`)

    await db.recording.update({
      where: { id: rec.id },
      data: {
        rawS3Key: correctS3Key,
        status: RecordingStatus.TRANSCODING,
        pipelineStage: RecordingStatus.TRANSCODING,
        failureReason: null,
      },
    })

    const job = await queue.add(
      'transcode',
      { recordingId: rec.id },
      { jobId: `recover-transcode-${rec.id}-${Date.now()}` }
    )
    console.log(`  transcode job queued: ${job.id}`)
  }

  await queue.close()
  await db.$disconnect()
  console.log('\nDone. Watch the workers terminal for transcode progress.')
  process.exit(0)
}

void recover()
