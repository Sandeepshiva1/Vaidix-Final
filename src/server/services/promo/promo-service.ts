// ════════════════════════════════════════════════════════════════════════════
// AI Promo Generator — Stream A9
// ════════════════════════════════════════════════════════════════════════════
// Faculty triggers /api/promo/generate?sessionId=... → service renders three
// SVG templates (flyer, whatsapp_banner, instagram_card) populated with
// session metadata + Gemini-generated copy (subtitle + hook line). Each asset
// is stored in MinIO + a Document row is created with route=PROMO_ASSET so it
// surfaces in the faculty document library.
//
// Copy generation: Gemini-2.5-flash with a marketing-meets-clinical persona.
// Falls back to a deterministic heuristic when GEMINI_API_KEY is absent or
// Gemini fails. SVG output is browser-renderable and downloadable; PNG
// conversion via Chromium is a follow-up (puppeteer-core in roadmap).

import { db } from '@/lib/db';
import { Role, DocumentKind, DocumentRoute, DocumentStatus } from '@prisma/client';
import { s3, BUCKET } from '@/lib/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';
import { geminiGenerate, GeminiUnavailableError, GeminiUnparseableError, tryParseJson } from '@/server/services/ai/gemini';
import { loadPrompt } from '@/server/prompts/loader';

export type PromoTemplate = 'flyer' | 'whatsapp_banner' | 'instagram_card';

const TEMPLATE_DIMS: Record<PromoTemplate, { w: number; h: number }> = {
  flyer: { w: 1200, h: 1500 },
  whatsapp_banner: { w: 1080, h: 1920 },
  instagram_card: { w: 1080, h: 1080 },
};

/** Re-exports for the W6.8 teaser-video pipeline so it can reuse the
 * Gemini-with-heuristic-fallback copy builder + the SVG palette without
 * duplicating logic. Keep the implementations private to this file. */
export type { PromoCopy };
export { buildCopy, escapeXml, PALETTE };

export class PromoAccessError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID', message: string) {
    super(message);
  }
}

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

interface PromoCopy {
  title: string;
  subtitle: string;
  hook: string;
  hostName: string;
  hostRole: string | null;
  whenLine: string;
  /** 2-4 short bullets to render as highlights on the flyer. Each <= 60 chars. */
  highlights: string[];
  /** Optional program label e.g. "LVPEI Grand Rounds 2025". */
  programLabel: string | null;
  /** Optional tag chips like ["Uveitis", "CME"]. */
  tags: string[];
  /** Provider-neutral: 'ai' = upstream copy generator; 'heuristic' = rules-only fallback. */
  source?: 'ai' | 'heuristic';
}

// System prompt lives in src/server/prompts/_base/op-promo-copy.md; loaded
// fresh per call (cached in-memory). Edit the .md to update the prompt — no
// TypeScript change needed.

async function geminiPromoCopy(input: {
  title: string;
  description: string | null;
  hostName: string;
  scheduledStart: Date;
  objectives?: Array<{ text: string; blooms: number }>;
  prereqItems?: Array<{ text: string; required: boolean }>;
  studyMaterial?: Array<{ kind: string; title: string }>;
  topPreQuestions?: Array<{ content: string; voteCount: number }>;
  tags?: string[];
}): Promise<{ subtitle: string; hook: string; highlights: string[] }> {
  const objectivesBlock = input.objectives && input.objectives.length > 0
    ? `\n\nLearning objectives (the curator's stated goals — Bloom's level in brackets):\n${input.objectives
        .map((o, i) => `${i + 1}. ${o.text} [Bloom ${o.blooms}]`)
        .join('\n')}`
    : '';

  const studyBlock = input.studyMaterial && input.studyMaterial.length > 0
    ? `\n\nPre-session study material residents are expected to review:\n${input.studyMaterial
        .map((m, i) => `${i + 1}. (${m.kind}) ${m.title}`)
        .join('\n')}`
    : '';

  const questionsBlock = input.topPreQuestions && input.topPreQuestions.length > 0
    ? `\n\nTop pre-class questions from residents (votes in brackets — strongest signal of demand):\n${input.topPreQuestions
        .map((q, i) => `${i + 1}. ${q.content} [${q.voteCount} votes]`)
        .join('\n')}`
    : '';

  const prereqsBlock = input.prereqItems && input.prereqItems.length > 0
    ? `\n\nPrerequisites residents are expected to have:\n${input.prereqItems
        .map((p, i) => `${i + 1}. ${p.text}${p.required ? ' (required)' : ' (optional)'}`)
        .join('\n')}`
    : '';

  const tagsLine = input.tags && input.tags.length > 0
    ? `\nSub-specialty tags: ${input.tags.join(', ')}`
    : '';

  const userPrompt = `Session title: ${input.title}
Host: ${input.hostName}
When: ${input.scheduledStart.toISOString()}${tagsLine}
Description: ${input.description ?? '(none provided)'}${objectivesBlock}${prereqsBlock}${studyBlock}${questionsBlock}

Return JSON only.`;
  const prompt = await loadPrompt('op-promo-copy');
  const text = await geminiGenerate({
    systemInstruction: prompt.text,
    userParts: [{ text: userPrompt }],
    responseMimeType: 'application/json',
    temperature: 0.6,
  });
  const parsed = tryParseJson<{ subtitle?: string; hook?: string; highlights?: unknown }>(text);
  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights
        .filter((h): h is string => typeof h === 'string')
        .map((h) => h.trim().slice(0, 60))
        .filter((h) => h.length > 0)
        .slice(0, 4)
    : [];
  return {
    subtitle: typeof parsed.subtitle === 'string' && parsed.subtitle.length > 0
      ? parsed.subtitle.slice(0, 120)
      : 'Live clinical learning session',
    hook: typeof parsed.hook === 'string' && parsed.hook.length > 0
      ? parsed.hook.slice(0, 90)
      : 'Hands-on. Case-based. Real outcomes.',
    highlights,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Heuristic fallback when Gemini is absent or fails. Even without an LLM we
 *  prefer real session signals over canned strings: the first objective makes
 *  a stronger subtitle than "Live clinical learning session", and the
 *  top-voted resident pre-question makes a real hook. */
function heuristicCopy(input: {
  title: string;
  description: string | null;
  hostName: string;
  hostRole?: string | null;
  scheduledStart: Date;
  objectives?: Array<{ text: string; blooms: number }>;
  topPreQuestions?: Array<{ content: string; voteCount: number }>;
  tags?: string[];
  programLabel?: string | null;
}): PromoCopy {
  // Promo copy is generated server-side and rendered as plain text on the
  // share card / Slack post. Pin the timezone explicitly so the displayed
  // hours match the residency's local clock regardless of where this code
  // happens to run (Docker UTC in dev, ap-south-1 in prod). Same root cause
  // as the QA #14 notification bug.
  const dateLine = input.scheduledStart.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
  const timeLine = input.scheduledStart.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  const firstObj = input.objectives?.[0]?.text;
  const subtitle =
    firstObj?.slice(0, 90).trim() ||
    input.description?.split(/[.!?]/)[0]?.slice(0, 90).trim() ||
    'Live clinical learning session';

  const topQ = input.topPreQuestions?.[0]?.content;
  const hook = topQ
    ? topQ.slice(0, 70).trim().replace(/[.?!]+$/, '') + '?'
    : 'Hands-on. Case-based. Real outcomes.';

  // Highlights fallback: derive from objectives (compact form), else from
  // study material titles. Cap at 4 bullets, 55 chars each.
  const highlights = (input.objectives ?? [])
    .map((o) => o.text.replace(/^[a-z]+ly\s+/i, '').replace(/\.$/, '').trim().slice(0, 55))
    .filter((s) => s.length > 5)
    .slice(0, 4);

  return {
    title: input.title,
    subtitle,
    hook,
    hostName: input.hostName,
    hostRole: input.hostRole ?? null,
    whenLine: `${dateLine} · ${timeLine}`,
    highlights,
    programLabel: input.programLabel ?? null,
    tags: input.tags ?? [],
    source: 'heuristic',
  };
}

/** Compose the full PromoCopy by calling Gemini for subtitle+hook and
 * structurally building hostName/whenLine from session metadata. */
async function buildCopy(input: {
  title: string;
  description: string | null;
  hostName: string;
  hostRole?: string | null;
  scheduledStart: Date;
  objectives?: Array<{ text: string; blooms: number }>;
  prereqItems?: Array<{ text: string; required: boolean }>;
  studyMaterial?: Array<{ kind: string; title: string }>;
  topPreQuestions?: Array<{ content: string; voteCount: number }>;
  tags?: string[];
  programName?: string | null;
  institution?: string | null;
}): Promise<PromoCopy> {
  const programLabel = [input.programName, input.institution].filter(Boolean).join(' · ') || null;
  const baseHeuristic = heuristicCopy({ ...input, programLabel });
  if (!env.GEMINI_API_KEY) return baseHeuristic;
  try {
    const aiCopy = await geminiPromoCopy(input);
    // Prefer AI-derived highlights; fall back to heuristic-derived if the AI
    // returned an empty list. The structural fields (host, when, tags) stay.
    return {
      ...baseHeuristic,
      subtitle: aiCopy.subtitle,
      hook: aiCopy.hook,
      highlights: aiCopy.highlights.length > 0 ? aiCopy.highlights : baseHeuristic.highlights,
      source: 'ai',
    };
  } catch (err) {
    if (err instanceof GeminiUnavailableError || err instanceof GeminiUnparseableError) {
      console.warn('[promo] AI copy failed, falling back to heuristic:', err);
      return baseHeuristic;
    }
    throw err;
  }
}

// Palette ported from the LVPEI promo mockup (4_1_2_promo_generator.html).
// Navy hero body, teal header strap, amber CTA accent, off-white type. The
// hex values mirror the mockup so flyers stay visually consistent with the
// public marketing pages.
const PALETTE = {
  navy: '#1B2B4B',
  navyDeep: '#0E1730',
  teal: '#0A7C6E',
  tealDark: '#065A50',
  amber: '#F0A500',
  amberSoft: '#FEF3DC',
  white: '#FFFFFF',
  ink: '#1A202C',
  mute: 'rgba(255,255,255,0.65)',
  muteSoft: 'rgba(255,255,255,0.4)',
  hairline: 'rgba(255,255,255,0.12)',
  // WhatsApp green for banner template
  waGreen: '#075E54',
  waLight: '#E5DDD5',
  // Legacy keys consumed by teaser-video-service. Map to the new palette so
  // existing video templates keep rendering without an out-of-band edit.
  bg: '#1B2B4B',
  accent: '#0A7C6E',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.65)',
  highlight: '#F0A500',
};

/** Word-wrap a string for SVG <text>, max `maxChars` per line, capped at `maxLines`. */
function wrapText(s: string, maxChars: number, maxLines = 4): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

function initials(name: string): string {
  const parts = name.replace(/^(Dr\.?|Prof\.?)\s+/i, '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderFlyerSvg(copy: PromoCopy): string {
  const { w, h } = TEMPLATE_DIMS.flyer;
  const padX = 80;

  // Header strap (teal). Sits across the top ~16% of the canvas.
  const headerH = 360;
  const titleLines = wrapText(copy.title, 18, 3);
  const titleSize = 84;
  const subtitleSize = 30;

  // Speaker card and highlights live in the navy body below the header.
  const bodyTop = headerH + 60;
  const highlights = (copy.highlights ?? []).slice(0, 4);
  const highlightStart = bodyTop + 260;

  // Footer band — date + REGISTER button
  const footerH = 140;

  let titleTspans = '';
  titleLines.forEach((line, i) => {
    const dy = i === 0 ? 0 : titleSize + 6;
    titleTspans += `<tspan x="${padX}" dy="${dy}">${escapeXml(line)}</tspan>`;
  });

  const highlightItems = highlights
    .map((hl, i) => {
      const y = highlightStart + i * 60;
      return `
    <circle cx="${padX + 8}" cy="${y - 8}" r="6" fill="${PALETTE.amber}"/>
    <text x="${padX + 28}" y="${y}" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="28" font-weight="500">${escapeXml(hl)}</text>`;
    })
    .join('');

  const tagsRow = (copy.tags ?? []).slice(0, 4);
  const tagChips = tagsRow
    .map((t, i) => {
      const tw = Math.max(t.length * 14 + 36, 90);
      // Approximate x by accumulating; restart row would be overkill — flyer width is generous.
      const x = padX + i * (tw + 12);
      return `
    <rect x="${x}" y="${headerH + 280 + 56 * highlights.length + 30}" rx="22" ry="22" width="${tw}" height="36" fill="rgba(240,165,0,0.18)" stroke="${PALETTE.amber}" stroke-width="1"/>
    <text x="${x + tw / 2}" y="${headerH + 280 + 56 * highlights.length + 54}" text-anchor="middle" fill="${PALETTE.amber}" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="700">${escapeXml(t.toUpperCase())}</text>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="header" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${PALETTE.tealDark}"/>
      <stop offset="100%" stop-color="${PALETTE.teal}"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${PALETTE.navy}"/>
      <stop offset="100%" stop-color="${PALETTE.navyDeep}"/>
    </linearGradient>
  </defs>

  <!-- BODY BACKGROUND -->
  <rect width="${w}" height="${h}" fill="url(#body)"/>

  <!-- HEADER STRAP -->
  <rect x="0" y="0" width="${w}" height="${headerH}" fill="url(#header)"/>
  <text x="${padX}" y="90" fill="${PALETTE.amberSoft}" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="600" letter-spacing="6">${escapeXml((copy.programLabel ?? 'VAIDIX · LVPEI').toUpperCase())}</text>
  <text x="${padX}" y="200" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="${titleSize}" font-weight="800">
    ${titleTspans}
  </text>

  <!-- SUBTITLE in body, just below header -->
  <text x="${padX}" y="${bodyTop + 60}" fill="rgba(255,255,255,0.78)" font-family="Inter, system-ui, sans-serif" font-size="${subtitleSize}" font-weight="400">
    ${wrapText(copy.subtitle, 50, 2).map((ln, i) => `<tspan x="${padX}" dy="${i === 0 ? 0 : subtitleSize + 6}">${escapeXml(ln)}</tspan>`).join('')}
  </text>

  <!-- SPEAKER CARD -->
  <rect x="${padX}" y="${bodyTop + 110}" width="780" height="120" rx="16" ry="16" fill="rgba(255,255,255,0.06)" stroke="${PALETTE.hairline}" stroke-width="1"/>
  <circle cx="${padX + 50}" cy="${bodyTop + 170}" r="38" fill="${PALETTE.amber}"/>
  <text x="${padX + 50}" y="${bodyTop + 182}" text-anchor="middle" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="28" font-weight="800">${escapeXml(initials(copy.hostName))}</text>
  <text x="${padX + 110}" y="${bodyTop + 162}" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="700">${escapeXml(copy.hostName)}</text>
  ${copy.hostRole ? `<text x="${padX + 110}" y="${bodyTop + 198}" fill="rgba(255,255,255,0.6)" font-family="Inter, system-ui, sans-serif" font-size="22">${escapeXml(copy.hostRole)}</text>` : ''}

  <!-- HIGHLIGHTS -->
  ${highlights.length > 0 ? `<text x="${padX}" y="${highlightStart - 30}" fill="${PALETTE.amber}" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="700" letter-spacing="3">WHAT YOU WILL LEARN</text>` : ''}
  ${highlightItems}

  <!-- TAGS -->
  ${tagChips}

  <!-- HOOK QUOTE -->
  <text x="${padX}" y="${h - footerH - 60}" fill="${PALETTE.amber}" font-family="Inter, system-ui, sans-serif" font-size="32" font-style="italic" font-weight="500">
    ${wrapText(copy.hook, 42, 2).map((ln, i) => `<tspan x="${padX}" dy="${i === 0 ? 0 : 40}">${escapeXml(ln)}</tspan>`).join('')}
  </text>

  <!-- FOOTER -->
  <rect x="0" y="${h - footerH}" width="${w}" height="${footerH}" fill="rgba(0,0,0,0.25)"/>
  <text x="${padX}" y="${h - 60}" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="600">📅 ${escapeXml(copy.whenLine)}</text>
  <rect x="${w - padX - 260}" y="${h - 92}" width="260" height="56" rx="8" ry="8" fill="${PALETTE.amber}"/>
  <text x="${w - padX - 130}" y="${h - 56}" text-anchor="middle" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="800" letter-spacing="3">REGISTER NOW</text>
</svg>`;
}

function renderWhatsappSvg(copy: PromoCopy): string {
  const { w, h } = TEMPLATE_DIMS.whatsapp_banner;
  const padX = 80;
  const titleLines = wrapText(copy.title, 18, 3);
  const titleSize = 96;
  const highlights = (copy.highlights ?? []).slice(0, 4);

  let titleTspans = '';
  titleLines.forEach((line, i) => {
    const dy = i === 0 ? 0 : titleSize + 8;
    titleTspans += `<tspan x="${padX}" dy="${dy}">${escapeXml(line)}</tspan>`;
  });

  const highlightStart = 1100;
  const highlightItems = highlights
    .map((hl, i) => {
      const y = highlightStart + i * 80;
      return `
    <text x="${padX}" y="${y}" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="40" font-weight="500">✅ ${escapeXml(hl)}</text>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="wabg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${PALETTE.tealDark}"/>
      <stop offset="55%" stop-color="${PALETTE.navy}"/>
      <stop offset="100%" stop-color="${PALETTE.navyDeep}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#wabg)"/>

  <!-- top tag -->
  <text x="${padX}" y="160" fill="${PALETTE.amber}" font-family="Inter, system-ui, sans-serif" font-size="32" font-weight="800" letter-spacing="6">🔬 GRAND ROUNDS</text>
  <text x="${padX}" y="220" fill="${PALETTE.mute}" font-family="Inter, system-ui, sans-serif" font-size="28" letter-spacing="4">${escapeXml((copy.programLabel ?? 'LVPEI · CME').toUpperCase())}</text>

  <!-- WHEN — in the safe upper zone. WhatsApp Status / Stories aggressively
       crop the bottom of vertical media, so date+time MUST live near the
       top of the canvas to survive any preview crop. -->
  <rect x="${padX}" y="280" width="${w - padX * 2}" height="100" rx="14" ry="14" fill="${PALETTE.amber}"/>
  <text x="${w / 2}" y="346" text-anchor="middle" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="44" font-weight="800">📅 ${escapeXml(copy.whenLine)}</text>

  <!-- title -->
  <text x="${padX}" y="520" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="${titleSize}" font-weight="800">
    ${titleTspans}
  </text>

  <!-- accent bar -->
  <rect x="${padX}" y="${520 + titleLines.length * (titleSize + 8) + 30}" width="160" height="8" fill="${PALETTE.amber}"/>

  <!-- subtitle -->
  <text x="${padX}" y="${520 + titleLines.length * (titleSize + 8) + 110}" fill="rgba(255,255,255,0.78)" font-family="Inter, system-ui, sans-serif" font-size="38">
    ${wrapText(copy.subtitle, 28, 2).map((ln, i) => `<tspan x="${padX}" dy="${i === 0 ? 0 : 50}">${escapeXml(ln)}</tspan>`).join('')}
  </text>

  <!-- highlights -->
  ${highlights.length > 0 ? `<text x="${padX}" y="${highlightStart - 60}" fill="${PALETTE.amber}" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="700" letter-spacing="3">KEY TOPICS</text>` : ''}
  ${highlightItems}

  <!-- speaker block bottom-right -->
  <rect x="${padX}" y="${h - 320}" width="${w - padX * 2}" height="120" rx="16" ry="16" fill="rgba(255,255,255,0.08)"/>
  <circle cx="${padX + 70}" cy="${h - 260}" r="50" fill="${PALETTE.amber}"/>
  <text x="${padX + 70}" y="${h - 245}" text-anchor="middle" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="36" font-weight="800">${escapeXml(initials(copy.hostName))}</text>
  <text x="${padX + 150}" y="${h - 260}" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="38" font-weight="700">${escapeXml(copy.hostName)}</text>
  ${copy.hostRole ? `<text x="${padX + 150}" y="${h - 220}" fill="rgba(255,255,255,0.6)" font-family="Inter, system-ui, sans-serif" font-size="26">${escapeXml(copy.hostRole)}</text>` : ''}

  <!-- footer call-out -->
  <text x="${w / 2}" y="${h - 90}" text-anchor="middle" fill="${PALETTE.mute}" font-family="Inter, system-ui, sans-serif" font-size="26" letter-spacing="3">Register via VAIDIX LXS →</text>
</svg>`;
}

function renderInstagramSvg(copy: PromoCopy): string {
  const { w, h } = TEMPLATE_DIMS.instagram_card;
  const padX = 64;
  const titleLines = wrapText(copy.title, 16, 3);
  const titleSize = 76;

  let titleTspans = '';
  titleLines.forEach((line, i) => {
    const dy = i === 0 ? 0 : titleSize + 6;
    titleTspans += `<tspan x="${padX}" dy="${dy}">${escapeXml(line)}</tspan>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="igbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.tealDark}"/>
      <stop offset="55%" stop-color="${PALETTE.navy}"/>
      <stop offset="100%" stop-color="${PALETTE.amber}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#igbg)"/>

  <!-- top eyebrow -->
  <text x="${padX}" y="${padX + 30}" fill="rgba(255,255,255,0.7)" font-family="Inter, system-ui, sans-serif" font-size="22" letter-spacing="4">${escapeXml((copy.programLabel ?? 'LVPEI · GRAND ROUNDS').toUpperCase())}</text>

  <!-- WHEN — pinned high (just below eyebrow) so it survives Stories crop -->
  <rect x="${padX}" y="${padX + 60}" width="${w - padX * 2}" height="80" rx="12" ry="12" fill="${PALETTE.amber}"/>
  <text x="${w / 2}" y="${padX + 113}" text-anchor="middle" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="34" font-weight="800">📅 ${escapeXml(copy.whenLine)}</text>

  <!-- centered title -->
  <text x="${padX}" y="${h / 2 - titleLines.length * 40 + 60}" fill="${PALETTE.white}" font-family="Inter, system-ui, sans-serif" font-size="${titleSize}" font-weight="800">
    ${titleTspans}
  </text>

  <!-- speaker line -->
  <text x="${padX}" y="${h / 2 + 160}" fill="rgba(255,255,255,0.85)" font-family="Inter, system-ui, sans-serif" font-size="32" font-weight="600">${escapeXml(copy.hostName)}</text>
  ${copy.hostRole ? `<text x="${padX}" y="${h / 2 + 205}" fill="rgba(255,255,255,0.55)" font-family="Inter, system-ui, sans-serif" font-size="22">${escapeXml(copy.hostRole)}</text>` : ''}

  <!-- bottom row: handle -->
  <text x="${w / 2}" y="${h - 60}" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-family="Inter, system-ui, sans-serif" font-size="22">@lvpei_education</text>
</svg>`;
}

function renderSvg(template: PromoTemplate, copy: PromoCopy): string {
  switch (template) {
    case 'flyer':
      return renderFlyerSvg(copy);
    case 'whatsapp_banner':
      return renderWhatsappSvg(copy);
    case 'instagram_card':
      return renderInstagramSvg(copy);
  }
}

export interface GeneratePromoInput {
  sessionId: string;
  templates?: PromoTemplate[];
  actor: { userId: string; role: Role };
}

export interface GeneratePromoResult {
  documents: Array<{
    template: PromoTemplate;
    documentId: string;
    s3Key: string;
  }>;
}

export async function generatePromoAssets(input: GeneratePromoInput): Promise<GeneratePromoResult> {
  if (!FACULTY_LIKE.includes(input.actor.role)) {
    throw new PromoAccessError('FORBIDDEN', 'Only faculty/PD/admin can generate promo assets');
  }
  const session = await db.teachingSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      title: true,
      description: true,
      scheduledStart: true,
      scheduledEnd: true,
      objectives: true,
      tags: true,
      topicId: true,
      metadata: true,
      host: {
        select: {
          name: true,
          profile: { select: { subspecialty: true, affiliation: true } },
        },
      },
      program: { select: { name: true, institution: true } },
      documentLinks: {
        where: { isPreSession: true, document: { deletedAt: null } },
        select: {
          document: { select: { title: true, kind: true } },
        },
        orderBy: { preSessionRank: 'asc' },
        take: 6,
      },
      preQuestions: {
        orderBy: { voteCount: 'desc' },
        take: 3,
        select: { content: true, voteCount: true },
      },
    },
  });
  if (!session) throw new PromoAccessError('NOT_FOUND', 'Session not found');

  const objectiveArr = Array.isArray(session.objectives)
    ? (session.objectives as Array<{ text: string; blooms: number }>).slice(0, 6)
    : [];
  const studyMaterial = session.documentLinks.map((l) => ({
    kind: String(l.document.kind),
    title: l.document.title,
  }));
  const topPreQuestions = session.preQuestions;

  const meta = (session.metadata ?? {}) as Record<string, unknown>;
  const prereqItems = Array.isArray(meta.prereqItems)
    ? (meta.prereqItems as Array<{ text: string; required: boolean }>).slice(0, 6)
    : [];

  // Fetch topic name separately — TeachingSession has topicId but no relation.
  const topic = session.topicId
    ? await db.topic.findUnique({
        where: { id: session.topicId },
        select: { name: true, subspecialty: true },
      })
    : null;

  const tags = [
    ...(topic?.subspecialty ? [topic.subspecialty] : []),
    ...(topic?.name ? [topic.name] : []),
    ...(session.tags ?? []),
  ].slice(0, 5);

  const hostRole = [session.host.profile?.subspecialty, session.host.profile?.affiliation]
    .filter(Boolean)
    .join(' · ') || session.program?.institution || null;

  // Default to the two share-native formats: WhatsApp banner (1080×1920 —
  // also fits Stories) + Instagram card (1080×1080). The A4 flyer template
  // is still callable via input.templates for explicit print-poster use,
  // but residency speakers share digitally — flyer was overkill in the
  // default set. Drop from default per W9.2 feedback.
  const templates = input.templates ?? (['whatsapp_banner', 'instagram_card'] as const);
  const copy = await buildCopy({
    title: session.title,
    description: session.description,
    hostName: session.host.name,
    hostRole,
    scheduledStart: session.scheduledStart,
    objectives: objectiveArr,
    prereqItems,
    studyMaterial,
    topPreQuestions,
    tags,
    programName: session.program?.name ?? null,
    institution: session.program?.institution ?? null,
  });

  const out: GeneratePromoResult['documents'] = [];
  for (const tmpl of templates) {
    const svg = renderSvg(tmpl, copy);
    const buf = Buffer.from(svg, 'utf8');
    const key = `documents/raw/${input.actor.userId}/promo-${input.sessionId}-${tmpl}-${Date.now()}.svg`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buf,
        ContentType: 'image/svg+xml',
      })
    );
    const doc = await db.document.create({
      data: {
        uploadedById: input.actor.userId,
        title: `${session.title} — ${tmpl.replace(/_/g, ' ')}`,
        description: `Auto-generated promo asset (${tmpl}) for session "${session.title}".`,
        kind: DocumentKind.IMAGE,
        route: DocumentRoute.PROMO_ASSET,
        s3Key: key,
        sizeBytes: BigInt(buf.byteLength),
        mimeType: 'image/svg+xml',
        status: DocumentStatus.PRIVATE_FACULTY,
        visibility: DocumentStatus.PRIVATE_FACULTY,
        sessionLinks: {
          create: { sessionId: input.sessionId, linkedById: input.actor.userId },
        },
      },
      select: { id: true, s3Key: true },
    });
    out.push({ template: tmpl, documentId: doc.id, s3Key: doc.s3Key });
  }
  return { documents: out };
}
