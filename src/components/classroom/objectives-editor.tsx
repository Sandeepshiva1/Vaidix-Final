'use client'

// ════════════════════════════════════════════════════════════════════════════
// ObjectivesEditor — curator-side editor for structured learning objectives
// ════════════════════════════════════════════════════════════════════════════
// Used on the new-session form and on session-edit screens. Each objective is
// `{ id?, text, blooms }` (epaTag deliberately omitted from the v1 UI — server
// accepts it, but residents don't have a curated EPA picker yet). The id field
// is optional on the client; the server stamps a cuid on first save and keeps
// it stable across edits so resident achievement marks survive reordering.

import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export interface ObjectiveDraft {
  id?: string
  text: string
  blooms: number
}

const BLOOMS_LEVELS: { value: number; label: string; hint: string }[] = [
  { value: 1, label: '1 · Remember',   hint: 'recall facts, terms, definitions' },
  { value: 2, label: '2 · Understand', hint: 'explain, summarise, classify' },
  { value: 3, label: '3 · Apply',      hint: 'use a method in a new situation' },
  { value: 4, label: '4 · Analyse',    hint: 'differentiate, compare, attribute' },
  { value: 5, label: '5 · Evaluate',   hint: 'judge, critique, defend a stance' },
  { value: 6, label: '6 · Create',     hint: 'design, plan, formulate' },
]

const MAX_OBJECTIVES = 10

interface Props {
  value: ObjectiveDraft[]
  onChange: (next: ObjectiveDraft[]) => void
  disabled?: boolean
}

export function ObjectivesEditor({ value, onChange, disabled }: Props) {
  const canAdd = value.length < MAX_OBJECTIVES && !disabled

  function update(index: number, patch: Partial<ObjectiveDraft>) {
    onChange(value.map((o, i) => (i === index ? { ...o, ...patch } : o)))
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  function add() {
    if (!canAdd) return
    onChange([...value, { text: '', blooms: 2 }])
  }

  return (
    <div className="space-y-3" data-testid="objectives-editor">
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-3">
        <Target className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-foreground">
            What should learners be able to do after this session?
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Write one objective per line. Each is tagged with a Bloom&rsquo;s level so
            residents can self-mark whether they achieved it after the session.
          </p>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {value.map((o, idx) => (
          <motion.div
            key={o.id ?? `draft-${idx}`}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="grid gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-[1fr_180px_auto]"
          >
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Objective {idx + 1}
              </p>
              <Textarea
                value={o.text}
                onChange={(e) => update(idx, { text: e.target.value })}
                rows={2}
                maxLength={280}
                disabled={disabled}
                placeholder="e.g. Identify the four hallmark slit-lamp findings of band keratopathy"
                className="rounded-lg"
                data-testid={`objective-text-${idx}`}
              />
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Bloom&rsquo;s level
              </p>
              <Select
                value={String(o.blooms)}
                onValueChange={(v) => update(idx, { blooms: Number(v) })}
                disabled={disabled}
              >
                <SelectTrigger
                  className="rounded-lg"
                  data-testid={`objective-blooms-${idx}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BLOOMS_LEVELS.map((b) => (
                    <SelectItem key={b.value} value={String(b.value)}>
                      <div className="flex flex-col items-start gap-0.5">
                        <span>{b.label}</span>
                        <span className="text-[10px] text-muted-foreground">{b.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(idx)}
                disabled={disabled}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove objective ${idx + 1}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={!canAdd}
        className="w-full rounded-xl border-dashed"
        data-testid="objective-add"
      >
        <Plus className="size-4" />
        {value.length === 0 ? 'Add a learning objective' : `Add another (${value.length}/${MAX_OBJECTIVES})`}
      </Button>
    </div>
  )
}
