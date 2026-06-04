'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { toggleBookmark } from '@/server/services/engagement-service'
import { createShare } from '@/server/services/recordings/recording-share-service'

export async function toggleRecordingBookmarkAction(recordingId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('UNAUTHENTICATED')
  const result = await toggleBookmark({
    userId: session.user.id,
    targetType: 'RECORDING',
    targetId: recordingId,
  })
  revalidatePath('/classroom', 'layout')
  return result
}

export async function createRecordingShareAction(args: {
  recordingId: string
  ttlDays?: number
  password?: string
}) {
  const session = await auth()
  if (!session?.user?.id || !session.user.role) throw new Error('UNAUTHENTICATED')
  const share = await createShare(
    { userId: session.user.id, role: session.user.role },
    {
      recordingId: args.recordingId,
      ttlDays: args.ttlDays,
      password: args.password,
    }
  )
  return share
}
