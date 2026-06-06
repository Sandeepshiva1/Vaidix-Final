// ════════════════════════════════════════════════════════════════════════════
// /classroom/[id] — the in-call entry point
// ════════════════════════════════════════════════════════════════════════════
// Reachable both by authenticated members AND by anonymous guests joining
// an openToAll session via a shared link (Teams-style "anyone with the link
// can join"). Branches:
//
//   1. session exists, viewer is signed in
//        → render the full authed LiveSession (existing flow)
//        → forward shareToken (?t=) so the waiting-room path still works for
//          non-cohort signed-in viewers
//
//   2. session exists, viewer is NOT signed in
//        a) TeachingSession.openToAll = true
//             → render <GuestPrejoin>, which asks for a display name then
//               polls /api/classroom/sessions/[id]/guest until ADMITTED.
//        b) openToAll = false
//             → redirect to /login?next=/classroom/[id] so they can sign in
//               and re-attempt with their member identity.
//
//   3. session not found → 404.

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Pencil, BookOpen, MessageCircleQuestion } from 'lucide-react'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { LiveSession } from '@/components/classroom/live-session'
import { LiveConference } from '@/app/(platform)/session/[id]/live/live-conference'
import { loadSessionView } from '@/lib/medlearn/session-view'
import { PendingSessionManager } from '@/components/classroom/pending-session-manager'
import { PostSessionInsightsPanel } from '@/components/classroom/post-session-insights-panel'
import { GuestPrejoin } from '@/components/classroom/guest-prejoin'
import { nextOccurrenceStart } from '@/server/services/sessions/recurrence'
import { computePrereqStatus } from '@/server/services/sessions/prereq'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ t?: string }>
}

export default async function ClassroomSessionPage({ params, searchParams }: PageProps) {
  const [{ id }, { t: shareToken }, session] = await Promise.all([
    params,
    searchParams,
    auth(),
  ])

  // Lightweight visibility lookup that runs even for anonymous visitors —
  // we need to know openToAll before deciding between the guest prejoin
  // and the login redirect.
  const gate = await db.teachingSession.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      openToAll: true,
      approvalStatus: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      hostId: true,
      recurrenceRule: true,
      recurrenceUntil: true,
    },
  })
  if (!gate) notFound()

  // Anonymous visitor → guest prejoin (openToAll) or login redirect.
  if (!session?.user) {
    if (gate.openToAll && gate.approvalStatus === 'APPROVED') {
      const host = await db.user.findUnique({
        where: { id: gate.hostId },
        select: { name: true, avatarUrl: true },
      })
      // Project recurring sessions to the next occurrence so the lobby card
      // doesn't show a stale past start time.
      const now = new Date()
      const next = gate.recurrenceRule
        ? nextOccurrenceStart(gate.scheduledStart, gate.recurrenceRule, gate.recurrenceUntil, now)
        : null
      const effectiveStart = next ?? gate.scheduledStart
      const effectiveEnd = next
        ? new Date(next.getTime() + (gate.scheduledEnd.getTime() - gate.scheduledStart.getTime()))
        : gate.scheduledEnd
      return (
        <GuestPrejoin
          sessionId={gate.id}
          title={gate.title}
          hostName={host?.name ?? 'Vaidix teacher'}
          hostAvatarUrl={host?.avatarUrl ?? null}
          scheduledStart={effectiveStart.toISOString()}
          scheduledEnd={effectiveEnd.toISOString()}
        />
      )
    }
    redirect(`/login?next=/classroom/${id}`)
  }

  // ── Authed path — identical to the prior (platform) page ──────────────────
  const s = await db.teachingSession.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      sessionType: true,
      status: true,
      approvalStatus: true,
      scheduledStart: true,
      scheduledEnd: true,
      recordingEnabled: true,
      consentRequired: true,
      hostId: true,
      proposedBy: true,
      objectives: true,
      topicId: true,
      recurrenceRule: true,
      recurrenceUntil: true,
      metadata: true,
    },
  })
  if (!s) notFound()

  // Board rooms are quick meetings: no classroom prep (study hub), no
  // classroom-style edit form, and no post-conference insights. The room itself
  // (people, chat, recording) is shared, so we just drop the classroom-only
  // chrome below.
  const isBoardRoom =
    s.metadata && typeof s.metadata === 'object' && !Array.isArray(s.metadata)
      ? (s.metadata as Record<string, unknown>).kind === 'BOARD_ROOM'
      : false

  const now = new Date()
  const next = s.recurrenceRule
    ? nextOccurrenceStart(s.scheduledStart, s.recurrenceRule, s.recurrenceUntil, now)
    : null
  const effectiveStatus =
    s.recurrenceRule && next && s.status !== 'LIVE' ? 'SCHEDULED' : s.status
  const effectiveStart = next ?? s.scheduledStart
  const effectiveEnd = next
    ? new Date(next.getTime() + (s.scheduledEnd.getTime() - s.scheduledStart.getTime()))
    : s.scheduledEnd

  const [host, proposer, viewer] = await Promise.all([
    db.user.findUnique({
      where: { id: s.hostId },
      select: { id: true, name: true, email: true, avatarUrl: true },
    }),
    db.user.findUnique({
      where: { id: s.proposedBy },
      select: { id: true, name: true },
    }),
    db.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, avatarUrl: true },
    }),
  ])

  const viewerEmail = viewer?.email ?? session.user.email ?? ''
  const viewerName =
    viewer?.name?.trim() ||
    (session.user.name ?? '').trim() ||
    (viewerEmail ? viewerEmail.split('@')[0] : '')
  const viewerAvatarUrl = viewer?.avatarUrl ?? null

  const canEdit =
    session.user.id === s.hostId ||
    session.user.id === s.proposedBy ||
    session.user.role === 'ADMIN' ||
    session.user.role === 'PROGRAM_DIRECTOR'

  if (s.approvalStatus !== 'APPROVED') {
    return (
      <>
        {canEdit && (
          <div className="flex justify-end">
            <EditSessionLink sessionId={s.id} />
          </div>
        )}
        <PendingSessionManager
          session={{
            id: s.id,
            title: s.title,
            description: s.description,
            sessionType: s.sessionType,
            approvalStatus: s.approvalStatus,
            scheduledStart: effectiveStart.toISOString(),
            scheduledEnd: effectiveEnd.toISOString(),
            host: host ?? { id: s.hostId, name: 'Unknown host', email: '' },
          }}
          proposer={proposer}
          currentUser={{
            id: session.user.id,
            name: viewerName,
            role: session.user.role,
          }}
        />
      </>
    )
  }

  // ── Unified live conference ───────────────────────────────────────────────
  // During the LIVE video conference EVERYONE — host, faculty, residents —
  // gets the same presenter console (the white teaching console). Host-only
  // moderator surfaces (mod tools, hook authoring, AI, breakout create, End
  // Session / SJT) are gated inside it by `isHost`; learners answer hooks via
  // the in-room HookOverlay and can join their assigned breakout. This replaces
  // the old split where the host saw the console and learners saw a different
  // (Teams-style) room — the source of the UI mismatch.
  //
  // Board rooms are instant meetings with NO scheduled lobby / "Start Session"
  // step, so they're created SCHEDULED and never explicitly flip to LIVE before
  // this page renders — which left the board-room host on the OLD LiveSession UI
  // while a normal live session showed the console (the Board-Room vs Normal
  // inconsistency). Board rooms therefore always use the console; the token mint
  // flips them LIVE on join.
  if (effectiveStatus === 'LIVE' || isBoardRoom) {
    const view = await loadSessionView(s.id)
    if (view) {
      return <LiveConference session={view} isHost={session.user.id === s.hostId} />
    }
  }

  const isCurator =
    session.user.id === s.hostId ||
    session.user.role === 'FACULTY' ||
    session.user.role === 'PROGRAM_DIRECTOR' ||
    session.user.role === 'ADMIN'

  const showStudyHubLink = effectiveStatus === 'SCHEDULED' && !isBoardRoom

  const prereqStatus = !isCurator
    ? await computePrereqStatus(s.id, session.user.id)
    : null

  const finalizedTranscript = await db.sessionTranscript.findUnique({
    where: { sessionId_language: { sessionId: s.id, language: 'en' } },
    select: { finalized: true },
  })
  const showInsights = !!finalizedTranscript?.finalized && !isBoardRoom
  const canTriggerInsights =
    session.user.id === s.hostId ||
    session.user.role === 'PROGRAM_DIRECTOR' ||
    session.user.role === 'ADMIN'

  return (
    <>
      {/* Classroom-only chrome. Board rooms are bare meetings — no shared Q&A,
          study hub, or classroom edit form — so the whole row is hidden. */}
      {!isBoardRoom && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Shared Q&A — open before AND after class so every cohort member /
              invitee can ask a question and answer anyone else's, not just the
              host. Shown in all stages (SCHEDULED / LIVE / ENDED). */}
          <QnaLink sessionId={s.id} />
          {showStudyHubLink && <StudyHubLink sessionId={s.id} isCurator={isCurator} />}
          {canEdit && <EditSessionLink sessionId={s.id} />}
        </div>
      )}
      {showInsights && (
        <PostSessionInsightsPanel sessionId={s.id} canTrigger={canTriggerInsights} />
      )}
      <LiveSession
        session={{
          id: s.id,
          title: s.title,
          description: s.description,
          sessionType: s.sessionType,
          status: effectiveStatus,
          approvalStatus: s.approvalStatus,
          scheduledStart: effectiveStart.toISOString(),
          scheduledEnd: effectiveEnd.toISOString(),
          recordingEnabled: s.recordingEnabled,
          consentRequired: s.consentRequired,
          host: host ?? { id: s.hostId, name: 'Unknown host', email: '', avatarUrl: null },
          captionsProfile: ((s.metadata as { captionsProfile?: string } | null | undefined)
            ?.captionsProfile ?? 'off') as 'english-only' | 'indic-mix' | 'off',
        }}
        currentUser={{
          id: session.user.id,
          name: viewerName,
          email: viewerEmail,
          avatarUrl: viewerAvatarUrl,
          role: session.user.role,
          isOrganizer: session.user.id === s.hostId,
        }}
        shareToken={shareToken}
        prereqStatus={prereqStatus}
      />
    </>
  )
}

function EditSessionLink({ sessionId }: { sessionId: string }) {
  return (
    <Link
      href={`/classroom/${sessionId}/edit`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition hover:bg-accent"
    >
      <Pencil className="size-3.5" />
      Edit session
    </Link>
  )
}

function QnaLink({ sessionId }: { sessionId: string }) {
  return (
    <Link
      href={`/classroom/${sessionId}/pre-questions`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-sm transition hover:bg-violet-500/20 dark:text-violet-400"
    >
      <MessageCircleQuestion className="size-3.5" />
      Q&amp;A — ask &amp; answer
    </Link>
  )
}

function StudyHubLink({ sessionId, isCurator }: { sessionId: string; isCurator: boolean }) {
  return (
    <Link
      href={`/classroom/${sessionId}/study`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-500/20 dark:text-emerald-400"
    >
      <BookOpen className="size-3.5" />
      {isCurator ? 'Manage prep' : 'Open study hub'}
    </Link>
  )
}
