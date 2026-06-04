'use client'

// W6 P2 — DB-backed case chat session.
//
// URL contract:  /cases/[caseId]/session?conv=<conversationId>
//   - The detail page POSTs /api/cases/[id]/conversations to create a fresh
//     attempt; on success it routes here with `?conv=<id>` so this page never
//     mutates state on its own.
//   - Without `conv`, we POST to start a new attempt (back-compat with the
//     old "Start Case" inline behavior — handy for direct-link entry).
//
// The chat translates the DB Message shape (senderRole + CaseStage enum) into
// the frontend Message type (role + numeric stage) that the existing
// ChatContainer / MessageBubble already render.

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, X, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChatContainer } from '@/components/conversation/chat-container'
import type { Conversation as UiConversation, Message as UiMessage } from '@/lib/types'

interface ApiMessage {
  id: string
  senderRole: 'PATIENT' | 'AI' | 'RESIDENT' | 'FACULTY'
  content: string
  createdAt: string
  stage: 'PATIENT_STORY' | 'OBSERVATION' | 'HYPOTHESIS' | 'INVESTIGATION' | 'REFLECTION' | 'COMPLETED' | null
}

interface ApiConversation {
  id: string
  caseId: string
  templateId: string
  status: 'ACTIVE' | 'COMPLETED' | 'FLAGGED'
  stage: 'PATIENT_STORY' | 'OBSERVATION' | 'HYPOTHESIS' | 'INVESTIGATION' | 'REFLECTION' | 'COMPLETED'
  startedAt: string
  updatedAt: string
  messages: ApiMessage[]
}

interface CaseTemplateApi {
  id: string
  legacyId: string | null
  title: string
  patientName: string
}

const STAGE_NUMBER: Record<ApiConversation['stage'], number> = {
  PATIENT_STORY: 1,
  OBSERVATION: 2,
  HYPOTHESIS: 3,
  INVESTIGATION: 4,
  REFLECTION: 5,
  COMPLETED: 5,
}

const SENDER_TO_UI_ROLE: Record<ApiMessage['senderRole'], UiMessage['role']> = {
  PATIENT: 'patient',
  AI: 'mentor',
  FACULTY: 'mentor',
  RESIDENT: 'learner',
}

function adaptMessage(m: ApiMessage, fallbackStage: number): UiMessage {
  return {
    id: m.id,
    role: SENDER_TO_UI_ROLE[m.senderRole] ?? 'mentor',
    content: m.content,
    timestamp: m.createdAt,
    stage: m.stage ? STAGE_NUMBER[m.stage] : fallbackStage,
  }
}

function adaptConversation(c: ApiConversation, learnerId: string): UiConversation {
  const stageNumber = STAGE_NUMBER[c.stage]
  return {
    id: c.id,
    caseId: c.caseId,
    learnerId,
    status: c.status === 'COMPLETED' ? 'completed' : 'active',
    currentStage: stageNumber,
    startedAt: c.startedAt,
    messages: c.messages.map((m) => adaptMessage(m, stageNumber)),
  }
}

export default function SessionPage() {
  const params = useParams<{ caseId: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialConvId = searchParams.get('conv')

  const [caseTitle, setCaseTitle] = useState<string>('')
  const [patientName, setPatientName] = useState<string>('')
  const [conversation, setConversation] = useState<UiConversation | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(initialConvId)
  const [isThinking, setIsThinking] = useState(false)

  // Mount: fetch the template (for header) + load OR start a conversation.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const tplRes = await fetch(`/api/cases/${params.caseId}`, { credentials: 'include' })
      const tpl = await tplRes.json()
      if (!cancelled && tpl.ok) {
        const t = tpl.data as CaseTemplateApi
        setCaseTitle(t.title)
        setPatientName(t.patientName)
      }

      let convId = initialConvId
      if (!convId) {
        const startRes = await fetch(`/api/cases/${params.caseId}/conversations`, {
          method: 'POST',
          credentials: 'include',
        })
        const startJson = await startRes.json()
        if (!cancelled && startJson.ok) {
          convId = startJson.data.conversationId as string
          setConversationId(convId)
          // Update URL so reload keeps the same conversation.
          router.replace(`/cases/${params.caseId}/session?conv=${convId}`)
        }
      }
      if (!convId || cancelled) return

      const convRes = await fetch(
        `/api/cases/${params.caseId}/conversations/${convId}`,
        { credentials: 'include' }
      )
      const convJson = await convRes.json()
      if (!cancelled && convJson.ok) {
        setConversation(adaptConversation(convJson.data as ApiConversation, 'self'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params.caseId, initialConvId, router])

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!conversation || !conversationId || conversation.status === 'completed') return

      // Optimistic resident message.
      const optimisticId = `optimistic-${Date.now()}`
      const optimistic: UiMessage = {
        id: optimisticId,
        role: 'learner',
        content,
        timestamp: new Date().toISOString(),
        stage: conversation.currentStage,
      }
      setConversation((prev) => (prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev))
      setIsThinking(true)

      try {
        const res = await fetch(
          `/api/cases/${params.caseId}/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ content }),
          }
        )
        const json = await res.json()
        if (!json.ok) {
          // Roll back the optimistic message on failure and show the error.
          setConversation((prev) =>
            prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticId) } : prev
          )
          alert(json.error?.message ?? 'Failed to send')
          return
        }
        const data = json.data as {
          residentMessage: ApiMessage
          mentorMessage: ApiMessage
          newStage: ApiConversation['stage']
          conversationStatus: ApiConversation['status']
        }
        const newStageNumber = STAGE_NUMBER[data.newStage]
        setConversation((prev) => {
          if (!prev) return prev
          // Replace the optimistic id with the server's id; append mentor reply.
          const withReal = prev.messages.map((m) =>
            m.id === optimisticId ? adaptMessage(data.residentMessage, newStageNumber) : m
          )
          return {
            ...prev,
            messages: [...withReal, adaptMessage(data.mentorMessage, newStageNumber)],
            currentStage: newStageNumber,
            status: data.conversationStatus === 'COMPLETED' ? 'completed' : 'active',
          }
        })
      } finally {
        setIsThinking(false)
      }
    },
    [conversation, conversationId, params.caseId]
  )

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading case...
        </div>
      </div>
    )
  }

  const isReview = conversation.status === 'completed'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b bg-card px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href={`/cases/${params.caseId}`}
            className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="h-6 w-px bg-border" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">{caseTitle}</h1>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="size-3" />
              <span>{patientName}</span>
              {isReview && (
                <span className="ml-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  COMPLETED
                </span>
              )}
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-destructive"
          onClick={() => router.push(`/cases/${params.caseId}`)}
        >
          <X className="size-4" />
          <span className="hidden sm:inline">End Session</span>
        </Button>
      </div>

      <div className="flex-1 overflow-hidden">
        <ChatContainer
          conversation={conversation}
          onSendMessage={handleSendMessage}
          isThinking={isThinking}
        />
      </div>
    </div>
  )
}
