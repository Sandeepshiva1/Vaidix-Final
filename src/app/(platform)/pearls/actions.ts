'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import {
  togglePearlLike,
  toggleBookmark,
  type BookmarkTargetType,
} from '@/server/services/engagement-service'

export async function togglePearlLikeAction(pearlId: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('UNAUTHENTICATED')
  const result = await togglePearlLike({ pearlId, userId: session.user.id })
  revalidatePath('/pearls')
  return result
}

export async function toggleBookmarkAction(
  targetType: BookmarkTargetType,
  targetId: string
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('UNAUTHENTICATED')
  const result = await toggleBookmark({
    userId: session.user.id,
    targetType,
    targetId,
  })
  // Revalidate the page for the target type so counts/state stay correct.
  if (targetType === 'PEARL') revalidatePath('/pearls')
  if (targetType === 'RECORDING') revalidatePath('/classroom', 'layout')
  return result
}
