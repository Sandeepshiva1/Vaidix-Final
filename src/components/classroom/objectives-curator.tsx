'use client'

// ════════════════════════════════════════════════════════════════════════════
// ObjectivesCurator — host-side editor for an existing session's objectives
// ════════════════════════════════════════════════════════════════════════════
// Wraps <ObjectivesEditor>: pulls current objectives from the API, lets the
// curator add/edit/remove/reorder, then saves via PATCH /api/classroom/
// sessions/[id] with the full array. The PATCH service handles the round-trip
// id-preservation so resident achievement marks survive the edit.

import { useEffect, useState, useCallback, useTransition } from 'react'
import { Loader2, Save, AlertCircle, Target } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ObjectivesEditor, type ObjectiveDraft } from './objectives-editor'

interface FetchedObjective {
  id: string
  text: string
  blooms: number
  epaTag: string | null
  myStatus: 'YES' | 'PARTLY' | 'NO' | null
}

async function getCsrf(): Promise<string> {
  const m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export function ObjectivesCurator({ sessionId }: { sessionId: string }) {
  const [drafts, setDrafts] = useState<ObjectiveDraft[]>([])
  const [snapshot, setSnapshot] = useState<ObjectiveDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/classroom/sessions/${sessionId}/objectives`, {
        cache: 'no-store',
        credentials: 'include',
      })
      const json = (await res.json()) as { ok: boolean; data?: { objectives: FetchedObjective[] }; error?: { message: string } }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
      const fetched: ObjectiveDraft[] = (json.data?.objectives ?? []).map((o) => ({
        id: o.id,
        text: o.text,
        blooms: o.blooms,
      }))
      setDrafts(fetched)
      setSnapshot(fetched)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])

  const dirty = JSON.stringify(drafts) !== JSON.stringify(snapshot)

  async function save() {
    setSaving(true)
    try {
      const csrf = await getCsrf()
      // Drop empty rows before sending — server's min(3) would reject them anyway.
      const payload = drafts.filter((d) => d.text.trim().length >= 3)
      const res = await fetch(`/api/classroom/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        credentials: 'include',
        body: JSON.stringify({ objectives: payload }),
      })
      const json = (await res.json()) as { ok: boolean; error?: { message: string } }
      if (!res.ok || !json.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
      toast.success(`Saved ${payload.length} objective${payload.length === 1 ? '' : 's'}`)
      startTransition(() => { void refresh() })
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" /> Loading objectives…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <AlertCircle className="size-4 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium">Couldn&apos;t load objectives</p>
          <p className="text-xs mt-0.5 opacity-80">{error}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="objectives-curator">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-primary" />
          <p className="text-sm font-semibold">Learning objectives</p>
        </div>
        <Button
          size="sm"
          onClick={save}
          disabled={!dirty || saving}
          data-testid="objectives-save"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>

      <ObjectivesEditor value={drafts} onChange={setDrafts} disabled={saving} />
    </div>
  )
}
