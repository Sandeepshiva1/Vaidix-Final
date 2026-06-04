'use client';

// ════════════════════════════════════════════════════════════════════════════
// LeaderboardPanel
// ════════════════════════════════════════════════════════════════════════════
// Polls /api/classroom/sessions/[id]/leaderboard every 5s. Anonymous toggle
// flips ?anonymous=true (resident names replaced with "Resident #N").

import { useCallback, useEffect, useState } from 'react';

interface LeaderboardEntry {
  userId: string;
  name: string | null;
  role: string | null;
  points: number;
  breakdown: { correct: number; participation: number; chats: number; raises: number };
}

const POLL_INTERVAL_MS = 5000;

export function LeaderboardPanel({ sessionId }: { sessionId: string }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [anonymous, setAnonymous] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/classroom/sessions/${sessionId}/leaderboard?anonymous=${anonymous}`,
        { cache: 'no-store' }
      );
      const json = (await res.json()) as {
        ok: boolean;
        data?: { leaderboard: LeaderboardEntry[] };
      };
      if (json.ok && json.data) setEntries(json.data.leaderboard);
    } finally {
      setLoading(false);
    }
  }, [sessionId, anonymous]);

  useEffect(() => {
    void fetchBoard();
    const iv = setInterval(fetchBoard, POLL_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [fetchBoard]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm font-medium">Leaderboard</p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="h-3 w-3"
          />
          Anonymous
        </label>
      </div>
      {loading ? (
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No scores yet — answer hooks or chat to earn points.</p>
      ) : (
        <ul className="flex-1 divide-y overflow-y-auto">
          {entries.map((e, idx) => (
            <li key={e.userId} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-6 text-center text-xs font-semibold text-muted-foreground">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm">{e.name ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    ✓{e.breakdown.correct} · ↩{e.breakdown.participation} · 💬{e.breakdown.chats} · ✋{e.breakdown.raises}
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-foreground px-2 py-0.5 text-xs font-medium text-background">
                {e.points}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
