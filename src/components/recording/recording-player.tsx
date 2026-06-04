'use client';

// ════════════════════════════════════════════════════════════════════════════
// RecordingPlayer — HLS player (caption-lang is controlled by parent)
// ════════════════════════════════════════════════════════════════════════════
// Native <video> + hls.js. Native HLS on Safari/iOS, hls.js polyfill elsewhere.
// Caption language is lifted to the parent (RecordingViewer) so the toggle UI
// can live in the action bar rather than below the player.

import { useEffect, useRef, useState } from 'react';

interface CaptionTrack {
  language: string;
  source: string;
  vttUrl: string | null;
}

interface RecordingPlayerProps {
  hlsUrl: string;
  posterUrl?: string | null;
  tracks?: CaptionTrack[];
  /** Fires on every `timeupdate` event with the current second. */
  onTimeUpdate?: (sec: number) => void;
  /** Mutable ref the player attaches a `seek(sec)` fn to. */
  seekRef?: { current: ((sec: number) => void) | null };
  /** Controlled: which language to show ('off' = disabled). */
  activeLang: string;
}

export function RecordingPlayer({ hlsUrl, posterUrl, tracks = [], onTimeUpdate, seekRef, activeLang }: RecordingPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  // Attach HLS source
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    setError(null);

    async function attach() {
      if (!video) return;
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        return;
      }
      try {
        const mod = await import('hls.js');
        const Hls = (mod as { default: unknown }).default as unknown as {
          isSupported: () => boolean;
          new (cfg: unknown): { loadSource: (u: string) => void; attachMedia: (v: HTMLVideoElement) => void; destroy: () => void };
        };
        if (cancelled) return;
        if (!Hls.isSupported()) { setError('HLS playback not supported in this browser.'); return; }
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void attach();

    return () => {
      cancelled = true;
      const hls = hlsRef.current as { destroy?: () => void } | null;
      hls?.destroy?.();
      hlsRef.current = null;
      if (video) { video.removeAttribute('src'); video.load(); }
    };
  }, [hlsUrl]);

  // Expose time updates and seek handle
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => onTimeUpdate?.(video.currentTime);
    video.addEventListener('timeupdate', onTime);
    if (seekRef) {
      seekRef.current = (sec: number) => {
        video.currentTime = Math.max(0, sec);
        void video.play().catch(() => {});
      };
    }
    return () => {
      video.removeEventListener('timeupdate', onTime);
      if (seekRef) seekRef.current = null;
    };
  }, [onTimeUpdate, seekRef]);

  // Switch caption track when activeLang changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    Array.from(video.textTracks).forEach((tt) => {
      tt.mode = tt.language === activeLang ? 'showing' : 'hidden';
    });
  }, [activeLang, tracks]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        controls
        poster={posterUrl ?? undefined}
        className="h-full w-full"
        preload="metadata"
        playsInline
      >
        {tracks
          .filter((t) => !!t.vttUrl)
          .map((t) => (
            <track
              key={t.language}
              kind="captions"
              src={t.vttUrl ?? undefined}
              srcLang={t.language}
              label={t.language.toUpperCase()}
              default={t.language === activeLang}
            />
          ))}
      </video>
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-sm text-red-400">Playback error: {error}</p>
        </div>
      )}
    </div>
  );
}
