'use client'

import { useEffect, useRef } from 'react'

// A setInterval that only ticks while the browser tab is visible — the same
// pattern Google Meet / Zoom / Teams use so a backgrounded call stops burning
// CPU (and network). When the tab is hidden the interval is cleared; when it
// becomes visible again the callback fires once immediately (to catch up on
// anything missed) and the interval resumes.
//
// This is the single biggest lever against the "Chrome pegs the CPU / laptop
// gets hot" report: a live session mounts a dozen pollers (engagement,
// leaderboard, hooks, captions, breakouts, …) that previously all kept firing
// even when the user tabbed away. Routing them through here makes the whole
// app go quiet the moment it loses focus.
//
// Pass `enabled = false` to disable entirely (e.g. a panel that isn't open).
export function useVisibleInterval(callback: () => void, ms: number, enabled = true) {
  const cbRef = useRef(callback)
  useEffect(() => { cbRef.current = callback }, [callback])

  useEffect(() => {
    if (!enabled) return
    let id: ReturnType<typeof setInterval> | null = null
    const tick = () => cbRef.current()
    const start = () => {
      if (id != null) return
      tick()
      id = setInterval(tick, ms)
    }
    const stop = () => {
      if (id != null) { clearInterval(id); id = null }
    }
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.hidden) stop()
      else start()
    }
    if (typeof document === 'undefined' || !document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms, enabled])
}
