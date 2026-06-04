import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

// Client snapshot reads the live media query; server snapshot is `false`
// (no viewport) so SSR markup is deterministic and hydration-safe.
function getSnapshot() {
  return window.matchMedia(QUERY).matches
}

function getServerSnapshot() {
  return false
}

// Subscribes to the viewport via the browser's matchMedia store using
// useSyncExternalStore — React's recommended pattern for external stores.
// Avoids the setState-in-effect anti-pattern (and the extra render it causes).
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
