'use client'

import { MessageCircle, Eye, Brain, TestTubes, Heart, Check } from 'lucide-react'
import { CONVERSATION_STAGES } from '@/lib/constants'

const stageIcons: Record<string, React.ElementType> = {
  MessageCircle,
  Eye,
  Brain,
  TestTubes,
  Heart,
}

interface StageProgressProps {
  currentStage: number
  completedStages: number[]
}

export function StageProgress({ currentStage, completedStages }: StageProgressProps) {
  return (
    <div className="w-full px-2 py-3 sm:px-4">
      <div className="flex items-start justify-between">
        {CONVERSATION_STAGES.map((stage, index) => {
          const isCompleted = completedStages.includes(stage.stage)
          const isCurrent = stage.stage === currentStage
          const IconComponent = stageIcons[stage.icon] || MessageCircle

          return (
            <div key={stage.stage} className="flex flex-1 items-start">
              {/* Stage circle + label column */}
              <div className="flex flex-col items-center">
                {/* Circle */}
                <div
                  className={`relative flex size-9 items-center justify-center rounded-full transition-all duration-300 sm:size-10 ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : isCurrent
                        ? 'border-2 border-primary bg-primary/10 text-primary shadow-md'
                        : 'border-2 border-muted-foreground/25 bg-muted text-muted-foreground/50'
                  }`}
                >
                  {/* Pulsing ring for current */}
                  {isCurrent && (
                    <span className="absolute inset-0 animate-ping rounded-full border-2 border-primary opacity-20" />
                  )}
                  {isCompleted ? (
                    <Check className="size-4 sm:size-5" strokeWidth={2.5} />
                  ) : (
                    <IconComponent className="size-4 sm:size-5" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={`mt-1.5 text-center text-[10px] font-medium leading-tight sm:text-xs ${
                    isCompleted
                      ? 'text-primary'
                      : isCurrent
                        ? 'text-primary font-semibold'
                        : 'text-muted-foreground/60'
                  }`}
                >
                  {stage.label}
                </span>
              </div>

              {/* Connecting line */}
              {index < CONVERSATION_STAGES.length - 1 && (
                <div className="mt-[18px] flex h-[3px] flex-1 items-center px-1 sm:mt-[19px] sm:px-2">
                  <div
                    className={`h-full w-full rounded-full transition-all duration-500 ${
                      completedStages.includes(stage.stage)
                        ? 'bg-primary'
                        : 'bg-muted-foreground/15'
                    }`}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
