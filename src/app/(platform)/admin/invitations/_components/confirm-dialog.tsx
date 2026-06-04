'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmTone = 'primary',
  cancelLabel = 'Cancel',
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  confirmTone?: 'primary' | 'warning' | 'danger';
  cancelLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const toneColors: Record<string, string> = {
    primary: 'bg-teal-600 hover:bg-teal-700 text-white',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm"
            onClick={busy ? undefined : onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex gap-4">
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                  confirmTone === 'danger' ? 'bg-red-100' : 'bg-amber-100'
                }`}
              >
                <AlertTriangle
                  className={`size-5 ${confirmTone === 'danger' ? 'text-red-600' : 'text-amber-600'}`}
                />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-slate-900">{title}</h2>
                <p className="mt-1.5 text-sm text-slate-600">{description}</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onCancel}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                disabled={busy}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${toneColors[confirmTone]}`}
              >
                {busy ? 'Please wait...' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
