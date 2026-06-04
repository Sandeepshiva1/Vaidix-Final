'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LiveKitRoom,
  useTracks,
  useParticipants,
  ParticipantTile,
  TrackRefContext,
} from '@livekit/components-react';
import { Track, type Participant } from 'livekit-client';
import '@livekit/components-styles';
import { isAgentParticipant } from '@/lib/livekit-helpers';
import styles from '../medlearn.module.css';
import { TranscriptPanel } from './transcript-panel';

// Module-level dedupe cache. React StrictMode double-mounts every effect in
// dev (and the legitimate "navigate-away-and-back" case also re-mounts the
// component). Without this guard each mount POSTs /token again, the server
// mints a fresh JWT and writes a fresh audit row twice. The cache shares a
// single in-flight promise across mounts within `TOKEN_CACHE_TTL_MS`, then
// clears so a real re-join (e.g. after a long pause) still works.
interface TokenResponse {
  ok: boolean;
  status: number;
  body: {
    state?: 'JOINED' | 'WAITING' | 'DENIED';
    token?: string;
    url?: string;
    role?: string;
    reason?: string | null;
    message?: string;
  };
}
const TOKEN_CACHE_TTL_MS = 30_000;
const tokenCache = new Map<string, Promise<TokenResponse>>();

function fetchSessionToken(sessionId: string): Promise<TokenResponse> {
  const cached = tokenCache.get(sessionId);
  if (cached) return cached;
  const promise = (async (): Promise<TokenResponse> => {
    const res = await fetch(`/api/classroom/sessions/${sessionId}/token`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  })();
  tokenCache.set(sessionId, promise);
  // Drop the entry after the TTL regardless of resolution — failures
  // shouldn't block a retry, and successes shouldn't pin a stale JWT.
  setTimeout(() => {
    if (tokenCache.get(sessionId) === promise) tokenCache.delete(sessionId);
  }, TOKEN_CACHE_TTL_MS);
  // Also drop immediately on rejection so the next mount can retry.
  promise.catch(() => tokenCache.delete(sessionId));
  return promise;
}

interface Props {
  sessionId: string;
  hostId: string;
  coHostIds: string[];
  /** Render-prop slot — the parent (LiveScreen) renders the top bar containing
   *  title, timer, tool buttons and End Session. We just render the stage body. */
  children?: never;
}

type TokenState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'denied'; reason: string | null }
  | { kind: 'waiting' }
  | { kind: 'ready'; token: string; url: string; role: string };

/**
 * Live LiveKit stage for the MedLearn workflow. Fetches a server-minted token,
 * mounts `<LiveKitRoom>`, then renders our minimal layout:
 *   • LEFT — host (top) and up to two co-hosts (middle/bottom)
 *   • RIGHT — audience grid
 *   • BOTTOM or RIGHT-DOCKED — draggable live transcript
 */
export function LiveKitStage({ sessionId, hostId, coHostIds }: Props) {
  const [state, setState] = useState<TokenState>({ kind: 'loading' });
  const [dock, setDock] = useState<'bottom' | 'right'>(() => readDock());
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ok, status, body } = await fetchSessionToken(sessionId);
        if (cancelled) return;
        if (!ok) {
          setState({ kind: 'error', message: body?.message ?? `Failed (${status})` });
          return;
        }
        if (body.state === 'DENIED') return setState({ kind: 'denied', reason: body.reason ?? null });
        if (body.state === 'WAITING') return setState({ kind: 'waiting' });
        if (body.state === 'JOINED' && body.token && body.url) {
          return setState({ kind: 'ready', token: body.token, url: body.url, role: body.role ?? '' });
        }
        setState({ kind: 'error', message: 'Unknown response' });
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      // Intentionally do not abort the underlying fetch — the module-level
      // cache may have other mounts awaiting it (StrictMode double-mount).
    };
  }, [sessionId]);

  useEffect(() => {
    try { localStorage.setItem('medlearn:transcript-dock', dock); } catch { /* SSR safe */ }
  }, [dock]);

  if (state.kind === 'loading') return <StageStatus message="Connecting to the room…" />;
  if (state.kind === 'error') return <StageStatus message={`Could not join: ${state.message}`} />;
  if (state.kind === 'denied') return <StageStatus message={state.reason ?? 'Access denied.'} />;
  if (state.kind === 'waiting') return <StageStatus message="Waiting for host admission…" />;

  return (
    <LiveKitRoom
      token={state.token}
      serverUrl={state.url}
      connect
      video
      audio
      className={styles.liveStageRoot}
      data-lk-theme="default"
    >
      <StageBody
        hostId={hostId}
        coHostIds={coHostIds}
        sessionId={sessionId}
        dock={dock}
        dragging={dragging}
        onDockChange={setDock}
        onDragStateChange={setDragging}
      />
    </LiveKitRoom>
  );
}

interface StageBodyProps {
  hostId: string;
  coHostIds: string[];
  sessionId: string;
  dock: 'bottom' | 'right';
  dragging: boolean;
  onDockChange: (dock: 'bottom' | 'right') => void;
  onDragStateChange: (dragging: boolean) => void;
}

function StageBody({ hostId, coHostIds, sessionId, dock, dragging, onDockChange, onDragStateChange }: StageBodyProps) {
  const allParticipants = useParticipants();
  const participants = allParticipants.filter((p) => !isAgentParticipant(p));
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);

  const buckets = useMemo(() => bucketize(participants, hostId, coHostIds), [participants, hostId, coHostIds]);

  // Per-participant track lookup so we can render either the live video or
  // a placeholder when the camera is off / not yet published.
  const trackFor = (p: Participant) =>
    cameraTracks.find((t) => t.participant.identity === p.identity);

  return (
    <div className={`${styles.stage} ${dock === 'right' ? styles.stageRightDocked : ''}`}>
      <div className={styles.panelCol}>
        <PanelTile label="Presenter" participant={buckets.host} track={buckets.host ? trackFor(buckets.host) : undefined} />
        <PanelTile label="Moderator" participant={buckets.coHosts[0]} track={buckets.coHosts[0] ? trackFor(buckets.coHosts[0]) : undefined} />
        <PanelTile label="Panel" participant={buckets.coHosts[1]} track={buckets.coHosts[1] ? trackFor(buckets.coHosts[1]) : undefined} />
      </div>

      <DropTarget
        active={dragging && dock !== 'bottom'}
        canAccept
        onDrop={() => onDockChange('right')}
        className={styles.audienceCol}
      >
        <header className={styles.audienceColHeader}>
          <span>Audience</span>
          <span>{buckets.audience.length} joined</span>
        </header>
        {buckets.audience.length === 0 ? (
          <div className={styles.audienceEmpty}>Audience tiles appear here as learners join.</div>
        ) : (
          <div className={styles.audienceGrid}>
            {buckets.audience.map((p) => (
              <AudienceTile key={p.identity} participant={p} track={trackFor(p)} />
            ))}
          </div>
        )}
      </DropTarget>

      <DropTarget
        active={dragging && dock !== (dock === 'right' ? 'bottom' : 'right')}
        canAccept
        onDrop={() => onDockChange(dock === 'right' ? 'bottom' : 'right')}
        className={`${styles.transcriptDock} ${dock === 'right' ? styles.transcriptDockRight : styles.transcriptDockBottom}`}
      >
        <TranscriptPanel
          sessionId={sessionId}
          dock={dock}
          onDockChange={onDockChange}
          onDragStateChange={onDragStateChange}
        />
      </DropTarget>
    </div>
  );
}

function DropTarget({
  active, canAccept, onDrop, className, children,
}: {
  active: boolean;
  canAccept: boolean;
  onDrop: () => void;
  className: string;
  children: React.ReactNode;
}) {
  const handle = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAccept) return;
    if (e.dataTransfer.types.includes('application/x-medlearn-transcript')) {
      e.preventDefault();
    }
  };
  return (
    <div
      className={`${className} ${styles.dropZone} ${active ? styles.dropZoneActive : ''}`}
      onDragOver={handle}
      onDragEnter={handle}
      onDrop={(e) => {
        if (!canAccept) return;
        if (e.dataTransfer.getData('application/x-medlearn-transcript')) {
          e.preventDefault();
          onDrop();
        }
      }}
    >
      {children}
    </div>
  );
}

function PanelTile({
  label,
  participant,
  track,
}: {
  label: string;
  participant: Participant | undefined;
  track: ReturnType<typeof useTracks>[number] | undefined;
}) {
  if (!participant) {
    return (
      <div className={styles.panelEmpty}>
        <span>{label}<br />— not yet joined —</span>
      </div>
    );
  }
  const initials = initialsOf(participant.name ?? participant.identity);
  const speaking = participant.isSpeaking;
  return (
    <div className={`${styles.tile} ${styles.tilePanel} ${speaking ? styles.tileSpeaking : ''}`}>
      {track && track.publication?.isSubscribed && !track.publication.isMuted ? (
        <TrackRefContext.Provider value={track}>
          <ParticipantTile className={styles.tileVideo} disableSpeakingIndicator />
        </TrackRefContext.Provider>
      ) : (
        <div className={styles.tilePlaceholder}>{initials}</div>
      )}
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileName}>
        {participant.name || participant.identity}
        {participant.isMicrophoneEnabled === false && <MicMutedIcon />}
      </span>
    </div>
  );
}

function AudienceTile({
  participant,
  track,
}: {
  participant: Participant;
  track: ReturnType<typeof useTracks>[number] | undefined;
}) {
  const initials = initialsOf(participant.name ?? participant.identity);
  const speaking = participant.isSpeaking;
  return (
    <div className={`${styles.tile} ${speaking ? styles.tileSpeaking : ''}`}>
      {track && track.publication?.isSubscribed && !track.publication.isMuted ? (
        <TrackRefContext.Provider value={track}>
          <ParticipantTile className={styles.tileVideo} disableSpeakingIndicator />
        </TrackRefContext.Provider>
      ) : (
        <div className={`${styles.tilePlaceholder} ${styles.tilePlaceholderSm}`}>{initials}</div>
      )}
      <span className={styles.tileName}>
        {participant.name || participant.identity}
        {participant.isMicrophoneEnabled === false && <MicMutedIcon />}
      </span>
    </div>
  );
}

function StageStatus({ message }: { message: string }) {
  return (
    <div className={styles.liveStageRoot} style={{ display: 'grid', placeItems: 'center', padding: 48 }}>
      <div style={{ textAlign: 'center', color: 'var(--on-surface-muted)', maxWidth: 360 }}>
        <p style={{ fontFamily: 'var(--font-jakarta), system-ui, sans-serif', fontSize: 15 }}>{message}</p>
      </div>
    </div>
  );
}

function MicMutedIcon() {
  return (
    <span className={styles.tileMicMuted} aria-label="Microphone muted" title="Microphone muted">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="m1 1 22 22" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      </svg>
    </span>
  );
}

function bucketize(
  participants: Participant[],
  hostId: string,
  coHostIds: string[],
): { host: Participant | undefined; coHosts: Participant[]; audience: Participant[] } {
  let host: Participant | undefined;
  const coHosts: Participant[] = [];
  const audience: Participant[] = [];
  const coSet = new Set(coHostIds);
  for (const p of participants) {
    if (p.identity === hostId) host = p;
    else if (coSet.has(p.identity)) coHosts.push(p);
    else audience.push(p);
  }
  return { host, coHosts: coHosts.slice(0, 2), audience };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function readDock(): 'bottom' | 'right' {
  if (typeof window === 'undefined') return 'bottom';
  try {
    const v = localStorage.getItem('medlearn:transcript-dock');
    return v === 'right' ? 'right' : 'bottom';
  } catch {
    return 'bottom';
  }
}
