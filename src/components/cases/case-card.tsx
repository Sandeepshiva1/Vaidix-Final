'use client'

import Link from 'next/link'
import { Clock, Image, Users, Brain, BookOpen, ArrowUpRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BLOOMS_COGNITIVE } from '@/lib/constants'
import { motion } from '@/lib/motion'
import type { ClinicalCase } from '@/lib/types'

const difficultyConfig = {
  beginner: { color: 'border-t-emerald-500', label: 'Beginner', badgeCls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', glow: 'group-hover:shadow-emerald-500/10' },
  intermediate: { color: 'border-t-amber-500', label: 'Intermediate', badgeCls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', glow: 'group-hover:shadow-amber-500/10' },
  advanced: { color: 'border-t-red-500', label: 'Advanced', badgeCls: 'bg-red-500/10 text-red-700 dark:text-red-400', glow: 'group-hover:shadow-red-500/10' },
}

interface CaseCardProps {
  caseData: ClinicalCase
  index?: number
}

export function CaseCard({ caseData, index = 0 }: CaseCardProps) {
  const difficulty = difficultyConfig[caseData.difficulty]
  const bloomsEntry = BLOOMS_COGNITIVE.find((b) => b.level === caseData.bloomsLevel)

  const genderLabel =
    caseData.patientGender === 'M' || caseData.patientGender === 'Male'
      ? 'Male'
      : 'Female'

  return (
    <Link href={`/cases/${caseData.id}`} className="group block">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <Card
          className={`relative border-t-[3px] ${difficulty.color} transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-lg ${difficulty.glow}`}
        >
          {/* Hover arrow indicator */}
          <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
            <ArrowUpRight className="size-4 text-primary" />
          </div>

          <CardContent className="flex flex-col gap-3">
            {/* Patient info */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {caseData.patientName}
              </span>
              <Badge variant="secondary" className="text-xs">
                {caseData.patientAge}{caseData.patientAge !== 'preterm' ? 'y' : ''} / {genderLabel}
              </Badge>
            </div>

            {/* Title and condition */}
            <div>
              <h3 className="font-semibold leading-snug text-foreground group-hover:text-primary transition-colors">
                {caseData.title}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {caseData.condition}
              </p>
            </div>

            {/* Description */}
            <p className="line-clamp-2 text-sm text-muted-foreground/80 leading-relaxed">
              {caseData.description}
            </p>

            {/* Bloom's level, difficulty, time, images */}
            <div className="flex flex-wrap items-center gap-2">
              {bloomsEntry && (
                <Badge
                  variant="outline"
                  className="gap-1 text-xs"
                  style={{ borderColor: bloomsEntry.color, color: bloomsEntry.color }}
                >
                  <Brain className="size-3" />
                  {bloomsEntry.label}
                </Badge>
              )}
              <Badge variant="outline" className={`text-xs ${difficulty.badgeCls} border-transparent`}>
                {difficulty.label}
              </Badge>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" />
                {caseData.estimatedMinutes}m
              </span>
              {caseData.imageCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Image className="size-3" aria-label="Clinical images" />
                  {caseData.imageCount}
                </span>
              )}
            </div>

            {/* Tags */}
            {caseData.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {caseData.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
                {caseData.tags.length > 4 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    +{caseData.tags.length - 4}
                  </span>
                )}
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="size-3" />
                {caseData.completions} completed
              </span>
              <span className="flex items-center gap-1">
                <BookOpen className="size-3" />
                Avg {caseData.avgScore}%
              </span>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </Link>
  )
}
