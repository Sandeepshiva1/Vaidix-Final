'use client'

// PopOutWindowButton — opens a small standalone window with one of the
// session sidebars (chat, people, notes) so the user can keep collaborating
// while the main video tab is on a different monitor or behind another app.
//
// Implementation: a plain window.open() pointed at a dedicated route
// `/classroom/[id]/popout/[surface]` rendered as a minimal page with no
// chrome. The opened window relies on the same auth cookie (NextAuth) so
// no token plumbing is needed. Closing the popout does not affect the
// parent session.

import { useEffect, useState } from 'react'
import { ExternalLink, MessageSquare, NotebookPen } from 'lucide-react'
import { useSessionEvents } from '@/hooks/use-session-events'
import { cn } from '@/lib/utils'

// Pop-out surfaces. Chat uses the Phase-3 polling variant (3s interval) so
// it works outside the LiveKit room context. People still needs a polling
// variant — deferred to Phase 4 (the participant list is shorter-lived than
// chat scrollback so the value is lower).
const SURFACES = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
] as const

type SurfaceId = (typeof SURFACES)[number]['id']

export function PopOutWindowButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false)
  const { emit } = useSessionEvents({ sessionId, filter: ['POP_OUT'] })

  // close menu on outside click
  useEffect(() => {
    if (!open) return
    function onClick() {
      setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [open])

  function popOut(surface: SurfaceId) {
    setOpen(false)
    const url = `/popout/${sessionId}/${surface}`
    const features = 'width=420,height=720,menubar=no,toolbar=no,location=no,status=no'
    window.open(url, `vaidix-popout-${sessionId}-${surface}`, features)
    void emit('POP_OUT', { details: { surface } })
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Pop out a panel"
        className={cn(
          'flex items-center justify-center w-9 h-9 rounded-full border transition-all duration-150',
          open
            ? 'bg-teal-500/25 text-teal-300 border-teal-500/50'
            : 'bg-white/8 text-white/70 border-white/10 hover:bg-white/14'
        )}
      >
        <ExternalLink className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-44 rounded-xl bg-zinc-900/97 backdrop-blur-2xl border border-white/8 shadow-2xl shadow-black/70 p-1 z-50">
          {SURFACES.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => popOut(s.id)}
                className="flex items-center gap-2 w-full text-left rounded-lg px-2.5 py-1.5 text-sm text-white/85 hover:bg-white/8"
              >
                <Icon className="w-3.5 h-3.5 opacity-70" />
                {s.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
