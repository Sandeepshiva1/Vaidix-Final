'use client'

// VideoRoomClient — adapter interface for the live-classroom module.
//
// All network calls inside src/components/classroom/* SHOULD go through
// this client (not raw fetch), so the module can be lifted into another
// app by simply providing a different implementation.
//
// The default implementation talks to this LMS's
// /api/classroom/sessions/[id]/* routes. To use the room components in
// another product, wrap your tree in <VideoRoomClientProvider value={…}>
// with your own implementation; nothing else needs to change.
//
// Design notes:
//   - Keep the surface area small. We don't expose every detail of every
//     payload — the components consume narrow shapes (e.g. ChatMessage)
//     and the client is responsible for normalizing the wire format.
//   - All methods take sessionId as the first argument so a single
//     client can be reused across multiple rooms.
//   - Subscribe-style streams (presenter alerts, audit replay) return an
//     unsubscribe function — the consumer's implementation chooses
//     SSE / WebSocket / poll under the hood.

import { createContext, useContext, type ReactNode } from 'react'

// ─── Domain shapes ──────────────────────────────────────────────────────────

export type RoomRole = 'HOST' | 'CO_HOST' | 'PARTICIPANT' | 'VIEWER'

export interface TokenResultJoined {
  state: 'JOINED'
  token: string
  url: string
  role: RoomRole
}
export interface TokenResultWaiting {
  state: 'WAITING'
  admissionId: string
}
export interface TokenResultDenied {
  state: 'DENIED'
  reason?: string | null
}
export type TokenResult = TokenResultJoined | TokenResultWaiting | TokenResultDenied

export interface ChatAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  downloadUrl: string
}

export interface ChatMessage {
  id: string
  userId: string
  userName: string
  content: string
  createdAt: string
  attachment: ChatAttachment | null
}

export interface FileReservation {
  id: string
  uploadUrl: string
  hashRequired?: boolean
}

export interface PendingAdmission {
  id: string
  displayName: string | null
  // Null when this is an anonymous guest (Teams-style join without a Vaidix
  // account). Host UI falls back to `displayName` and shows a "Guest" badge.
  user: { id: string; name: string; email: string; avatarUrl: string | null; role: string } | null
}

export interface ShareLink {
  url: string
  expiresAt: string
}

export interface PresenterAlert {
  id: string
  kind: string
  severity: 'INFO' | 'WARN' | 'HIGH'
  message: string
  createdAt: string
}

export interface WhiteboardSnapshot {
  version: number
  snapshot: unknown
}

// ─── Interface ──────────────────────────────────────────────────────────────

export interface VideoRoomClient {
  // Join flow
  getToken(sessionId: string, opts?: { shareToken?: string }): Promise<TokenResult>

  // Chat
  loadChat(sessionId: string, limit?: number): Promise<ChatMessage[]>
  sendChat(sessionId: string, content: string, attachmentId?: string): Promise<ChatMessage>

  // File upload (chat attachments)
  reserveFile(
    sessionId: string,
    file: { name: string; mimeType: string; sizeBytes: number },
  ): Promise<FileReservation>
  finalizeFile(sessionId: string, fileId: string, hashHex: string): Promise<ChatAttachment>

  // Admissions
  loadPendingAdmissions(sessionId: string): Promise<PendingAdmission[]>
  admitParticipant(sessionId: string, admissionId: string): Promise<void>
  denyParticipant(sessionId: string, admissionId: string, reason?: string): Promise<void>

  // Moderation
  muteParticipant(sessionId: string, identity: string, muted: boolean): Promise<void>
  removeParticipant(sessionId: string, identity: string): Promise<void>
  promoteParticipant(sessionId: string, identity: string): Promise<void>
  /** Returns the user IDs (= LiveKit identities) of current co-hosts. */
  loadCoHosts(sessionId: string): Promise<string[]>

  // Host controls
  createShareLink(sessionId: string, ttlHours: number): Promise<ShareLink>
  endSession(sessionId: string): Promise<void>

  // Replayable audit events (used by useSessionEvents)
  emitEvent(
    sessionId: string,
    eventType: string,
    args: { targetUserId?: string; details?: Record<string, unknown> },
  ): Promise<void>

  // Engagement signals (HAND_RAISE etc.)
  emitEngagementSignal(
    sessionId: string,
    kind: string,
    details?: Record<string, unknown>,
  ): Promise<void>

  // Whiteboard
  loadWhiteboard(sessionId: string): Promise<WhiteboardSnapshot | null>
  saveWhiteboard(sessionId: string, version: number, snapshot: unknown): Promise<void>

  // Presenter alerts (host-only HUD). Returns unsubscribe.
  subscribePresenterAlerts(sessionId: string, onAlert: (alert: PresenterAlert) => void): () => void
  ackPresenterAlert(sessionId: string, alertId: string): Promise<void>
}

// ─── Default LMS implementation ─────────────────────────────────────────────

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { credentials: 'include', ...init })
  const json = (await res.json()) as { ok: boolean; data: T; error?: { message: string } }
  if (!json.ok) throw new Error(json.error?.message ?? `Request failed: ${input}`)
  return json.data
}

/**
 * Default client wired to this LMS's /api/classroom/sessions/[id]/* routes.
 * When extracting the room into another app, replace this with your own
 * implementation by passing it to <VideoRoomClientProvider>.
 */
export const defaultLmsVideoRoomClient: VideoRoomClient = {
  async getToken(sessionId, opts) {
    const url = `/api/classroom/sessions/${sessionId}/token`
    return jsonFetch<TokenResult>(url, {
      method: 'POST',
      body: opts?.shareToken ? JSON.stringify({ shareToken: opts.shareToken }) : undefined,
      headers: opts?.shareToken ? { 'Content-Type': 'application/json' } : undefined,
    })
  },

  async loadChat(sessionId, limit = 100) {
    const data = await jsonFetch<{
      messages: Array<{
        id: string
        userId: string
        content: string
        createdAt: string
        user: { name: string }
        attachment: ChatAttachment | null
      }>
    }>(`/api/classroom/sessions/${sessionId}/chat?limit=${limit}`)
    return data.messages.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.user.name,
      content: m.content,
      createdAt: m.createdAt,
      attachment: m.attachment,
    }))
  },

  async sendChat(sessionId, content, attachmentId) {
    const data = await jsonFetch<{
      message: ChatMessage & { user?: { name: string } }
    }>(`/api/classroom/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, attachmentId }),
    })
    return {
      id: data.message.id,
      userId: data.message.userId,
      userName: data.message.userName ?? data.message.user?.name ?? '',
      content: data.message.content,
      createdAt: data.message.createdAt,
      attachment: data.message.attachment,
    }
  },

  async reserveFile(sessionId, file) {
    return jsonFetch<FileReservation>(`/api/classroom/sessions/${sessionId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    })
  },

  async finalizeFile(sessionId, fileId, hashHex) {
    return jsonFetch<ChatAttachment>(
      `/api/classroom/sessions/${sessionId}/files/${fileId}/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashHex }),
      },
    )
  },

  async loadPendingAdmissions(sessionId) {
    const data = await jsonFetch<{ pending: PendingAdmission[] }>(
      `/api/classroom/sessions/${sessionId}/admissions`,
    )
    return data.pending
  },

  async admitParticipant(sessionId, admissionId) {
    await jsonFetch<unknown>(
      `/api/classroom/sessions/${sessionId}/admissions/${admissionId}/admit`,
      { method: 'POST' },
    )
  },

  async denyParticipant(sessionId, admissionId, reason) {
    await jsonFetch<unknown>(
      `/api/classroom/sessions/${sessionId}/admissions/${admissionId}/deny`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      },
    )
  },

  async muteParticipant(sessionId, identity, muted) {
    await jsonFetch<unknown>(
      `/api/classroom/sessions/${sessionId}/participants/${identity}/mute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted }),
      },
    )
  },

  async removeParticipant(sessionId, identity) {
    await jsonFetch<unknown>(
      `/api/classroom/sessions/${sessionId}/participants/${identity}`,
      { method: 'DELETE' },
    )
  },

  async promoteParticipant(sessionId, identity) {
    await jsonFetch<unknown>(
      `/api/classroom/sessions/${sessionId}/participants/${identity}/promote`,
      { method: 'POST' },
    )
  },

  async loadCoHosts(sessionId) {
    try {
      const data = await jsonFetch<{ coHostIds: string[] }>(
        `/api/classroom/sessions/${sessionId}/participants`,
      )
      return data.coHostIds
    } catch {
      return []
    }
  },

  async createShareLink(sessionId, ttlHours) {
    return jsonFetch<ShareLink>(`/api/classroom/sessions/${sessionId}/share-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttlHours }),
    })
  },

  async endSession(sessionId) {
    await fetch(`/api/classroom/sessions/${sessionId}/end`, {
      method: 'POST',
      credentials: 'include',
    })
  },

  async emitEvent(sessionId, eventType, args) {
    await fetch(`/api/classroom/sessions/${sessionId}/events`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType,
        targetUserId: args.targetUserId ?? undefined,
        details: args.details ?? undefined,
      }),
    }).catch(() => {/* best-effort — DC delivery already happened */})
  },

  async emitEngagementSignal(sessionId, kind, details) {
    await fetch(`/api/classroom/sessions/${sessionId}/engagement-signals`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, details }),
    }).catch(() => {/* best-effort */})
  },

  async loadWhiteboard(sessionId) {
    try {
      return await jsonFetch<WhiteboardSnapshot | null>(
        `/api/classroom/sessions/${sessionId}/whiteboard`,
      )
    } catch {
      return null
    }
  },

  async saveWhiteboard(sessionId, version, snapshot) {
    await jsonFetch<unknown>(`/api/classroom/sessions/${sessionId}/whiteboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, snapshot }),
    })
  },

  subscribePresenterAlerts(sessionId, onAlert) {
    if (typeof EventSource === 'undefined') return () => {/* no-op on SSR */}
    const es = new EventSource(
      `/api/classroom/sessions/${sessionId}/presenter-alerts`,
      { withCredentials: true },
    )
    es.addEventListener('alert', (ev) => {
      try {
        const alert = JSON.parse((ev as MessageEvent).data) as PresenterAlert
        onAlert(alert)
      } catch {/* ignore malformed event */}
    })
    return () => es.close()
  },

  async ackPresenterAlert(sessionId, alertId) {
    await fetch(
      `/api/classroom/sessions/${sessionId}/presenter-alerts/${alertId}/ack`,
      { method: 'POST', credentials: 'include' },
    ).catch(() => {/* SSE redelivers on failure */})
  },
}

// ─── React context ──────────────────────────────────────────────────────────

const VideoRoomClientContext = createContext<VideoRoomClient>(defaultLmsVideoRoomClient)

export function VideoRoomClientProvider({
  client = defaultLmsVideoRoomClient,
  children,
}: {
  client?: VideoRoomClient
  children: ReactNode
}) {
  return (
    <VideoRoomClientContext.Provider value={client}>
      {children}
    </VideoRoomClientContext.Provider>
  )
}

export function useVideoRoomClient(): VideoRoomClient {
  return useContext(VideoRoomClientContext)
}
