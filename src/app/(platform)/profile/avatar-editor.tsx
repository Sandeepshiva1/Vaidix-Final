'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, Trash2 } from 'lucide-react'

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

interface Props {
  initialAvatarUrl: string | null
  name: string
  initials: string
}

// Self-service profile photo. Renders the current avatar (or initials) with an
// always-available camera button to upload/replace and a remove button once a
// photo exists. Each action hits /api/me/avatar (atomic upload + persist) and
// then router.refresh() so the page — and the shell header, which also reads
// User.avatarUrl on the server — repaint with the new image.
export function AvatarEditor({ initialAvatarUrl, name, initials }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)
    if (!ACCEPT.includes(file.type)) {
      setError('Please choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Image must be 5 MB or smaller.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/me/avatar', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? 'Upload failed. Please try again.')
        return
      }
      setAvatarUrl(body.data.avatarUrl as string)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/me/avatar', { method: 'DELETE' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? 'Could not remove photo.')
        return
      }
      setAvatarUrl(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5 sm:items-start">
      <div className="relative size-16 shrink-0">
        <div className="size-full overflow-hidden rounded-full ring-2 ring-primary/20">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={name}
              data-testid="profile-avatar-image"
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-linear-to-br from-teal-500 to-blue-600 text-base font-semibold text-white">
              {initials}
            </div>
          )}
        </div>

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        )}

        {/* Always-visible edit affordance so a user who already has a photo can
            still change it (the previous design offered no way to). */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          data-testid="profile-avatar-edit"
          aria-label={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
          className="absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
        >
          <Camera className="size-3" />
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          data-testid="profile-avatar-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void upload(f)
            e.target.value = ''
          }}
        />
      </div>

      {avatarUrl && (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          data-testid="profile-avatar-remove"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-destructive disabled:opacity-50"
        >
          <Trash2 className="size-3" />
          Remove
        </button>
      )}

      {error && (
        <p data-testid="profile-avatar-error" className="max-w-[12rem] text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  )
}
