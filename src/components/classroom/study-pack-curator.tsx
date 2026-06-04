'use client'

// ════════════════════════════════════════════════════════════════════════════
// Study Pack Curator — faculty / host curates the resident's pre-session pack
// ════════════════════════════════════════════════════════════════════════════
// Two tabs:
//   1. Documents — every doc tagged to the session, with a "Mark as
//      pre-session" toggle. Toggling flips DocumentSessionLink.isPreSession.
//   2. Pre-cases — search the case template library + attach selected
//      templates as SessionPreCase rows.
//
// Faculty must already have tagged docs to the session via the flow
// (/api/documents/[id]/tag-session). This panel intentionally doesn't expose
// "upload a new doc" — that's the documents library's job. Keeps concerns
// separate (tagging vs prep-marking).

import { useEffect, useState, useCallback } from 'react'
import {
  FileText, Video, Sparkles, CheckCircle2, X, Loader2,
  Search, Plus, AlertCircle, BookOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SessionUploadButton } from './session-upload-button'

interface DocCandidate {
  linkId: string
  documentId: string
  title: string
  description: string | null
  kind: 'PPT' | 'PDF' | 'DOC' | 'MARKDOWN' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OTHER'
  mimeType: string
  isPreSession: boolean
  preSessionRank: number | null
  uploadedByName: string
  uploadedAt: string
}

interface PreCaseRow {
  preCaseId: string
  caseTemplateId: string
  title: string
  condition: string
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
  bloomsLevel: number
  estimatedMinutes: number
  rank: number
  required: boolean
  attachedAt: string
  completedByCount: number
}

interface CaseTemplate {
  id: string
  legacyId: string | null
  title: string
  condition: string
  specialty: string
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
  bloomsLevel: number
  estimatedMinutes: number
}

interface ApiOk<T> { ok: true; data: T }
interface ApiErr { ok: false; error: { code: string; message: string } }

async function getCsrf(): Promise<string> {
  const m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
    if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
    headers.set('x-csrf-token', await getCsrf())
  }
  const res = await fetch(input, { ...init, headers })
  const json = (await res.json()) as ApiOk<T> | ApiErr
  if (!res.ok || !json.ok) {
    const msg = !json.ok ? json.error.message : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json.data
}

export function StudyPackCurator({ sessionId }: { sessionId: string }) {
  const [tab, setTab] = useState<'documents' | 'precases'>('documents')
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
      <TabsList variant="line" className="mb-4">
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="precases">Pre-cases</TabsTrigger>
      </TabsList>
      <TabsContent value="documents">
        <DocumentsCurator sessionId={sessionId} />
      </TabsContent>
      <TabsContent value="precases">
        <PreCasesCurator sessionId={sessionId} />
      </TabsContent>
    </Tabs>
  )
}

// ─── Documents ─────────────────────────────────────────────────────────────
function DocumentsCurator({ sessionId }: { sessionId: string }) {
  const [items, setItems] = useState<DocCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const d = await jsonFetch<{ items: DocCandidate[] }>(
        `/api/classroom/sessions/${sessionId}/study-pack/documents`
      )
      setItems(d.items)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = useCallback(
    async (item: DocCandidate) => {
      setBusyLinkId(item.linkId)
      // Optimistic flip
      setItems((prev) =>
        prev
          ? prev.map((it) => (it.linkId === item.linkId ? { ...it, isPreSession: !it.isPreSession } : it))
          : prev
      )
      try {
        if (item.isPreSession) {
          await jsonFetch(
            `/api/classroom/sessions/${sessionId}/study-pack/documents/${item.linkId}`,
            { method: 'DELETE' }
          )
          toast.success(`Removed "${item.title}" from study pack`)
        } else {
          await jsonFetch(
            `/api/classroom/sessions/${sessionId}/study-pack/documents`,
            {
              method: 'POST',
              body: JSON.stringify({ documentId: item.documentId }),
            }
          )
          toast.success(`Added "${item.title}" to study pack`)
        }
      } catch (e) {
        toast.error(`Could not toggle: ${(e as Error).message}`)
        await refresh()
      } finally {
        setBusyLinkId(null)
      }
    },
    [sessionId, refresh]
  )

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="flex items-start gap-3 pt-6">
          <AlertCircle className="size-5 text-destructive mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Couldn&apos;t load documents</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={refresh}>Retry</Button>
          </div>
        </CardContent>
      </Card>
    )
  }
  if (!items) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" /> Loading…
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No documents tagged to this session yet. Upload one below — it will be added to the study pack automatically.
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <SessionUploadButton sessionId={sessionId} onUploaded={refresh} />
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">
          {items.filter((i) => i.isPreSession).length} of {items.length} marked as pre-session
        </p>
        <SessionUploadButton sessionId={sessionId} onUploaded={refresh} />
      </div>
      <ul className="space-y-2" data-testid="study-pack-curator-doclist">
      {items.map((it) => {
        const Icon = it.kind === 'VIDEO' ? Video : FileText
        return (
          <li
            key={it.linkId}
            className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3"
            data-testid={`curator-doc-${it.linkId}`}
          >
            <Icon className={`size-5 shrink-0 mt-0.5 ${it.kind === 'VIDEO' ? 'text-rose-500' : 'text-blue-500'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="font-medium text-sm truncate">{it.title}</p>
                {it.isPreSession ? (
                  <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15">
                    <CheckCircle2 className="size-3 mr-1" /> Pre-session
                  </Badge>
                ) : (
                  <Badge variant="outline">Not in pack</Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {it.kind} · uploaded by {it.uploadedByName}
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant={it.isPreSession ? 'outline' : 'default'}
                  disabled={busyLinkId === it.linkId}
                  onClick={() => void toggle(it)}
                  data-testid={`curator-doc-toggle-${it.linkId}`}
                >
                  {busyLinkId === it.linkId ? <Loader2 className="size-3 animate-spin" /> : null}
                  {it.isPreSession ? 'Remove from pack' : 'Mark as pre-session'}
                </Button>
              </div>
            </div>
          </li>
        )
      })}
      </ul>
    </div>
  )
}

// ─── Pre-cases ─────────────────────────────────────────────────────────────
function PreCasesCurator({ sessionId }: { sessionId: string }) {
  const [items, setItems] = useState<PreCaseRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<CaseTemplate[]>([])
  const [searching, setSearching] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const d = await jsonFetch<{ items: PreCaseRow[] }>(
        `/api/classroom/sessions/${sessionId}/pre-cases`
      )
      setItems(d.items)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Debounced search
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setSearchResults([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const d = await jsonFetch<{ items: CaseTemplate[] }>(
          `/api/cases?search=${encodeURIComponent(q)}`
        )
        if (!cancelled) setSearchResults(d.items)
      } catch {
        // search errors are non-fatal — let the picker stay empty
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [search])

  const attach = useCallback(
    async (tpl: CaseTemplate) => {
      setBusyId(tpl.id)
      try {
        await jsonFetch(`/api/classroom/sessions/${sessionId}/pre-cases`, {
          method: 'POST',
          body: JSON.stringify({ caseTemplateId: tpl.id }),
        })
        toast.success(`Attached "${tpl.title}" as pre-case`)
        setSearch('')
        setSearchResults([])
        await refresh()
      } catch (e) {
        toast.error(`Could not attach: ${(e as Error).message}`)
      } finally {
        setBusyId(null)
      }
    },
    [sessionId, refresh]
  )

  const detach = useCallback(
    async (row: PreCaseRow) => {
      setBusyId(row.preCaseId)
      try {
        await jsonFetch(
          `/api/classroom/sessions/${sessionId}/pre-cases/${row.preCaseId}`,
          { method: 'DELETE' }
        )
        toast.success(`Removed "${row.title}"`)
        await refresh()
      } catch (e) {
        toast.error(`Could not remove: ${(e as Error).message}`)
      } finally {
        setBusyId(null)
      }
    },
    [sessionId, refresh]
  )

  const toggleRequired = useCallback(
    async (row: PreCaseRow) => {
      const next = !row.required
      // Optimistic flip — revert on failure.
      setItems((prev) =>
        prev ? prev.map((it) => (it.preCaseId === row.preCaseId ? { ...it, required: next } : it)) : prev
      )
      try {
        await jsonFetch(
          `/api/classroom/sessions/${sessionId}/pre-cases/${row.preCaseId}`,
          { method: 'PATCH', body: JSON.stringify({ required: next }) }
        )
      } catch (e) {
        toast.error(`Could not update: ${(e as Error).message}`)
        setItems((prev) =>
          prev ? prev.map((it) => (it.preCaseId === row.preCaseId ? { ...it, required: !next } : it)) : prev
        )
      }
    },
    [sessionId]
  )

  // Suppress search results for templates that are already attached.
  const attachedTemplateIds = new Set(items?.map((i) => i.caseTemplateId) ?? [])

  return (
    <div className="space-y-4">
      {/* Search + add */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Search the case library
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or condition…"
            className="pl-9"
            data-testid="curator-precase-search"
          />
        </div>
        {searching && (
          <p className="text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin inline mr-1" /> Searching…
          </p>
        )}
        {!searching && search.trim().length >= 2 && searchResults.length === 0 && (
          <p className="text-xs text-muted-foreground">No matches.</p>
        )}
        {searchResults.length > 0 && (
          <Card className="border-dashed">
            <CardContent className="pt-4">
              <ul className="space-y-2" data-testid="curator-precase-search-results">
                {searchResults
                  .filter((t) => !attachedTemplateIds.has(t.id))
                  .map((t) => (
                    <li
                      key={t.id}
                      className="flex items-start gap-3 rounded-lg border bg-background px-3 py-2"
                    >
                      <BookOpen className="size-4 shrink-0 mt-0.5 text-amber-500" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{t.title}</p>
                        <p className="text-xs text-muted-foreground">{t.condition}</p>
                      </div>
                      <Button
                        size="sm"
                        disabled={busyId === t.id}
                        onClick={() => void attach(t)}
                        data-testid={`curator-precase-add-${t.id}`}
                      >
                        {busyId === t.id ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                        Add
                      </Button>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Existing list */}
      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertCircle className="size-5 text-destructive mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}
      {!items && !error && (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> Loading…
        </div>
      )}
      {items && items.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No pre-cases attached yet. Search above to add the first one.
          </CardContent>
        </Card>
      )}
      {items && items.length > 0 && (
        <ul className="space-y-2" data-testid="curator-precase-list">
          {items.map((it) => (
            <li
              key={it.preCaseId}
              className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3"
              data-testid={`curator-precase-${it.preCaseId}`}
            >
              <Sparkles className="size-5 shrink-0 mt-0.5 text-amber-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="font-medium text-sm">{it.title}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {it.required ? (
                      <Badge className="text-[10px] bg-rose-500/15 text-rose-600 hover:bg-rose-500/20">
                        Required
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Optional
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {it.difficulty.toLowerCase()}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      ~{it.estimatedMinutes} min
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {it.completedByCount} completed
                    </Badge>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{it.condition}</p>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={it.required}
                    onChange={() => void toggleRequired(it)}
                    className="size-3.5 rounded border-border accent-primary"
                    data-testid={`curator-precase-required-${it.preCaseId}`}
                  />
                  Mark as mandatory pre-class prep
                </label>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busyId === it.preCaseId}
                onClick={() => void detach(it)}
                title="Remove from session"
                data-testid={`curator-precase-remove-${it.preCaseId}`}
              >
                {busyId === it.preCaseId ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
