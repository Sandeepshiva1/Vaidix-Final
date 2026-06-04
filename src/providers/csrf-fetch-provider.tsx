'use client';

import { useEffect } from 'react';

// Installs a one-time window.fetch wrapper that attaches the `x-csrf-token`
// header (read from the non-httpOnly `vaidix-csrf` cookie) to every same-origin
// mutating request. This is the client half of the central CSRF double-submit
// control enforced in the proxy middleware — it means individual components no
// longer have to remember to call csrfHeaders() on each mutation.
//
// Safe-by-construction:
//   - only same-origin, mutating (POST/PUT/PATCH/DELETE) requests are touched;
//   - an explicit caller-supplied x-csrf-token is never overwritten;
//   - cross-origin requests (e.g. S3 presigned PUTs) are passed through as-is.

const CSRF_COOKIE = 'vaidix-csrf';
const CSRF_HEADER = 'x-csrf-token';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const INSTALLED = Symbol.for('vaidix.csrfFetchInstalled');
const COOKIE_RE = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`);

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(COOKIE_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const url =
      typeof input === 'string'
        ? new URL(input, window.location.href)
        : input instanceof URL
          ? input
          : new URL((input as Request).url, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    // Relative strings that fail URL parsing are same-origin by definition.
    return true;
  }
}

export function CsrfFetchProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const w = window as unknown as Record<symbol, boolean> & { fetch: typeof fetch };
    if (w[INSTALLED]) return;
    w[INSTALLED] = true;

    const original = window.fetch.bind(window);

    // Best-effort: make sure the cookie exists before the first mutation fires.
    if (!readCsrfCookie()) {
      original('/api/csrf', { credentials: 'include', cache: 'no-store' }).catch(() => {});
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

      if (!MUTATING.has(method) || !isSameOrigin(input)) {
        return original(input, init);
      }

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has(CSRF_HEADER)) {
        let token = readCsrfCookie();
        if (!token) {
          await original('/api/csrf', { credentials: 'include', cache: 'no-store' }).catch(() => {});
          token = readCsrfCookie();
        }
        if (token) headers.set(CSRF_HEADER, token);
      }

      return original(input, { ...init, headers });
    };

    return () => {
      window.fetch = original;
      w[INSTALLED] = false;
    };
  }, []);

  return <>{children}</>;
}
