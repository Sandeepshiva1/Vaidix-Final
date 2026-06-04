'use client'

import { useEffect, useRef } from 'react'
import {
  motion,
  useInView,
  useSpring,
  useTransform,
  type Variants,
} from 'framer-motion'

// ---------------------------------------------------------------------------
// Reusable animation variants
// ---------------------------------------------------------------------------

export const fadeIn: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
}

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.3, ease: 'easeOut' } },
}

export const staggerContainer: Variants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
}

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } },
}

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } },
}

// ---------------------------------------------------------------------------
// Animated counter — smoothly counts from 0 to target value
// ---------------------------------------------------------------------------

export function AnimatedCounter({
  value,
  duration = 1.2,
  suffix = '',
  prefix = '',
  className = '',
}: {
  value: number
  duration?: number
  suffix?: string
  prefix?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true })
  const springValue = useSpring(0, { duration: duration * 1000, bounce: 0 })
  const displayValue = useTransform(springValue, (v) => Math.round(v))

  useEffect(() => {
    if (isInView) springValue.set(value)
  }, [isInView, value, springValue])

  return (
    <span ref={ref} className={className}>
      {prefix}
      <motion.span>{displayValue}</motion.span>
      {suffix}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Animated progress bar — fills from 0 to value on mount
// ---------------------------------------------------------------------------

export function AnimatedBar({
  value,
  className = '',
  barClassName = '',
  delay = 0,
}: {
  value: number
  className?: string
  barClassName?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true })

  return (
    <div ref={ref} className={`h-2 w-full overflow-hidden rounded-full bg-muted ${className}`}>
      <motion.div
        className={`h-full rounded-full ${barClassName}`}
        initial={{ width: 0 }}
        animate={isInView ? { width: `${value}%` } : { width: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page wrapper — fades page in with stagger support
// ---------------------------------------------------------------------------

export function PageTransition({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Individual staggered item
// ---------------------------------------------------------------------------

export function StaggerItem({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Hover-lift card wrapper — subtle scale + shadow on hover
// ---------------------------------------------------------------------------

export function HoverCard({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Animated circular progress ring (SVG)
// ---------------------------------------------------------------------------

export function AnimatedRing({
  value,
  size = 96,
  strokeWidth = 8,
  color = 'stroke-primary',
  trackColor = 'stroke-muted',
  label,
  sublabel,
}: {
  value: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  label?: string
  sublabel?: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const isInView = useInView(ref, { once: true })
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  return (
    <div className="flex flex-col items-center gap-2">
      <svg ref={ref} width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          className={trackColor}
          opacity={0.2}
        />
        {/* Progress */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          className={color}
          strokeLinecap="round"
          initial={{ strokeDasharray: circumference, strokeDashoffset: circumference }}
          animate={
            isInView
              ? {
                  strokeDashoffset: circumference - (value / 100) * circumference,
                }
              : {}
          }
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />
        {/* Center text */}
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="rotate-90 fill-foreground text-lg font-bold"
          style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
        >
          {value}
        </text>
      </svg>
      {label && (
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      )}
      {sublabel && (
        <span className="text-[10px] text-muted-foreground">{sublabel}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pulse dot — for "live" indicators
// ---------------------------------------------------------------------------

export function PulseDot({ color = 'bg-emerald-500' }: { color?: string }) {
  return (
    <span className="relative flex size-2.5">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color}`}
      />
      <span className={`relative inline-flex size-2.5 rounded-full ${color}`} />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Shimmer loading placeholder
// ---------------------------------------------------------------------------

export function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] ${className}`}
    />
  )
}

// Re-export motion for convenience
export { motion, useInView }
