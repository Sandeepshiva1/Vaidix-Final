'use client'

import { useState, useTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bookmark, Share2, X, Copy, Check, Loader2, Lock, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toggleRecordingBookmarkAction, createRecordingShareAction } from './actions'

interface Props {
  recordingId: string
  initialBookmarked: boolean
  canShare: boolean
}

export function RecordingActions({ recordingId, initialBookmarked, canShare }: Props) {
  const [bookmarked, setBookmarked] = useState(initialBookmarked)
  const [isPending, startTransition] = useTransition()
  const [shareOpen, setShareOpen] = useState(false)

  function handleBookmark() {
    const prev = bookmarked
    setBookmarked(!prev)
    startTransition(async () => {
      try {
        const r = await toggleRecordingBookmarkAction(recordingId)
        setBookmarked(r.bookmarked)
      } catch {
        setBookmarked(prev)
      }
    })
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={handleBookmark}
          disabled={isPending}
          aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            bookmarked
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-border bg-background text-muted-foreground hover:bg-muted'
          )}
        >
          <Bookmark className={cn('size-3.5', bookmarked && 'fill-current')} />
          {bookmarked ? 'Saved' : 'Save'}
        </button>

        {canShare && (
          <button
            onClick={() => setShareOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            <Share2 className="size-3.5" />
            Share
          </button>
        )}
      </div>

      {shareOpen && (
        <ShareModal
          recordingId={recordingId}
          onClose={() => setShareOpen(false)}
        />
      )}
    </>
  )
}

function ShareModal({ recordingId, onClose }: { recordingId: string; onClose: () => void }) {
  const [ttlDays, setTtlDays] = useState(7)
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const result = await createRecordingShareAction({
        recordingId,
        ttlDays,
        password: usePassword && password.trim() ? password.trim() : undefined,
      })
      const url = `${window.location.origin}/recordings/share/${result.token}`
      setLink(url)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create share link'
      setError(msg)
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Share2 className="size-4 text-primary" />
                Share recording
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Anyone with this link can view (read-only). Audited per access.
              </p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted/60" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>

          {!link ? (
            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Link expires in</label>
                <div className="flex flex-wrap gap-2">
                  {[1, 7, 14, 30].map((d) => (
                    <button
                      key={d}
                      onClick={() => setTtlDays(d)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        ttlDays === d ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {d === 1 ? '1 day' : `${d} days`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={usePassword}
                    onChange={(e) => setUsePassword(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  <Lock className="size-3.5 text-muted-foreground" />
                  Require password
                </label>
                {usePassword && (
                  <Input
                    type="password"
                    placeholder="Set a password (min 6 chars)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>

              {error && (
                <p className="rounded-md bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-400">{error}</p>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={creating}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={creating || (usePassword && password.trim().length < 6)}
                >
                  {creating ? (
                    <>
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create link'
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 px-5 py-4">
              <p className="text-xs text-muted-foreground">
                Copy this link now — for security, it&apos;s shown once and not stored in plaintext.
              </p>
              <div className="flex items-center gap-2">
                <Input value={link} readOnly className="font-mono text-xs" />
                <Button size="sm" onClick={handleCopy}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Open link
                <ExternalLink className="size-3" />
              </a>
              <div className="flex items-center justify-end pt-2">
                <Button size="sm" onClick={onClose}>Done</Button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
