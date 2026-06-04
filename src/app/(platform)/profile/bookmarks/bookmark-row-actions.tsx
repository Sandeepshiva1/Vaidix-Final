'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { toggleBookmarkAction } from '../../pearls/actions'
import type { BookmarkTargetType } from '@/server/services/engagement-service'

interface Props {
  targetType: BookmarkTargetType
  targetId: string
}

export function BookmarkRowActions({ targetType, targetId }: Props) {
  const router = useRouter()
  const [removed, setRemoved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleRemove() {
    setRemoved(true)
    startTransition(async () => {
      try {
        await toggleBookmarkAction(targetType, targetId)
        router.refresh()
      } catch {
        setRemoved(false)
      }
    })
  }

  if (removed) return null

  return (
    <button
      onClick={handleRemove}
      disabled={isPending}
      aria-label="Remove bookmark"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600"
    >
      {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  )
}
