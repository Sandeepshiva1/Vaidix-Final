'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AtSign, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { AuthShell, AuthInput, AuthSubmit } from '@/components/auth/auth-shell';
import { forgotPasswordSchema } from '@/lib/validation/auth';

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);

    const parsed = forgotPasswordSchema.safeParse({ identifier });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
      setFieldError(flat.identifier?.[0] ?? 'Invalid email or mobile number');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 429) {
        setFormError('Too many requests. Please wait and try again.');
      } else if (!res.ok) {
        setFormError('Something went wrong. Please try again.');
      } else {
        setSubmitted(true);
      }
    } catch {
      setFormError('Network error. Please check your connection.');
    }
    setLoading(false);
  }

  return (
    <AuthShell
      heroTitle={
        <>
          Forgot
          <br />
          your password?
        </>
      }
      heroSubtitle="It happens to the best of us."
      heroDescription="Enter your email below and we'll send you a link to set a new password. The link will be valid for 1 hour."
    >
      {submitted ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-green-200 bg-green-50 p-6"
        >
          <CheckCircle2 className="mb-3 size-10 text-green-600" />
          <h2 className="text-xl font-bold text-slate-900">Check your inbox</h2>
          <p className="mt-2 text-sm text-slate-600">
            If a Vaidix account is associated with <strong>{identifier}</strong>, a password reset
            link has been sent to the email on file. The link expires in 1 hour.
          </p>
          <p className="mt-4 text-xs text-slate-500">
            Didn&rsquo;t receive anything? Check your spam folder, or{' '}
            <button
              onClick={() => {
                setSubmitted(false);
                setIdentifier('');
              }}
              className="font-medium text-teal-600 hover:text-teal-700"
            >
              try a different email or mobile number
            </button>
            .
          </p>
          <Link
            href="/login"
            className="mt-6 flex items-center gap-2 text-sm font-medium text-teal-600 hover:text-teal-700"
          >
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </motion.div>
      ) : (
        <>
          <h2 className="text-3xl font-black tracking-tight text-slate-900">Reset password</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Enter your email or mobile number. The reset link is sent to the email on file.
          </p>

          {formError && (
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            <AuthInput
              id="identifier"
              type="text"
              label="Email or mobile number"
              value={identifier}
              onChange={(v) => {
                setIdentifier(v);
                if (fieldError) setFieldError(null);
              }}
              onBlur={(v) => {
                const r = forgotPasswordSchema.safeParse({ identifier: v });
                if (r.success) {
                  setFieldError(null);
                  return;
                }
                const flat = r.error.flatten().fieldErrors as Record<string, string[] | undefined>;
                setFieldError(flat.identifier?.[0] ?? 'Invalid email or mobile number');
              }}
              placeholder="you@lvpei.org / 98765 43210"
              error={fieldError ?? undefined}
              disabled={loading}
              icon={AtSign}
              autoComplete="username"
              helpText="The reset link is always sent to the email on your account."
            />
            <AuthSubmit loading={loading}>Send reset link</AuthSubmit>
          </form>

          <Link
            href="/login"
            className="mt-8 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="size-4" /> Back to sign in
          </Link>
        </>
      )}
    </AuthShell>
  );
}
