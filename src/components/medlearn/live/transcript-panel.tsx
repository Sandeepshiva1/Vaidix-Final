'use client';

import { useEffect, useRef, useState } from 'react';
import styles from '../medlearn.module.css';

interface CaptionSegment {
  id: string;
  speaker: string | null;
  text: string;
  ts: number;
}

interface Props {
  sessionId: string;
  /** Where the transcript currently lives — controlled by the parent. */
  dock: 'bottom' | 'right';
  /** Parent dock-target swap. */
  onDockChange: (dock: 'bottom' | 'right') => void;
  /** Parent should set this true when a drag is active so it can render
   *  drop zones in the alternative slot. */
  onDragStateChange: (dragging: boolean) => void;
}

const MAX_SEGMENTS = 40;

/**
 * Live transcription panel. Streams from /api/classroom/sessions/[id]/live-captions
 * (SSE) and renders a scrolling caption feed. Drag the header to move the panel
 * between the bottom strip and the right column (Teams-style snap).
 */
export function TranscriptPanel({ sessionId, dock, onDockChange, onDragStateChange }: Props) {
  const [segments, setSegments] = useState<CaptionSegment[]>([]);
  const [connected, setConnected] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // SSE caption feed
  useEffect(() => {
    let stopped = false;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`/api/classroom/sessions/${sessionId}/live-captions`);
      es.addEventListener('hello', () => { if (!stopped) setConnected(true); });
      es.addEventListener('caption', (ev) => {
        if (stopped) return;
        const data = parseCaption(ev as MessageEvent);
        if (data) {
          setSegments((prev) => {
            const next = [...prev, data];
            return next.length > MAX_SEGMENTS ? next.slice(-MAX_SEGMENTS) : next;
          });
        }
      });
      es.addEventListener('error', () => { if (!stopped) setConnected(false); });
    } catch {
      // EventSource may be unavailable in non-browser contexts; ignore.
    }
    return () => {
      stopped = true;
      es?.close();
    };
  }, [sessionId]);

  // Auto-scroll on new segment
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [segments.length]);

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-medlearn-transcript', '1');
    e.dataTransfer.effectAllowed = 'move';
    onDragStateChange(true);
  };
  const onDragEnd = () => onDragStateChange(false);

  const toggleDock = () => onDockChange(dock === 'bottom' ? 'right' : 'bottom');

  return (
    <section className={styles.transcript}>
      <div
        className={styles.transcriptHeader}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        role="button"
        tabIndex={0}
        aria-label="Drag to move transcript"
      >
        <span className={styles.transcriptHeaderTitle}>Live transcript</span>
        <span className={styles.transcriptStatus} aria-hidden={!connected}>
          {connected && <span className={styles.transcriptStatusDot} />}
          {connected ? 'Listening' : 'Connecting…'}
        </span>
        <button type="button" className={styles.transcriptDockBtn} onClick={toggleDock}>
          Dock {dock === 'bottom' ? 'right' : 'bottom'}
        </button>
      </div>
      <div className={styles.transcriptBody} ref={bodyRef}>
        {segments.length === 0 ? (
          <p className={styles.transcriptEmpty}>Captions will appear here as the session starts.</p>
        ) : (
          segments.map((seg) => (
            <div key={seg.id} className={styles.transcriptSeg}>
              {seg.speaker && <span className={styles.transcriptSpeaker}>{seg.speaker}</span>}
              <span className={styles.transcriptText}>{seg.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function parseCaption(ev: MessageEvent): CaptionSegment | null {
  try {
    const payload = JSON.parse(ev.data) as {
      id?: string;
      speaker?: string | null;
      text?: string;
      content?: string;
      ts?: number;
    };
    const text = (payload.text ?? payload.content ?? '').trim();
    if (!text) return null;
    return {
      id: payload.id ?? `${payload.ts ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      speaker: payload.speaker ?? null,
      text,
      ts: payload.ts ?? Date.now(),
    };
  } catch {
    return null;
  }
}
