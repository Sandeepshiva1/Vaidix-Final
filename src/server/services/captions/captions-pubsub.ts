// ════════════════════════════════════════════════════════════════════════════
// Captions pub/sub helpers — Stream B9
// ════════════════════════════════════════════════════════════════════════════
// Shared types + Redis channel name. Imported by both the SSE GET route
// and the ingest POST route. Lives outside the route directory so Next.js
// route detection doesn't treat extra exports as a code smell.

export interface LiveCaptionSegment {
  sessionId: string;
  startMs: number;
  endMs: number;
  text: string;
  lang: 'en' | 'hi' | 'te' | 'ta' | 'kn' | 'ml' | 'mr' | 'bn' | 'ur';
  speaker?: string;
  partial?: boolean;
}

export function liveCaptionChannel(sessionId: string): string {
  return `caption:${sessionId}`;
}
