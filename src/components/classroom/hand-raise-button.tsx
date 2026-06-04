'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Hand } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Hand raise is expressed via the local participant's metadata:
 *   { handRaised: boolean, at: number }
 * ParticipantSidebar reads this and pins raised hands to the top.
 * Metadata updates are broadcast to all participants by LiveKit for free.
 */
export function HandRaiseButton() {
  const { localParticipant } = useLocalParticipant()
  const [raised, setRaised] = useState(false)

  // Sync local state with the participant's current metadata (in case of
  // reconnect or external update via updateParticipantMetadata server call)
  useEffect(() => {
    if (!localParticipant.metadata) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs hand-raised state from the participant's LiveKit metadata (external source: reconnect/remote update)
      setRaised(false)
      return
    }
    try {
      const parsed = JSON.parse(localParticipant.metadata)
      setRaised(parsed?.handRaised === true)
    } catch {
      setRaised(false)
    }
  }, [localParticipant.metadata])

  const toggle = useCallback(async () => {
    const next = !raised
    const metadata = next ? JSON.stringify({ handRaised: true, at: Date.now() }) : '{}'
    await localParticipant.setMetadata(metadata)
    setRaised(next)
  }, [raised, localParticipant])

  return (
    <Button
      variant={raised ? 'default' : 'outline'}
      size="sm"
      onClick={toggle}
      className={cn(raised && 'animate-pulse')}
      title={raised ? 'Lower hand' : 'Raise hand'}
      aria-pressed={raised}
    >
      <Hand className="size-4 mr-1.5" />
      {raised ? 'Lower' : 'Raise hand'}
    </Button>
  )
}
