// ════════════════════════════════════════════════════════════════════════════
// /recordings/share/[token] — public share-link viewer
// ════════════════════════════════════════════════════════════════════════════
// Unauthenticated, intentionally outside the (platform) layout. Renders a
// minimal player or password gate, calling the public resolver
// /api/recordings/share/[token].
//
// All access (success + failure) is logged server-side; this page never
// reveals whether a token exists vs has the wrong password vs is expired —
// the resolver returns specific codes which we surface as friendly text.

'use client'

import { use, useEffect, useState } from 'react'
import { Lock, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RecordingPlayer } from '@/components/recording/recording-player'

interface AccessResult {
  recordingId: string
  hlsUrl: string | null
  thumbnailUrl: string | null
  durationSec: number | null
  expiresAt: string
}

type PageState =
  | { kind: 'LOADING' }
  | { kind: 'NEEDS_PASSWORD'; lastError?: string }
  | { kind: 'OK'; data: AccessResult }
  | { kind: 'ERROR'; code: string; message: string }

export default function RecordingSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const [state, setState] = useState<PageState>({ kind: 'LOADING' })
  const [password, setPassword] = useState('')

  // Initial GET — resolver returns 401 PASSWORD_REQUIRED when a password is set.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/recordings/share/${token}`)
      const json = await res.json()
      if (cancelled) return
      if (json.ok) {
        setState({ kind: 'OK', data: json.data })
      } else if (json.error?.code === 'PASSWORD_REQUIRED') {
        setState({ kind: 'NEEDS_PASSWORD' })
      } else {
        setState({ kind: 'ERROR', code: json.error?.code ?? 'UNKNOWN', message: json.error?.message ?? 'Unknown error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const submitPassword = async () => {
    setState({ kind: 'LOADING' })
    const res = await fetch(`/api/recordings/share/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    const json = await res.json()
    if (json.ok) {
      setState({ kind: 'OK', data: json.data })
    } else if (json.error?.code === 'WRONG_PASSWORD') {
      setState({ kind: 'NEEDS_PASSWORD', lastError: 'Wrong password — try again.' })
    } else if (json.error?.code === 'PASSWORD_REQUIRED') {
      setState({ kind: 'NEEDS_PASSWORD', lastError: 'Password is required.' })
    } else {
      setState({ kind: 'ERROR', code: json.error?.code ?? 'UNKNOWN', message: json.error?.message ?? 'Unknown error' })
    }
  }

  if (state.kind === 'LOADING') {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (state.kind === 'NEEDS_PASSWORD') {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-4 p-6">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Enter password</h1>
        <p className="text-center text-sm text-muted-foreground">
          This recording link is password-protected.
        </p>
        <form
          className="w-full space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submitPassword()
          }}
        >
          <Input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
          {state.lastError ? (
            <p className="text-xs text-destructive">{state.lastError}</p>
          ) : null}
          <Button type="submit" className="w-full" disabled={password.length === 0}>
            View recording
          </Button>
        </form>
      </div>
    )
  }

  if (state.kind === 'ERROR') {
    const friendly =
      state.code === 'EXPIRED'
        ? 'This share link has expired.'
        : state.code === 'REVOKED'
        ? 'This share link has been revoked.'
        : state.code === 'NOT_FOUND'
        ? 'This share link is invalid.'
        : state.message
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-4 p-6">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">Cannot open recording</h1>
        <p className="text-center text-sm text-muted-foreground">{friendly}</p>
      </div>
    )
  }

  // state.kind === 'OK'
  return (
    <div className="mx-auto max-w-5xl space-y-4 py-8">
      <h1 className="text-xl font-semibold">Shared recording</h1>
      <p className="text-xs text-muted-foreground">
        Link expires {new Date(state.data.expiresAt).toLocaleString()}.
      </p>
      {state.data.hlsUrl ? (
        <RecordingPlayer hlsUrl={state.data.hlsUrl} posterUrl={state.data.thumbnailUrl} activeLang="off" />
      ) : (
        <p className="rounded border bg-muted/50 p-4 text-sm text-muted-foreground">
          Recording is no longer available.
        </p>
      )}
    </div>
  )
}
