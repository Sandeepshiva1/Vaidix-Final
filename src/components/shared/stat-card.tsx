'use client'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  trend?: { value: number; label: string }
  color?: string // tailwind color class like 'text-blue-500'
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color = 'text-primary',
}: StatCardProps) {
  const isPositiveTrend = trend && trend.value >= 0

  // Derive a background tint from the color class for the icon circle
  const bgColorMap: Record<string, string> = {
    'text-primary': 'bg-primary/10',
    'text-blue-500': 'bg-blue-500/10',
    'text-blue-600': 'bg-blue-600/10',
    'text-rose-500': 'bg-rose-500/10',
    'text-rose-600': 'bg-rose-600/10',
    'text-green-500': 'bg-green-500/10',
    'text-green-600': 'bg-green-600/10',
    'text-amber-500': 'bg-amber-500/10',
    'text-amber-600': 'bg-amber-600/10',
    'text-purple-500': 'bg-purple-500/10',
    'text-purple-600': 'bg-purple-600/10',
    'text-teal-500': 'bg-teal-500/10',
    'text-teal-600': 'bg-teal-600/10',
    'text-cyan-500': 'bg-cyan-500/10',
    'text-cyan-600': 'bg-cyan-600/10',
    'text-indigo-500': 'bg-indigo-500/10',
    'text-orange-500': 'bg-orange-500/10',
    'text-emerald-500': 'bg-emerald-500/10',
    'text-red-500': 'bg-red-500/10',
  }

  const iconBg = bgColorMap[color] ?? 'bg-primary/10'

  return (
    <Card className="relative overflow-hidden transition-shadow duration-300 hover:shadow-lg hover:shadow-primary/5">
      {/* Subtle gradient overlay in the top-right corner */}
      <div
        className={cn(
          'pointer-events-none absolute -right-6 -top-6 size-24 rounded-full opacity-[0.07] blur-2xl',
          iconBg.replace('/10', '/100')
        )}
      />

      <CardContent className="relative flex items-start justify-between pt-1">
        {/* Left side: text content */}
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {title}
          </p>
          <p className="text-3xl font-bold tracking-tight text-foreground">
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
          {trend && (
            <div className="mt-1 flex items-center gap-1">
              {isPositiveTrend ? (
                <TrendingUp className="size-3.5 text-emerald-500" />
              ) : (
                <TrendingDown className="size-3.5 text-red-500" />
              )}
              <span
                className={cn(
                  'text-xs font-medium',
                  isPositiveTrend ? 'text-emerald-600' : 'text-red-500'
                )}
              >
                {isPositiveTrend ? '+' : ''}
                {trend.value}%
              </span>
              <span className="text-xs text-muted-foreground">
                {trend.label}
              </span>
            </div>
          )}
        </div>

        {/* Right side: icon with colored background circle */}
        <div
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl',
            iconBg
          )}
        >
          <Icon className={cn('size-5', color)} />
        </div>
      </CardContent>
    </Card>
  )
}
