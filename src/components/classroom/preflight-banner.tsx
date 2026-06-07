'use client'

// Pre-flight banner — surfaces inside the live room when the session is in
// pre-flight mode (host opened the room outside the scheduled window). The
// room is fully functional but the LIVE pill, recording, and live captions
// are gated until the scheduled window opens (see
// `lib/sessions/scheduled-window.ts`). Mirrors the pre-join screen banner.
//
// Self-contained "Start session now" affordance for the host: posts to
// /reschedule with start=now and reloads. We duplicate the logic from
// pre-join.tsx rather than extract a hook because this banner mounts inside
// LiveKitRoom whose lifecycle is independent of the pre-join screen — a
// shared hook would have to manage two reload paths.

import { useEffect, useState } from 'react'
import { TestTube2, Play, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'

const EARLY_GRACE_MS = 5 * 60 * 1000
const LATE_GRACE_MS = 15 * 60 * 1000

export function PreflightBanner({
  sessionId,
  scheduledStart,
  scheduledEnd,
  isHost,
}: {
  sessionId: string
  scheduledStart: string
  scheduledEnd: string
  isHost: boolean
}) {
  const [dismissed, setDismissed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [startingNow, setStartingNow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const start = new Date(scheduledStart).getTime()
  const end = new Date(scheduledEnd).getTime()
  const inWindow = now >= start - EARLY_GRACE_MS && now <= end + LATE_GRACE_MS
  // If the window has now opened, the next webhook (participant_joined) will
  // flip status to LIVE; the page will re-render with status=LIVE and this
  // banner will unmount. Until then, hide the banner so it doesn't lie.
  const visible = !inWindow && !dismissed
  const past = now > end + LATE_GRACE_MS

  async function handleStartNow() {
    if (startingNow) return
    setStartingNow(true)
    setError(null)
    try {
      const durationMs = end - start
      const newStart = new Date()
      const newEnd = new Date(newStart.getTime() + durationMs)
      const res = await fetch(`/api/classroom/sessions/${sessionId}/reschedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scheduledStart: newStart.toISOString(),
          scheduledEnd: newEnd.toISOString(),
          reason: 'Started ahead of schedule from in-room banner',
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(body.error?.message ?? 'Failed to reschedule')
      }
      window.location.reload()
    } catch (e) {
      setError((e as Error).message)
      setStartingNow(false)
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -16, opacity: 0 }}
          className="pointer-events-none fixed inset-x-0 top-14 md:top-2 z-40 flex justify-center px-2 md:px-4"
          data-testid="liveroom-preflight-banner"
        >
          <div className="pointer-events-auto flex max-w-3xl items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-2 shadow-lg backdrop-blur md:items-start md:gap-3 md:px-4 md:py-2.5 dark:border-amber-900/50 dark:bg-amber-950/90">
            <TestTube2 className="size-4 shrink-0 text-amber-700 md:mt-0.5 dark:text-amber-400" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-semibold text-amber-900 md:whitespace-normal dark:text-amber-200">
                {past ? 'Outside scheduled window' : 'Pre-flight test mode'}
              </p>
              {/* Verbose detail is desktop-only — on a phone the title + action
                  convey enough without dominating the screen. */}
              <p className="mt-0.5 hidden text-amber-800 md:block dark:text-amber-300">
                {past
                  ? 'Recording, live captions, and attendance won’t be captured. The scheduled time has passed — reschedule to capture this session.'
                  : 'Recording, live captions, and the LIVE indicator activate at the scheduled start. A/V test freely; participation isn’t recorded yet.'}
              </p>
              {error && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>}
            </div>
            {isHost && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStartNow}
                disabled={startingNow}
                className="shrink-0 gap-1.5 border-amber-400 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
                data-testid="liveroom-preflight-start-now"
              >
                <Play className="size-3.5" />
                {startingNow
                  ? 'Rescheduling…'
                  : <><span className="md:hidden">Start now</span><span className="hidden md:inline">Start session now</span></>}
              </Button>
            )}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss pre-flight banner"
              className="rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
            >
              <X className="size-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
