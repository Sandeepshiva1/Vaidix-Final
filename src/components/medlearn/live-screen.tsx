'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import styles from './medlearn.module.css';
import { endSessionAction } from './actions';
import { IconArrowLeft, IconPoll, IconBolt, IconChat } from './icons';
import { LiveKitStage } from './live/livekit-stage';

interface Props {
  sessionId: string;
  title: string;
  startedAt: Date | null;
  isHost: boolean;
  hostId: string;
  coHostIds: string[];
}

type ToolKey = 'poll' | 'sim' | 'qa' | null;

export function LiveScreen({ sessionId, title, startedAt, isHost, hostId, coHostIds }: Props) {
  const router = useRouter();
  const [activeTool, setActiveTool] = useState<ToolKey>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const elapsed = useElapsed(startedAt);

  const endSession = () => {
    setError(null);
    startTransition(async () => {
      const result = await endSessionAction(sessionId);
      if (!result.ok) { setError(result.error); return; }
      router.push(`/session/${sessionId}/post`);
    });
  };

  return (
    <div className={styles.liveRoot}>
      <div className={styles.liveBar}>
        <button
          type="button"
          className={styles.slideNavBtn}
          onClick={() => router.push(`/session/${sessionId}/pre`)}
          aria-label="Back to preparation"
        >
          <IconArrowLeft size={18} />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, marginRight: 'auto' }}>
          <span className={styles.liveBarTitle} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </span>
          <span className={styles.liveBarIndicator}>
            <span className={styles.livePulseDot} aria-hidden />
            Live
          </span>
        </div>

        <div className={styles.barTools}>
          <BarTool
            active={activeTool === 'poll'}
            onClick={() => setActiveTool((t) => (t === 'poll' ? null : 'poll'))}
            icon={<IconPoll size={16} />}
            label="Poll"
          />
          <BarTool
            active={activeTool === 'sim'}
            onClick={() => setActiveTool((t) => (t === 'sim' ? null : 'sim'))}
            icon={<IconBolt size={16} />}
            label="Sim"
          />
          <BarTool
            active={activeTool === 'qa'}
            onClick={() => setActiveTool((t) => (t === 'qa' ? null : 'qa'))}
            icon={<IconChat size={16} />}
            label="Q&A"
          />
        </div>

        <span className={styles.liveBarTimer}>{elapsed}</span>
        {isHost && (
          <button type="button" className={styles.liveEnd} onClick={endSession} disabled={pending}>
            {pending ? 'Ending…' : 'End Session'}
          </button>
        )}
      </div>

      <LiveKitStage sessionId={sessionId} hostId={hostId} coHostIds={coHostIds} />

      {error && (
        <p role="alert" style={{ color: 'var(--error)', fontSize: 13, padding: '8px 24px' }}>{error}</p>
      )}
    </div>
  );
}

function BarTool({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`${styles.barToolBtn} ${active ? styles.barToolBtnActive : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function useElapsed(startedAt: Date | null): string {
  // `now` stays null on the server so the SSR markup matches the first client
  // paint (avoids hydration drift). The interval below switches it to a real
  // timestamp on the first tick, then updates every second.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!startedAt || now === null) return '00:00:00';
  const diff = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));
  const h = String(Math.floor(diff / 3600)).padStart(2, '0');
  const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
  const s = String(diff % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
