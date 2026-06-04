// Read the `vaidix-csrf` cookie that NextAuth middleware refreshes on every
// request and return it as the `x-csrf-token` header (security hardening).
// Server-side `requireCsrf` constant-time compares cookie vs header.

export function csrfHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/);
  return m ? { 'x-csrf-token': decodeURIComponent(m[1]) } : {};
}

// Async variant: bootstraps the cookie via GET /api/csrf if it isn't there
// yet. Use this before mutations triggered from components whose page never
// hits a CSRF-protected endpoint first (e.g. the notification bell — the
// user can land on any page and click "Mark all read" as their first action).
export async function ensureCsrfHeaders(): Promise<Record<string, string>> {
  if (typeof document === 'undefined') return {};
  let m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/);
  if (!m) {
    await fetch('/api/csrf', { credentials: 'include', cache: 'no-store' });
    m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/);
  }
  return m ? { 'x-csrf-token': decodeURIComponent(m[1]) } : {};
}
