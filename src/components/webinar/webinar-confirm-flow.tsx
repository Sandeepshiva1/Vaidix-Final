'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'

type State = 'loading' | 'success' | 'already' | 'invalid' | 'error'

export function ConfirmFlow({ sessionId, token }: { sessionId: string; token: string }) {
  // Initial state is derived from the token directly so we don't synchronously
  // setState inside the effect — the lint rule wants effects to subscribe to
  // external state, not flip local state on first render.
  const [state, setState] = useState<State>(token ? 'loading' : 'invalid')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetch(
      `/api/classroom/sessions/${sessionId}/webinar-registrations/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }
    )
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.ok) {
          setState(json.data.alreadyConfirmed ? 'already' : 'success')
          return
        }
        if (json.error?.code === 'NOT_FOUND') {
          setState('invalid')
          return
        }
        setErrorMsg(json.error?.message ?? 'Could not confirm registration')
        setState('error')
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMsg((err as Error).message)
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, token])

  if (state === 'loading') {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Confirming registration…</p>
      </div>
    )
  }

  if (state === 'success' || state === 'already') {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center" data-testid="webinar-confirm-success">
        <CheckCircle2 className="mx-auto size-10 text-teal-500" />
        <h1 className="mt-3 text-lg font-bold">
          {state === 'already' ? 'Already confirmed' : 'You are registered'}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We&apos;ll email your join link before the webinar starts.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border bg-card p-8 text-center" data-testid="webinar-confirm-error">
      <AlertTriangle className="mx-auto size-10 text-amber-500" />
      <h1 className="mt-3 text-lg font-bold">
        {state === 'invalid' ? 'Invalid or expired link' : 'Confirmation failed'}
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {state === 'invalid'
          ? 'Try registering again from the webinar page.'
          : (errorMsg ?? 'Please try again later.')}
      </p>
    </div>
  )
}
