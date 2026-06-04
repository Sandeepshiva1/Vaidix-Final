'use client'

import { useEffect, useRef, useState } from 'react'
import { UsersRound, Plus, Settings2, MoreHorizontal, Pencil, Trash2, GraduationCap } from 'lucide-react'
import { Role } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { CohortDetailDrawer } from './cohort-detail-drawer'
import { UserPicker, type PickableUser } from '@/components/user-picker'

export interface CohortFacultyRef {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

interface CohortRow {
  id: string
  name: string
  description: string | null
  academicYear: string | null
  faculty: CohortFacultyRef | null
  memberCount: number
  createdAt: string
}

export function CohortsClient({ initial }: { initial: CohortRow[] }) {
  const [cohorts, setCohorts]               = useState(initial)
  const [creating, setCreating]             = useState(false)
  const [name, setName]                     = useState('')
  const [description, setDescription]       = useState('')
  const [academicYear, setAcademicYear]     = useState('')
  const [submitting, setSubmitting]         = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [openCohortId, setOpenCohortId]     = useState<string | null>(null)
  const [openCohortSection, setOpenCohortSection] = useState<'edit' | 'members'>('members')
  const [initialMembers, setInitialMembers] = useState<PickableUser[]>([])
  const [initialFaculty, setInitialFaculty] = useState<PickableUser[]>([])
  const [menuOpenId, setMenuOpenId]         = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close 3-dot menu on outside click
  useEffect(() => {
    if (!menuOpenId) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenId(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpenId])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/cohorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          academicYear: academicYear || undefined,
          facultyId: initialFaculty[0]?.id,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error?.message ?? 'Create failed')
      const c = json.data.cohort

      let memberCount = 0
      if (initialMembers.length > 0) {
        const memRes = await fetch(`/api/cohorts/${c.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: initialMembers.map((u) => u.id) }),
        })
        const memJson = await memRes.json()
        if (memJson.ok) memberCount = memJson.data.added ?? initialMembers.length
        else setError(`Cohort created, but adding members failed: ${memJson.error?.message ?? 'unknown'}`)
      }

      setCohorts((prev) => [
        {
          id: c.id,
          name: c.name,
          description: c.description,
          academicYear: c.academicYear,
          faculty: c.faculty ?? null,
          memberCount,
          createdAt: c.createdAt,
        },
        ...prev,
      ])
      setName(''); setDescription(''); setAcademicYear(''); setInitialMembers([]); setInitialFaculty([]); setCreating(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function quickDelete(id: string, displayName: string) {
    if (!window.confirm(`Delete cohort "${displayName}"? Members will be detached. This can't be undone from the UI.`)) return
    try {
      const res = await fetch(`/api/cohorts/${id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!body.ok) {
        setError(body.error?.message ?? 'Delete failed')
        return
      }
      setCohorts((prev) => prev.filter((c) => c.id !== id))
      setMenuOpenId(null)
    } catch {
      setError('Network error')
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <div className="flex justify-end">
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4 mr-1.5" /> New cohort
          </Button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="space-y-4 rounded-lg border bg-card p-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Academic year</label>
              <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="2026–27" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Teacher mentor</label>
            <p className="text-xs text-muted-foreground">
              Optional — one teacher who mentors this cohort. Can be set or changed later.
            </p>
            <UserPicker
              single
              role={Role.FACULTY}
              selected={initialFaculty}
              onChange={setInitialFaculty}
              placeholder="Search teachers…"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Add members</label>
            <p className="text-xs text-muted-foreground">
              Optional — pick residents, faculty, or anyone to include now. You can also add members later from the cohort card.
            </p>
            <UserPicker
              selected={initialMembers}
              onChange={setInitialMembers}
              placeholder="Search by name or email…"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {initialMembers.length > 0
                ? `${initialMembers.length} member${initialMembers.length === 1 ? '' : 's'} will be added on create`
                : 'No initial members'}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" type="button" onClick={() => { setCreating(false); setInitialMembers([]); setInitialFaculty([]) }}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</Button>
            </div>
          </div>
        </form>
      )}

      {cohorts.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <p className="text-muted-foreground">No cohorts yet. Create one to start scoping session visibility.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cohorts.map((c) => (
            <div
              key={c.id}
              className="group relative rounded-lg border bg-card p-4 transition hover:border-primary/40 hover:shadow-md"
            >
              {/* 3-dot menu — sits above the click-to-open layer */}
              <div className="absolute right-2 top-2 z-10" ref={menuOpenId === c.id ? menuRef : null}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpenId(menuOpenId === c.id ? null : c.id)
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[open=true]:opacity-100"
                  data-open={menuOpenId === c.id}
                  aria-label="Cohort actions"
                >
                  <MoreHorizontal className="size-4" />
                </button>
                {menuOpenId === c.id && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenCohortSection('edit')
                        setOpenCohortId(c.id)
                        setMenuOpenId(null)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-foreground transition hover:bg-accent"
                    >
                      <Pencil className="size-3.5" /> Edit details
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenCohortSection('members')
                        setOpenCohortId(c.id)
                        setMenuOpenId(null)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-foreground transition hover:bg-accent"
                    >
                      <UsersRound className="size-3.5" /> Manage members
                    </button>
                    <div className="h-px bg-border" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void quickDelete(c.id, c.name)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-destructive transition hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" /> Delete cohort
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setOpenCohortId(c.id)}
                className="block w-full text-left"
              >
                <div className="flex items-start justify-between pr-7">
                  <div className="flex items-center gap-2 min-w-0">
                    <UsersRound className="size-5 shrink-0 text-primary" />
                    <h3 className="truncate font-semibold">{c.name}</h3>
                  </div>
                  {c.academicYear && <Badge variant="outline" className="ml-2 shrink-0">{c.academicYear}</Badge>}
                </div>
                {c.description && (
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                )}
                {c.faculty && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GraduationCap className="size-3 shrink-0" />
                    <span className="truncate">Mentored by {c.faculty.name}</span>
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
                  </p>
                  <span className="flex items-center gap-1 text-xs font-semibold text-primary opacity-0 transition group-hover:opacity-100">
                    <Settings2 className="size-3" /> Manage
                  </span>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      <CohortDetailDrawer
        cohortId={openCohortId}
        initialSection={openCohortSection}
        onClose={() => setOpenCohortId(null)}
        onChanged={(newCount) => {
          if (!openCohortId) return
          setCohorts((prev) =>
            prev.map((c) => (c.id === openCohortId ? { ...c, memberCount: newCount } : c))
          )
        }}
        onRenamed={(id, patch) => {
          setCohorts((prev) =>
            prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
          )
        }}
        onDeleted={(id) => {
          setCohorts((prev) => prev.filter((c) => c.id !== id))
        }}
      />
    </div>
  )
}
