import { useEffect, useState } from 'react'

// useDeviceProfile — enterprise-grade device/viewport classification for the
// live-call UI. The live room renders very different chrome on phones vs.
// desktops (Zoom/Meet/Teams-style), so we need a detection that is correct
// across the full matrix of real-world join scenarios, not just a width check:
//
//   1. Phone, portrait                 → narrow viewport            → mobile
//   2. Phone, landscape                → WIDE viewport but short    → mobile
//      (e.g. iPhone 15 landscape is 852×393 — width alone says "desktop")
//   3. Tablet (iPad / Android tablet)  → touch + medium viewport    → mobile UI
//   4. Desktop browser, narrow window  → narrow viewport, no touch  → mobile UI
//      (responsive — the same compact layout is the right call here)
//   5. Desktop, normal window          → wide + fine pointer        → desktop
//   6. 2-in-1 / touch laptop           → wide + touch but fine ptr  → desktop
//      (driven by width so a maximised touch laptop still gets desktop chrome)
//   7. iPadOS 13+ Safari               → reports as "Macintosh"     → handled
//      via the maxTouchPoints heuristic below
//
// SSR note: the server has no viewport, so the first paint is always computed
// as desktop (isMobile=false) and the client re-classifies on mount. `ready`
// lets callers avoid acting on the placeholder value before hydration if they
// need to (the layout itself just re-renders, which is fine).

const PHONE_MAX_WIDTH = 768 // Tailwind `md` — below this we use compact chrome
const LANDSCAPE_PHONE_MAX_HEIGHT = 540 // a wide-but-short window is a phone on its side

export interface DeviceProfile {
  /** Use the compact, touch-first call layout. */
  isMobile: boolean
  /** Primary input is a coarse pointer (finger/stylus) rather than a mouse. */
  isTouch: boolean
  /** Viewport is wider than it is tall. */
  isLandscape: boolean
  /** True once the client has run detection at least once (post-hydration). */
  ready: boolean
}

const DESKTOP_DEFAULT: DeviceProfile = {
  isMobile: false,
  isTouch: false,
  isLandscape: true,
  ready: false,
}

function detect(): DeviceProfile {
  if (typeof window === 'undefined') return DESKTOP_DEFAULT

  const w = window.innerWidth
  const h = window.innerHeight
  const isLandscape = w >= h

  const coarse =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  // iPadOS 13+ masquerades as desktop Safari ("Macintosh"); the only reliable
  // tell is that a real Mac reports 0 touch points while an iPad reports >1.
  const touchPoints = navigator.maxTouchPoints ?? 0
  const isTouch = coarse || touchPoints > 1

  const ua = navigator.userAgent || ''
  const mobileUA = /Android|iPhone|iPod|iPad|Mobile|Windows Phone|BlackBerry|webOS|Opera Mini|IEMobile/i.test(ua)
  const iPadOS = /Macintosh/.test(ua) && touchPoints > 1

  const narrow = w < PHONE_MAX_WIDTH
  // A real handheld held sideways: short viewport + touch + a phone user-agent.
  // Guard with `mobileUA` so a genuinely small desktop window (tall, no touch)
  // doesn't get misclassified as a landscape phone.
  const landscapePhone =
    isLandscape && h <= LANDSCAPE_PHONE_MAX_HEIGHT && isTouch && (mobileUA || iPadOS)

  // Tablets are touch devices with a mid-size viewport — we want the compact,
  // touch-first call chrome there too (taps, bottom sheets), matching how
  // Zoom/Teams render on an iPad.
  const tablet = (mobileUA || iPadOS) && isTouch && w < 1024

  const isMobile = narrow || landscapePhone || tablet

  return { isMobile, isTouch, isLandscape, ready: true }
}

export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(DESKTOP_DEFAULT)

  useEffect(() => {
    const update = () => setProfile(detect())
    update()

    // Re-classify on anything that can change the answer. orientationchange is
    // kept alongside resize because some mobile browsers fire it before the
    // viewport metrics settle, and a couple of older Androids don't fire resize
    // on rotation at all.
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    const mqlCoarse = window.matchMedia('(pointer: coarse)')
    const mqlOrient = window.matchMedia('(orientation: landscape)')
    mqlCoarse.addEventListener('change', update)
    mqlOrient.addEventListener('change', update)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      mqlCoarse.removeEventListener('change', update)
      mqlOrient.removeEventListener('change', update)
    }
  }, [])

  return profile
}
