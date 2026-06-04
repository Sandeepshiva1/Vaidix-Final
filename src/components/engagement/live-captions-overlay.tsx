'use client';

// ════════════════════════════════════════════════════════════════════════════
// LiveCaptionsOverlay
// ════════════════════════════════════════════════════════════════════════════
// Subscribes to /api/classroom/sessions/[id]/live-captions SSE. Renders the
// most recent partial + final lines as a captioned overlay at the bottom of
// the video frame. Per-listener language selection: when the picked language
// differs from the broadcast `lang`, finalized segments are sent through
// /captions/translate (Gemini Flash + Redis cache, code-mix-preserving) and
// rendered in the chosen language.
//
// Persistence: enabled flag and chosen language live in localStorage so a
// single learner gets the same captions experience across page reloads and
// across sessions.

import { useEffect, useRef, useState } from 'react';
import { csrfHeaders } from '@/lib/csrf-client';

interface CaptionEvent {
  sessionId: string;
  startMs: number;
  endMs: number;
  text: string;
  lang: string;
  speaker?: string;
  partial?: boolean;
}

interface DisplayedSegment extends CaptionEvent {
  /** Translated text rendered in the listener's chosen language. */
  displayText: string;
  /** Status of the translation pipeline for this segment. */
  txStatus: 'native' | 'pending' | 'translated' | 'error';
}

const STORAGE_KEY_ENABLED = 'vaidix.liveCaptionsOn';
const STORAGE_KEY_LANG = 'vaidix.liveCaptionsLang';
const MAX_LINES = 2;

// Only languages Deepgram Nova-2 can natively transcribe.
// te / kn / ml / mr / bn / ur are NOT in Deepgram's language list — removed.
export const CAPTION_LANGS: Array<{ code: 'en' | 'hi' | 'ta'; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
];

export type CaptionLangCode = (typeof CAPTION_LANGS)[number]['code'];

function readStorage<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const v = window.localStorage.getItem(key);
  return (v as T | null) ?? fallback;
}

/** Reads the persisted enabled + lang from localStorage — call once on mount. */
export function readCaptionPrefs(): { enabled: boolean; lang: CaptionLangCode } {
  const enabled = readStorage(STORAGE_KEY_ENABLED, 'true') === 'true';
  const stored  = readStorage<string>(STORAGE_KEY_LANG, 'en');
  const valid   = CAPTION_LANGS.map((l) => l.code) as string[];
  const lang    = (valid.includes(stored) ? stored : 'en') as CaptionLangCode;
  return { enabled, lang };
}

/** Persists enabled + lang to localStorage. */
export function saveCaptionPrefs(enabled: boolean, lang: CaptionLangCode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? 'true' : 'false');
  window.localStorage.setItem(STORAGE_KEY_LANG, lang);
}

/** Pure caption display — no controls. Controls live in the top bar (CaptionControls). */
export function LiveCaptionsOverlay({
  sessionId,
  enabled,
  chosenLang,
}: {
  sessionId: string
  enabled: boolean
  chosenLang: CaptionLangCode
}) {
  const [finals, setFinals] = useState<DisplayedSegment[]>([]);
  const [partial, setPartial] = useState<DisplayedSegment | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // When the listener picks a different language, clear out segments that
  // were rendered in the previous language so the user doesn't briefly see
  // stale English while pending Telugu translations arrive. Using the
  // "in-render setState on prop change" pattern (React docs / RFC 6394)
  // rather than an effect — effects are not the right tool for synchronizing
  // local state to a prop change, and the lint rule
  // `react-hooks/set-state-in-effect` enforces this.
  const [renderedLang, setRenderedLang] = useState<CaptionLangCode>(chosenLang);
  if (renderedLang !== chosenLang) {
    setRenderedLang(chosenLang);
    setFinals([]);
    setPartial(null);
  }

  // Fan-in from SSE.
  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const es = new EventSource(`/api/classroom/sessions/${sessionId}/live-captions`, {
      withCredentials: true,
    });
    esRef.current = es;

    const handle = async (raw: string) => {
      let c: CaptionEvent;
      try {
        c = JSON.parse(raw) as CaptionEvent;
      } catch {
        return;
      }
      const seg: DisplayedSegment = {
        ...c,
        displayText: c.text,
        txStatus: c.lang === chosenLang ? 'native' : 'pending',
      };
      if (c.partial) {
        setPartial(seg);
        return;
      }
      setPartial(null);
      setFinals((prev) => [...prev, seg].slice(-MAX_LINES));

      if (seg.txStatus === 'pending') {
        try {
          const txRes = await fetch(
            `/api/classroom/sessions/${sessionId}/captions/translate`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
              body: JSON.stringify({ text: c.text, from: c.lang, to: chosenLang }),
            },
          );
          if (!txRes.ok) {
            setFinals((prev) =>
              prev.map((p) =>
                p.startMs === seg.startMs && p.endMs === seg.endMs
                  ? { ...p, txStatus: 'error' as const }
                  : p,
              ),
            );
            return;
          }
          const json = (await txRes.json()) as { ok: true; data: { translated: string } };
          setFinals((prev) =>
            prev.map((p) =>
              p.startMs === seg.startMs && p.endMs === seg.endMs
                ? { ...p, displayText: json.data.translated, txStatus: 'translated' as const }
                : p,
            ),
          );
        } catch {
          setFinals((prev) =>
            prev.map((p) =>
              p.startMs === seg.startMs && p.endMs === seg.endMs
                ? { ...p, txStatus: 'error' as const }
                : p,
            ),
          );
        }
      }
    };

    es.addEventListener('caption', (ev) => {
      void handle((ev as MessageEvent).data);
    });
    es.addEventListener('error', () => {
      // Browser auto-reconnects; nothing to do here.
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [enabled, sessionId, chosenLang]);

  if (!enabled || (finals.length === 0 && !partial)) return null;

  return (
    <div
      data-testid="live-captions-overlay"
      className="pointer-events-none absolute bottom-20 left-0 right-0 z-20 flex justify-center px-6"
    >
      <div className="max-w-3xl space-y-1 rounded-md bg-black/70 px-4 py-2 text-center text-base text-white backdrop-blur">
        {finals.map((c, idx) => (
          <p
            key={`${c.startMs}-${idx}`}
            data-testid="caption-line"
            data-speaker={c.speaker ?? ''}
            className="leading-snug"
          >
            {c.speaker ? <span className="opacity-70">{c.speaker}: </span> : null}
            <span className={c.txStatus === 'pending' ? 'opacity-60' : undefined}>
              {c.displayText}
            </span>
            {c.txStatus === 'error' && (
              <span className="ml-2 text-xs text-amber-300">[translation failed]</span>
            )}
          </p>
        ))}
        {partial && (
          <p
            data-testid="caption-line-partial"
            data-speaker={partial.speaker ?? ''}
            className="leading-snug opacity-80 italic"
          >
            {partial.speaker ? <span className="opacity-70">{partial.speaker}: </span> : null}
            {partial.displayText}
          </p>
        )}
      </div>
    </div>
  );
}

/** CC toggle + language selector — rendered inside the top bar, not floating over video. */
export function CaptionControls({
  enabled,
  lang,
  onToggle,
  onLangChange,
}: {
  enabled: boolean
  lang: CaptionLangCode
  onToggle: () => void
  onLangChange: (l: CaptionLangCode) => void
}) {
  const langLabel = CAPTION_LANGS.find((l) => l.code === lang)?.label ?? 'English';
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="rounded-md border border-white/10 bg-black/50 px-2 py-1 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/70"
        aria-label={enabled ? 'Hide captions' : 'Show captions'}
      >
        {enabled ? 'CC: ON' : 'CC: OFF'}
      </button>
      {enabled && (
        <label className="flex items-center gap-1 rounded-md border border-white/10 bg-black/50 px-2 py-1 text-xs text-white backdrop-blur">
          <span className="opacity-70" aria-hidden="true">🌐</span>
          <select
            value={lang}
            onChange={(e) => onLangChange(e.target.value as CaptionLangCode)}
            className="bg-transparent pr-1 outline-none"
            aria-label="Caption language"
            title={`Captions in ${langLabel}`}
          >
            {CAPTION_LANGS.map((l) => (
              <option key={l.code} value={l.code} className="bg-black text-white">
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
