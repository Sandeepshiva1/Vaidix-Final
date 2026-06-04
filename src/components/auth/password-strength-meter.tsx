'use client';

import { useMemo } from 'react';

export function PasswordStrengthMeter({ password }: { password: string }) {
  const checks = useMemo(() => {
    return [
      { key: 'length', label: '8+ characters', pass: password.length >= 8 },
      { key: 'upper', label: 'Uppercase letter', pass: /[A-Z]/.test(password) },
      { key: 'lower', label: 'Lowercase letter', pass: /[a-z]/.test(password) },
      { key: 'digit', label: 'Digit', pass: /[0-9]/.test(password) },
      { key: 'special', label: 'Special character', pass: /[^A-Za-z0-9]/.test(password) },
    ];
  }, [password]);

  const passed = checks.filter((c) => c.pass).length;
  const bars = [0, 1, 2, 3, 4];
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500', 'bg-green-500'];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {bars.map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < passed ? colors[Math.min(passed - 1, 4)] : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        {checks.map((c) => (
          <span key={c.key} className={c.pass ? 'text-green-600' : 'text-slate-400'}>
            {c.pass ? '✓' : '○'} {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}
