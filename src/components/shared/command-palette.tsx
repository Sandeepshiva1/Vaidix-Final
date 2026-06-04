'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import {
  BookOpen,
  Brain,
  Lightbulb,
  LayoutDashboard,
  NotebookPen,
  RotateCcw,
  Search,
  Trophy,
  Video,
  Microscope,
  Scan,
  ScanEye,
  TrendingUp,
} from 'lucide-react'
import casesData from '@/mock-data/cases.json'
import type { ClinicalCase } from '@/lib/types'

const cases = casesData as unknown as ClinicalCase[]

const PAGES = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, group: 'Navigate' },
  { name: 'Case Library', href: '/cases', icon: BookOpen, group: 'Navigate' },
  { name: 'My Progress', href: '/progress', icon: TrendingUp, group: 'Navigate' },
  { name: 'Reflection Journal', href: '/journal', icon: NotebookPen, group: 'Navigate' },
  { name: 'Spaced Reviews', href: '/reviews', icon: RotateCcw, group: 'Navigate' },
  { name: 'Classroom', href: '/classroom', icon: Video, group: 'Navigate' },
  { name: 'Simulators', href: '/simulators', icon: Microscope, group: 'Navigate' },
  { name: 'Challenges', href: '/challenges', icon: Trophy, group: 'Navigate' },
  { name: 'Clinical Pearls', href: '/pearls', icon: Lightbulb, group: 'Navigate' },
  { name: 'Signs Atlas', href: '/atlas', icon: Scan, group: 'Navigate' },
  { name: 'Imaging', href: '/imaging', icon: ScanEye, group: 'Navigate' },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // Toggle with Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const navigate = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router]
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Command palette */}
      <div className="relative mx-auto mt-[15vh] w-full max-w-xl px-4">
        <Command
          className="overflow-hidden rounded-xl border border-border/80 bg-popover shadow-2xl"
          loop
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              placeholder="Search cases, pages, pearls..."
              className="h-12 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden shrink-0 rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {/* Pages */}
            <Command.Group heading="Pages" className="px-1 py-1.5">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pages
              </p>
              {PAGES.map((page) => (
                <Command.Item
                  key={page.href}
                  value={page.name}
                  onSelect={() => navigate(page.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors data-[selected=true]:bg-accent"
                >
                  <page.icon className="size-4 text-muted-foreground" />
                  {page.name}
                </Command.Item>
              ))}
            </Command.Group>

            {/* Cases */}
            <Command.Group heading="Cases" className="px-1 py-1.5">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Cases
              </p>
              {cases.slice(0, 10).map((c) => (
                <Command.Item
                  key={c.id}
                  value={`${c.title} ${c.condition} ${c.patientName}`}
                  onSelect={() => navigate(`/cases/${c.id}`)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors data-[selected=true]:bg-accent"
                >
                  <Brain className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.condition} &middot; {c.patientName}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    L{c.bloomsLevel}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-2">
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">↑↓</kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">↵</kbd> select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">esc</kbd> close
              </span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  )
}
