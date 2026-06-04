'use client'

import { motion } from 'framer-motion'
import { type LucideIcon, Sparkles, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface FeaturePreview {
  icon: LucideIcon
  title: string
  description: string
}

interface ComingSoonProps {
  icon: LucideIcon
  title: string
  subtitle: string
  description: string
  features?: FeaturePreview[]
  backHref?: string
  backLabel?: string
  accentFrom?: string
  accentTo?: string
}

export function ComingSoon({
  icon: Icon,
  title,
  subtitle,
  description,
  features = [],
  backHref,
  backLabel = 'Go back',
  accentFrom = 'from-teal-500',
  accentTo = 'to-blue-600',
}: ComingSoonProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-2xl text-center"
      >
        {/* Icon badge */}
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mb-6 flex size-20 items-center justify-center rounded-2xl bg-linear-to-br shadow-xl shadow-teal-500/20"
          style={{ backgroundImage: `linear-gradient(to bottom right, var(--color-teal-500), var(--color-blue-600))` }}
        >
          <div className={cn('flex size-20 items-center justify-center rounded-2xl bg-linear-to-br', accentFrom, accentTo)}>
            <Icon className="size-9 text-white drop-shadow" />
          </div>
        </motion.div>

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
          className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400"
        >
          <Sparkles className="size-3" />
          Coming Soon
        </motion.div>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-2 text-3xl font-bold tracking-tight text-foreground"
        >
          {title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mb-2 text-sm font-semibold text-primary"
        >
          {subtitle}
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mx-auto mb-8 max-w-md text-sm text-muted-foreground"
        >
          {description}
        </motion.p>

        {/* Feature previews */}
        {features.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mb-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-2 lg:grid-cols-3"
          >
            {features.map((f, i) => {
              const FIcon = f.icon
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.07 }}
                  className="flex gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <FIcon className="size-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground">{f.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{f.description}</p>
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        )}

        {/* Back link */}
        {backHref && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <Link
              href={backHref}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-all hover:border-primary/40 hover:text-primary"
            >
              <ArrowLeft className="size-4" />
              {backLabel}
            </Link>
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
