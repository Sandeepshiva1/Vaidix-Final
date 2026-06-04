'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  NotebookPen,
  Smile,
  Meh,
  Brain,
  Frown,
  Lightbulb,
  X,
  Plus,
  ArrowLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mood = 'positive' | 'neutral' | 'contemplative' | 'challenged'

interface MoodOption {
  value: Mood
  icon: typeof Smile
  label: string
  color: string
  activeBg: string
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MOOD_OPTIONS: MoodOption[] = [
  {
    value: 'positive',
    icon: Smile,
    label: 'Positive',
    color: 'text-emerald-500',
    activeBg: 'bg-emerald-500/15 border-emerald-500',
  },
  {
    value: 'neutral',
    icon: Meh,
    label: 'Neutral',
    color: 'text-amber-500',
    activeBg: 'bg-amber-500/15 border-amber-500',
  },
  {
    value: 'contemplative',
    icon: Brain,
    label: 'Contemplative',
    color: 'text-blue-500',
    activeBg: 'bg-blue-500/15 border-blue-500',
  },
  {
    value: 'challenged',
    icon: Frown,
    label: 'Challenged',
    color: 'text-rose-500',
    activeBg: 'bg-rose-500/15 border-rose-500',
  },
]

const RECENT_CASES = [
  { id: 'case-001', label: 'Wet AMD with Subfoveal CNV' },
  { id: 'case-002', label: 'Proliferative Diabetic Retinopathy' },
  { id: 'case-004', label: 'Retinopathy of Prematurity' },
  { id: 'case-005', label: 'Primary Open Angle Glaucoma' },
  { id: 'case-008', label: 'Childhood Strabismus' },
  { id: 'case-010', label: 'Post-surgical Endophthalmitis' },
]

const PROMPTS = [
  'What emotions did your last case evoke?',
  'How did you balance clinical detachment with empathy?',
  'What would you do differently?',
  'What surprised you about the patient\'s response?',
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewJournalEntryPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [mood, setMood] = useState<Mood | null>(null)
  const [linkedCase, setLinkedCase] = useState<string>('')
  const [content, setContent] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])

  function handleAddTag() {
    const trimmed = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed])
    }
    setTagInput('')
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    }
  }

  function handleRemoveTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  function handleInsertPrompt(prompt: string) {
    setContent((prev) => {
      if (prev.length > 0 && !prev.endsWith('\n')) {
        return prev + '\n\n' + prompt + '\n'
      }
      return prev + prompt + '\n'
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => router.push('/journal')}
          className="size-8 rounded-full"
          aria-label="Back to Journal"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <NotebookPen className="size-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              New Reflection
            </h1>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left column: Editor */}
        <div className="space-y-5">
          {/* Title */}
          <div className="space-y-1.5">
            <label
              htmlFor="entry-title"
              className="text-sm font-medium text-foreground"
            >
              Title
            </label>
            <Input
              id="entry-title"
              placeholder="Give your reflection a title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10"
            />
          </div>

          {/* Mood selector */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Mood</span>
            <div className="flex items-center gap-2">
              {MOOD_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const isActive = mood === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMood(opt.value)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border-2 px-4 py-3 transition-all',
                      isActive
                        ? opt.activeBg
                        : 'border-transparent bg-muted/50 hover:bg-muted'
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-6',
                        isActive ? opt.color : 'text-muted-foreground'
                      )}
                    />
                    <span
                      className={cn(
                        'text-xs font-medium',
                        isActive ? opt.color : 'text-muted-foreground'
                      )}
                    >
                      {opt.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Link to Case */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Link to Case{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <Select value={linkedCase} onValueChange={(v) => setLinkedCase(v ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a recent case..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No linked case</SelectItem>
                {RECENT_CASES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label
              htmlFor="tag-input"
              className="text-sm font-medium text-foreground"
            >
              Tags
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="tag-input"
                placeholder="Add a tag and press Enter..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddTag}
                disabled={!tagInput.trim()}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="space-y-1.5">
            <label
              htmlFor="entry-content"
              className="text-sm font-medium text-foreground"
            >
              Reflection
            </label>
            <Textarea
              id="entry-content"
              placeholder="Write your reflection here. What did you observe, feel, and learn?"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-64 text-sm leading-relaxed"
              rows={12}
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              className="bg-teal-600 hover:bg-teal-700 text-white"
              disabled={!title.trim() || !content.trim()}
            >
              Save Entry
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/journal')}
            >
              Cancel
            </Button>
          </div>
        </div>

        {/* Right column: Prompts */}
        <div className="lg:sticky lg:top-6 h-fit">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Lightbulb className="size-4 text-amber-500" />
                Reflection Prompts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Click a prompt to insert it into your reflection.
              </p>
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleInsertPrompt(prompt)}
                  className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted hover:border-teal-500/40"
                >
                  &ldquo;{prompt}&rdquo;
                </button>
              ))}
              <p className="pt-2 text-[11px] text-muted-foreground leading-relaxed">
                Regular reflection strengthens the HEART domain by building
                emotional vocabulary, self-awareness, and empathetic reasoning.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
