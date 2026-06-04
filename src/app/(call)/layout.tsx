// ════════════════════════════════════════════════════════════════════════════
// (call) route group layout
// ════════════════════════════════════════════════════════════════════════════
// Public, auth-optional layout used for the in-call screen at /classroom/[id].
// Unlike (platform) — which redirects unauthenticated visitors to /login — we
// keep this surface reachable for anonymous guests joining an openToAll
// session via shared link (Teams "anyone with the link" parity).
// The page itself decides whether to:
//   - render the authed live-session UI (existing flow), or
//   - render the guest prejoin / lobby (new flow), or
//   - redirect to /login when the session is not openToAll.
// No platform shell, no nav chrome — calls are fullscreen.

export default function CallLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
