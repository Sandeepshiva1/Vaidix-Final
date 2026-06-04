'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { AuthShell, AuthInput, AuthSubmit } from '@/components/auth/auth-shell';
import { resetPasswordSchema } from '@/lib/validation/auth';
import { PasswordStrengthMeter } from '@/components/auth/password-strength-meter';

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  function validateField(name: 'newPassword' | 'confirmPassword') {
    const r = resetPasswordSchema.safeParse({
      token: params.token,
      newPassword,
      confirmPassword,
    });
    if (r.success) {
      setFieldErrors((p) => ({ ...p, [name]: '' }));
      return;
    }
    const flat = r.error.flatten().fieldErrors;
    setFieldErrors((p) => ({ ...p, [name]: flat[name]?.[0] ?? '' }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError(null);

    const parsed = resetPasswordSchema.safeParse({
      token: params.token,
      newPassword,
      confirmPassword,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        newPassword: flat.newPassword?.[0] ?? '',
        confirmPassword: flat.confirmPassword?.[0] ?? '',
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body = await res.json();
      if (res.ok) {
        setSubmitted(true);
        setTimeout(() => router.push('/login'), 2500);
      } else {
        setFormError(body?.error?.message ?? 'Unable to reset password. The link may be expired.');
      }
    } catch {
      setFormError('Network error. Please try again.');
    }
    setLoading(false);
  }

  return (
    <AuthShell
      heroTitle={
        <>
          Choose a<br />
          strong password.
        </>
      }
      heroSubtitle="Used once, it protects a lifetime of learning."
      heroDescription="Your password must be at least 8 characters and include uppercase, lowercase, a digit, and a special character."
    >
      {submitted ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-green-200 bg-green-50 p-6"
        >
          <CheckCircle2 className="mb-3 size-10 text-green-600" />
          <h2 className="text-xl font-bold text-slate-900">Password updated</h2>
          <p className="mt-2 text-sm text-slate-600">
            Your password has been changed. Redirecting you to sign in...
          </p>
        </motion.div>
      ) : (
        <>
          <h2 className="text-3xl font-black tracking-tight text-slate-900">Set new password</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Choose a password you haven&rsquo;t used before on Vaidix.
          </p>

          {formError && (
            <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            <div>
              <AuthInput
                id="newPassword"
                type={showPw ? 'text' : 'password'}
                label="New password"
                value={newPassword}
                onChange={(v) => {
                  setNewPassword(v);
                  if (fieldErrors.newPassword) setFieldErrors((p) => ({ ...p, newPassword: '' }));
                }}
                onBlur={() => validateField('newPassword')}
                placeholder="Enter new password"
                error={fieldErrors.newPassword}
                disabled={loading}
                icon={Lock}
                autoComplete="new-password"
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="text-slate-400 hover:text-slate-600"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
              />
              <PasswordStrengthMeter password={newPassword} />
            </div>

            <AuthInput
              id="confirmPassword"
              type={showPw ? 'text' : 'password'}
              label="Confirm password"
              value={confirmPassword}
              onChange={(v) => {
                setConfirmPassword(v);
                if (fieldErrors.confirmPassword) setFieldErrors((p) => ({ ...p, confirmPassword: '' }));
              }}
              onBlur={() => validateField('confirmPassword')}
              placeholder="Re-enter new password"
              error={fieldErrors.confirmPassword}
              disabled={loading}
              icon={Lock}
              autoComplete="new-password"
            />

            <AuthSubmit loading={loading}>Update password</AuthSubmit>
          </form>

          <Link
            href="/login"
            className="mt-8 block text-center text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            Back to sign in
          </Link>
        </>
      )}
    </AuthShell>
  );
}
