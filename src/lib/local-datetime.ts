// ────────────────────────────────────────────────────────────────────────────
// Local-timezone date/time formatting for a stored UTC instant.
//
// Sessions are stored as UTC instants (`scheduledStart`). They MUST be rendered
// in the *viewer's* timezone, not the server's — otherwise a 4:00 PM IST class
// shows as 10:30 AM on a UTC-hosted server (the −5:30 offset).
//
// These helpers read the runtime timezone via `toLocale*String`, so they only
// produce the viewer's zone when called in the BROWSER. On the server they fall
// back to the host zone. Therefore call them from client components, gated
// behind a mounted check (see `useMounted`), so the first paint matches the
// server HTML (no hydration mismatch) and the value corrects to the user's zone
// right after hydration.
//
// `isoToLocalInput` is the inverse used by date pickers: a UTC instant → the
// naive `YYYY-MM-DDTHH:mm` wall-clock string the picker edits. It must run in
// the browser so the round-trip (picker string → `new Date(s).toISOString()`)
// stays in one consistent timezone.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'

export function formatLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const pad = (n: number) => String(n).padStart(2, '0')

export function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// True once the component has mounted on the client. Use to gate browser-only,
// timezone-dependent rendering so SSR/first-paint stays deterministic.
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])
  return mounted
}
