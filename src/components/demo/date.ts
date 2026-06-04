// Deterministic date formatting for the demo prototype.
//
// The demo client pages are server-rendered then hydrated. Formatting a date
// with `toLocaleDateString(undefined, …)` uses the *runtime's* default locale
// and timezone, which differ between the SSR server (Node) and the browser —
// producing different text and a React hydration mismatch. Pinning the locale
// to 'en-US' and the timeZone to 'UTC' (and parsing the date-only ISO string as
// UTC) makes the output identical on both sides.
export function formatDemoDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
  } catch {
    return iso
  }
}
