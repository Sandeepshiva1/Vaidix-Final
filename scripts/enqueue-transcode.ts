import { getQueue, QUEUES } from '../src/lib/queue'

async function main() {
  const recordingId = process.argv[2]
  if (!recordingId) {
    console.error('usage: tsx scripts/enqueue-transcode.ts <recordingId>')
    process.exit(1)
  }
  const q = getQueue(QUEUES.RECORDING)
  const job = await q.add('transcode', { recordingId }, { jobId: `manual-${Date.now()}` })
  console.log(`queued job=${job.id} for recording=${recordingId}`)
  await q.close()
  process.exit(0)
}
void main()
