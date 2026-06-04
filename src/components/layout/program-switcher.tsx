'use client'

// W6.11 — Program switcher in the top bar.
//
// Renders the active program as a button. Clicking opens a dropdown of all
// programs the user is a member of; selecting one calls switchProgram() on
// the role context, which POSTs /api/me/active-program and triggers a
// router.refresh() so the (platform) layout re-reads the user's
// activeProgramId from the DB.
//
// Hides itself entirely when the user has < 2 memberships — no point
// switching to the only program you're in.

import { useEffect, useRef, useState } from 'react'
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRole } from '@/contexts/role-context'
import { ROLE_LABELS } from '@/lib/constants'

export function ProgramSwitcher() {
  const { programs, activeProgram, switchProgram, switchingProgram } = useRole()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Hide entirely until the user has multiple programs. The switcher is a
  // tenancy affordance, not a status badge — single-program users don't need
  // a button that does nothing.
  if (programs.length < 2 || !activeProgram) return null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switchingProgram}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-8 max-w-[220px] items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 text-xs text-foreground transition-colors hover:bg-muted/60',
          'disabled:cursor-not-allowed disabled:opacity-60',
          open && 'bg-muted/60',
        )}
      >
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{activeProgram.name}</span>
        {switchingProgram ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-muted-foreground/70 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl shadow-black/10 dark:shadow-black/40"
        >
          <div className="border-b border-border/40 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Programs
            </p>
          </div>
          <ul className="max-h-72 overflow-y-auto p-1.5">
            {programs.map((p) => {
              const isActive = p.programId === activeProgram.programId
              return (
                <li key={p.programId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    disabled={switchingProgram}
                    onClick={async () => {
                      if (isActive) {
                        setOpen(false)
                        return
                      }
                      try {
                        await switchProgram(p.programId)
                      } finally {
                        setOpen(false)
                      }
                    }}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                      isActive
                        ? 'bg-primary/10 text-foreground'
                        : 'hover:bg-muted/60',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                    )}
                  >
                    <Building2
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight text-foreground">
                        {p.name}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {ROLE_LABELS[p.role]}
                      </p>
                    </div>
                    {isActive && <Check className="mt-1 size-3.5 shrink-0 text-primary" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
