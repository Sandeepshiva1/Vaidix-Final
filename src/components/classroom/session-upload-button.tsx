'use client'

// ════════════════════════════════════════════════════════════════════════════
// SessionUploadButton — in-place "Upload material" for the Pre-Conf curator
// ════════════════════════════════════════════════════════════════════════════
// One click, four server roundtrips, no navigating to /teacher/documents:
//   1. POST /api/documents              → draft Document + presigned URL
//   2. PUT to presigned URL             → file lands in MinIO
//   3. POST /api/documents/[id]/tag-session  → links doc to this session
//   4. POST /api/classroom/sessions/[id]/study-pack/documents  → flips
//      isPreSession=true so residents see it on /classroom/[id]/study
//
// The classify worker is also kicked off (best-effort; non-blocking) so the
// AI pipeline still runs. On failure at any step the partial state is left
// in place — the curator can re-run from where they were (drafts are visible
// in the documents library).

import { useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, Loader2, FileText, X, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

interface Props {
  sessionId: string
  onUploaded?: () => void
}

async function getCsrf(): Promise<string> {
  const m = document.cookie.match(/(?:^|;\s*)vaidix-csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export function SessionUploadButton({ sessionId, onUploaded }: Props) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<'idle' | 'draft' | 'upload' | 'tag' | 'mark' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setTitle('')
    setDescription('')
    setFile(null)
    setPhase('idle')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const submit = useCallback(async () => {
    if (!file || title.trim().length < 1) {
      setError('Title and file are required')
      return
    }
    setError(null)
    const csrf = await getCsrf()
    try {
      setPhase('draft')
      const draftRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        credentials: 'include',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      })
      const draft = (await draftRes.json()) as {
        ok: boolean
        data?: { presignedUploadUrl: string; document: { id: string } }
        error?: { message: string }
      }
      if (!draftRes.ok || !draft.ok || !draft.data) {
        throw new Error(draft.error?.message ?? `HTTP ${draftRes.status}`)
      }
      const { presignedUploadUrl, document: { id: documentId } } = draft.data

      setPhase('upload')
      const putRes = await fetch(presignedUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)

      // Best-effort classification — don't block on it.
      fetch(`/api/documents/${documentId}/classify`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        credentials: 'include',
      }).catch(() => {})

      setPhase('tag')
      const tagRes = await fetch(`/api/documents/${documentId}/tag-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        credentials: 'include',
        body: JSON.stringify({ sessionId }),
      })
      const tagJson = (await tagRes.json()) as { ok: boolean; error?: { message: string } }
      if (!tagRes.ok || !tagJson.ok) {
        throw new Error(tagJson.error?.message ?? `Tag failed (HTTP ${tagRes.status})`)
      }

      setPhase('mark')
      const markRes = await fetch(`/api/classroom/sessions/${sessionId}/study-pack/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        credentials: 'include',
        body: JSON.stringify({ documentId }),
      })
      const markJson = (await markRes.json()) as { ok: boolean; error?: { message: string } }
      if (!markRes.ok || !markJson.ok) {
        throw new Error(markJson.error?.message ?? `Mark-as-pre-session failed (HTTP ${markRes.status})`)
      }

      setPhase('done')
      toast.success(`"${title}" added to the study pack`)
      onUploaded?.()
      window.setTimeout(() => {
        setOpen(false)
        reset()
      }, 600)
    } catch (e) {
      setError((e as Error).message)
      setPhase('idle')
    }
  }, [file, title, description, sessionId, onUploaded, reset])

  const phaseLabel: Record<typeof phase, string> = {
    idle: 'Upload to study pack',
    draft: 'Creating draft…',
    upload: 'Uploading file…',
    tag: 'Tagging to session…',
    mark: 'Marking as pre-session…',
    done: 'Done',
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="session-upload-open"
      >
        <Upload className="size-3.5" />
        Upload material
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={() => phase === 'idle' && setOpen(false)}
            data-testid="session-upload-modal"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 6 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                    <Upload className="size-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Upload material</p>
                    <p className="text-[11px] text-muted-foreground">PDF, PPT, DOC, image, or video</p>
                  </div>
                </div>
                <button
                  onClick={() => phase === 'idle' && setOpen(false)}
                  disabled={phase !== 'idle'}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="space-y-3 px-5 py-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Title</label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Band Keratopathy slit-lamp atlas"
                    disabled={phase !== 'idle'}
                    className="mt-1"
                    data-testid="session-upload-title"
                    maxLength={200}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">File</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".ppt,.pptx,.key,.pdf,.doc,.docx,.md,.png,.jpg,.jpeg,.mp4,.mov"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    disabled={phase !== 'idle'}
                    className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-primary"
                    data-testid="session-upload-file"
                  />
                  {file && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <FileText className="size-3" />
                      {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Description (optional)</label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="What students should know before opening this"
                    disabled={phase !== 'idle'}
                    className="mt-1"
                    maxLength={500}
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {phase !== 'idle' && phase !== 'done' && (
                  <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-xs text-primary">
                    <Loader2 className="size-3.5 animate-spin" />
                    {phaseLabel[phase]}
                  </div>
                )}
                {phase === 'done' && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    Added to study pack
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setOpen(false); reset() }}
                  disabled={phase !== 'idle' && phase !== 'done'}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={phase !== 'idle' || !file || !title.trim()}
                  data-testid="session-upload-submit"
                >
                  {phase === 'idle' ? <><Upload className="size-3.5" /> Upload</> : <><Loader2 className="size-3.5 animate-spin" /> Working…</>}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
