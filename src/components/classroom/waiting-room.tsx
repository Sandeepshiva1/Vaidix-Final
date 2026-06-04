'use client'

import { Hourglass } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function WaitingRoom({
  session,
  onCancel,
}: {
  session: { title: string; host: { name: string } }
  onCancel: () => void
}) {
  return (
    <div className="flex h-[80vh] items-center justify-center">
      <div className="rounded-xl border bg-card p-10 text-center max-w-md shadow-sm">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
          <Hourglass className="size-7 animate-pulse text-primary" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">You&apos;re in the waiting room</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium">{session.host.name}</span>
          {' '}or a co-host will admit you to{' '}
          <span className="font-medium">{session.title}</span>.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">Checking every few seconds…</p>
        <Button variant="outline" className="mt-6" onClick={onCancel}>
          Leave
        </Button>
      </div>
    </div>
  )
}
