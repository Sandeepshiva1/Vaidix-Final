'use client'

import { useEffect, useRef } from 'react'
import {
  User,
  Stethoscope,
  TestTubes,
  GraduationCap,
  UserCircle,
  Info,
  FileImage,
  Activity,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { Message, MessageAttachment } from '@/lib/types'

const roleConfig = {
  patient: {
    label: 'Patient',
    icon: User,
    avatarBg: 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
    bubbleBg: 'bg-card ring-1 ring-foreground/10',
  },
  nurse: {
    label: 'Nurse',
    icon: Stethoscope,
    avatarBg: 'bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
    bubbleBg: 'bg-card ring-1 ring-foreground/10',
  },
  lab: {
    label: 'Lab Results',
    icon: TestTubes,
    avatarBg: 'bg-purple-100 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
    bubbleBg: 'bg-card ring-1 ring-foreground/10',
  },
  mentor: {
    label: 'AI Mentor',
    icon: GraduationCap,
    avatarBg: 'bg-primary/10 text-primary dark:bg-primary/20',
    bubbleBg: 'bg-card ring-1 ring-primary/20',
  },
  learner: {
    label: 'You (Doctor)',
    icon: UserCircle,
    avatarBg: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    bubbleBg: 'bg-primary text-primary-foreground',
  },
  system: {
    label: 'System',
    icon: Info,
    avatarBg: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    bubbleBg: 'bg-muted text-muted-foreground',
  },
}

function formatTimestamp(ts: string) {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function ClinicalImageCard({ attachment }: { attachment: MessageAttachment }) {
  const data = attachment.data as Record<string, unknown>
  const description = typeof data.description === 'string' ? data.description : ''
  const findings = (data.findings as string[]) || []
  return (
    <Card className="mt-2 overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
        <FileImage className="size-4 text-primary" />
        <span className="text-xs font-semibold">{attachment.title}</span>
      </div>
      <CardContent className="px-3 py-2">
        <div className="flex h-32 items-center justify-center rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 text-slate-400 dark:from-slate-700 dark:to-slate-800">
          <div className="text-center">
            <FileImage className="mx-auto mb-1 size-8 opacity-40" />
            <p className="text-xs opacity-60">Clinical Image</p>
          </div>
        </div>
        {description && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {findings.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-foreground">Key Findings:</p>
            <ul className="mt-1 space-y-0.5">
              {findings.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <span className="mt-1 inline-block size-1.5 shrink-0 rounded-full bg-primary/60" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LabReportCard({ attachment }: { attachment: MessageAttachment }) {
  const data = attachment.data as Record<string, string>
  const entries = Object.entries(data)
  return (
    <Card className="mt-2 overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
        <TestTubes className="size-4 text-purple-500" />
        <span className="text-xs font-semibold">{attachment.title}</span>
      </div>
      <CardContent className="px-3 py-2">
        <div className="divide-y">
          {entries.map(([key, value]) => (
            <div key={key} className="py-2 first:pt-0 last:pb-0">
              <p className="text-xs font-semibold text-foreground">{key}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function VitalsCard({ attachment }: { attachment: MessageAttachment }) {
  const data = attachment.data as Record<string, string | number>
  const entries = Object.entries(data)
  return (
    <Card className="mt-2 overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
        <Activity className="size-4 text-emerald-500" />
        <span className="text-xs font-semibold">{attachment.title}</span>
      </div>
      <CardContent className="px-3 py-2">
        <div className="grid grid-cols-2 gap-2">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-lg bg-muted/50 px-2.5 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{key}</p>
              <p className="text-sm font-semibold text-foreground">{String(value)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function AttachmentRenderer({ attachment }: { attachment: MessageAttachment }) {
  switch (attachment.type) {
    case 'clinical-image':
      return <ClinicalImageCard attachment={attachment} />
    case 'lab-report':
      return <LabReportCard attachment={attachment} />
    case 'vitals':
      return <VitalsCard attachment={attachment} />
    default:
      return null
  }
}

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const ref = useRef<HTMLDivElement>(null)
  const config = roleConfig[message.role]
  const Icon = config.icon
  const isLearner = message.role === 'learner'
  const isSystem = message.role === 'system'

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.opacity = '0'
    el.style.transform = isLearner ? 'translateX(16px)' : 'translateX(-16px)'
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.35s ease-out, transform 0.35s ease-out'
      el.style.opacity = '1'
      el.style.transform = 'translateX(0)'
    })
  }, [isLearner])

  if (isSystem) {
    return (
      <div ref={ref} className="flex justify-center px-4 py-2">
        <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
          <Info className="size-3" />
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={`flex gap-2.5 px-4 py-1.5 ${isLearner ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${config.avatarBg}`}
      >
        <Icon className="size-4" />
      </div>

      {/* Bubble */}
      <div className={`flex max-w-[75%] flex-col ${isLearner ? 'items-end' : 'items-start'}`}>
        {/* Role label */}
        <span
          className={`mb-1 text-[11px] font-medium text-muted-foreground ${isLearner ? 'mr-1' : 'ml-1'}`}
        >
          {config.label}
        </span>

        {/* Message content */}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${config.bubbleBg} ${
            isLearner ? 'rounded-tr-md' : 'rounded-tl-md'
          }`}
        >
          {message.content.split('\n').map((line, i) => (
            <p key={i} className={i > 0 ? 'mt-1.5' : ''}>
              {line}
            </p>
          ))}
        </div>

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`mt-1 w-full max-w-sm ${isLearner ? 'self-end' : 'self-start'}`}>
            {message.attachments.map((att, i) => (
              <AttachmentRenderer key={i} attachment={att} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <span
          className={`mt-1 text-[10px] text-muted-foreground/60 ${isLearner ? 'mr-1' : 'ml-1'}`}
        >
          {formatTimestamp(message.timestamp)}
        </span>
      </div>
    </div>
  )
}
