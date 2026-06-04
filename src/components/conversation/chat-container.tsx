'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, UserCircle, Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { StageProgress } from './stage-progress'
import { MessageBubble } from './message-bubble'
import { useSpeechRecognition } from '@/hooks/use-speech-recognition'
import { cn } from '@/lib/utils'
import type { Conversation, Message } from '@/lib/types'

interface ChatContainerProps {
  conversation: Conversation
  onSendMessage: (content: string) => void
  isThinking?: boolean
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-1.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-primary/20">
        <div className="flex items-center gap-1">
          <span className="inline-block size-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
          <span className="inline-block size-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
          <span className="inline-block size-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
        </div>
      </div>
      <div className="rounded-2xl rounded-tl-md bg-card px-4 py-2.5 ring-1 ring-foreground/10">
        <span className="text-sm text-muted-foreground">AI is thinking...</span>
      </div>
    </div>
  )
}

export function ChatContainer({ conversation, onSendMessage, isThinking = false }: ChatContainerProps) {
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const valueBeforeListeningRef = useRef('')

  const {
    isSupported: speechSupported,
    isListening,
    transcript,
    interimTranscript,
    toggle: toggleListening,
    reset: resetTranscript,
  } = useSpeechRecognition({ lang: 'en-IN', continuous: true })

  // Merge live transcription into the textarea while listening
  useEffect(() => {
    if (!isListening && !transcript && !interimTranscript) return
    const live = (transcript + ' ' + interimTranscript).trim()
    const base = valueBeforeListeningRef.current
    setInputValue(base ? `${base} ${live}`.trim() : live)
  }, [transcript, interimTranscript, isListening])

  // When listening starts, capture the existing textarea content as the "base"
  useEffect(() => {
    if (isListening) {
      valueBeforeListeningRef.current = inputValue
      resetTranscript()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening])

  // Derive completed stages from messages
  const completedStages = Array.from(
    new Set(
      conversation.messages
        .filter((m) => m.stage < conversation.currentStage)
        .map((m) => m.stage)
    )
  )

  // Auto-scroll to bottom when new messages arrive or when thinking
  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
    return () => clearTimeout(timer)
  }, [conversation.messages.length, isThinking])

  const handleSend = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    onSendMessage(trimmed)
    setInputValue('')
    valueBeforeListeningRef.current = ''
    resetTranscript()
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Stage progress */}
      <div className="shrink-0 border-b bg-card/50 backdrop-blur-sm">
        <StageProgress
          currentStage={conversation.currentStage}
          completedStages={completedStages}
        />
      </div>

      {/* Messages area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-smooth">
        <div className="mx-auto max-w-3xl py-4">
          {conversation.messages.map((msg: Message) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {isThinking && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t bg-card/80 backdrop-blur-sm">
        <div className="mx-auto max-w-3xl px-4 py-3">
          {/* Role indicator + live listening indicator */}
          <div className="mb-2 flex items-center gap-1.5">
            <UserCircle className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">You (Doctor)</span>
            {isListening && (
              <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-red-500">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                </span>
                Listening...
              </span>
            )}
          </div>

          {/* Input row */}
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isListening
                  ? 'Speaking... tap the mic to stop'
                  : 'Type your response or tap the mic to speak...'
              }
              className="min-h-10 max-h-32 flex-1 resize-none rounded-xl border-foreground/10 bg-background py-2.5 text-sm focus-visible:border-primary focus-visible:ring-primary/30"
              disabled={conversation.status === 'completed'}
              rows={1}
            />

            {/* Voice input button */}
            {speechSupported && conversation.status !== 'completed' && (
              <Button
                type="button"
                size="icon"
                variant={isListening ? 'default' : 'outline'}
                onClick={toggleListening}
                aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                className={cn(
                  'size-10 shrink-0 rounded-xl',
                  isListening && 'bg-red-500 text-white hover:bg-red-600'
                )}
              >
                {isListening ? (
                  <MicOff className="size-4" />
                ) : (
                  <Mic className="size-4" />
                )}
              </Button>
            )}

            <Button
              size="icon"
              onClick={handleSend}
              disabled={!inputValue.trim() || conversation.status === 'completed'}
              className="size-10 shrink-0 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="size-4" />
            </Button>
          </div>

          {conversation.status === 'completed' && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              This session has been completed. You can review the conversation above.
            </p>
          )}

          {conversation.status !== 'completed' && (
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
              {speechSupported
                ? 'Enter to send · Shift+Enter new line · Mic for voice input'
                : 'Press Enter to send, Shift+Enter for new line'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
