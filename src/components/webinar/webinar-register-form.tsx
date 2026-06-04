'use client'

// Webinar registration form — public-facing, no auth.
// Submits to /api/classroom/sessions/[id]/webinar-registrations.

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function WebinarRegisterForm({ sessionId }: { sessionId: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [organisation, setOrganisation] = useState('')
  const [roleTitle, setRoleTitle] = useState('')
  const [consented, setConsented] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!consented) {
      setError('Please confirm you accept the privacy & recording terms')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/classroom/sessions/${sessionId}/webinar-registrations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            organisation: organisation.trim() || undefined,
            roleTitle: roleTitle.trim() || undefined,
            consented: true,
          }),
        }
      )
      const json = await res.json()
      if (!json.ok) {
        setError(json.error?.message ?? 'Could not register')
        return
      }
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border bg-card p-8 text-center"
      >
        <MailCheck className="mx-auto size-10 text-teal-500" />
        <h2 className="mt-3 text-lg font-bold">Check your email</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We&apos;ve sent a confirmation link to <strong>{email}</strong>. Click it to finish
          registering. Your join link arrives separately on the day of the webinar.
        </p>
      </motion.div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
      data-testid="webinar-register-form"
    >
      <Field label="Full name" required>
        <Input
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={120}
        />
      </Field>
      <Field label="Email" required>
        <Input
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          maxLength={254}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Organisation">
          <Input
            name="organisation"
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field label="Role / title">
          <Input
            name="roleTitle"
            value={roleTitle}
            onChange={(e) => setRoleTitle(e.target.value)}
            maxLength={120}
          />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          I agree to the privacy policy and acknowledge that this session may be recorded.
        </span>
      </label>
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={submitting || !consented || !name.trim() || !email.trim()}
        className="w-full"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Registering…
          </>
        ) : (
          'Register'
        )}
      </Button>
    </form>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
