// ─── Deck Theme Definitions ──────────────────────────────────────────────────
// Each theme provides colours for both the web canvas (CSS hex with #) and the
// PPTX renderer (hex strings without #, matching PptxGenJS expectations).

export type DeckThemeId = 'deep-space' | 'clinical-white' | 'crimson' | 'parchment';

export interface PptxColors {
  bg: string;
  titleBg: string;    // TITLE_ONLY, CLOSING, QUOTE slide backgrounds
  contentBg: string;  // TITLE_BULLETS, TWO_COLUMN, INTERACTION, IMAGE_FOCUS
  panelBg: string;    // header/footer panel + border
  primary: string;    // accent 1 (default when slide has no accentHex)
  secondary: string;  // accent 2 (right half of header strip)
  text: string;       // primary body text
  text85: string;     // bullets
  text65: string;     // secondary / attribution text
  text40: string;     // faint labels, counter, footer
  panelDark: string;  // interaction option boxes
}

export interface DeckTheme {
  id: DeckThemeId;
  label: string;
  swatch: string;     // CSS hex used for the picker chip background
  // Web canvas colours (CSS hex with #)
  bg: string;
  panel: string;
  border: string;
  primary: string;
  secondary: string;
  text: string;
  subtle: string;     // rgba
  faint: string;      // rgba
  panelAlt: string;   // darker panel (interaction boxes)
  titleBg: string;    // TITLE_ONLY / CLOSING / QUOTE slide bg
  // PPTX renderer colours (hex without #)
  pptx: PptxColors;
}

export const DECK_THEMES: Record<DeckThemeId, DeckTheme> = {
  // ── 1. Deep Space — very dark navy + cyan/gold ──────────────────────────
  'deep-space': {
    id: 'deep-space',
    label: 'Deep Space',
    swatch: '#040817',
    bg: '#040817',
    panel: '#0b1535',
    border: '#0f1d48',
    primary: '#00d4f0',
    secondary: '#f5b731',
    text: '#ffffff',
    subtle: 'rgba(255,255,255,0.6)',
    faint: 'rgba(255,255,255,0.32)',
    panelAlt: '#111428',
    titleBg: '#070e28',
    pptx: {
      bg: '040817', titleBg: '070e28', contentBg: '0b1535', panelBg: '0f1d48',
      primary: '00d4f0', secondary: 'f5b731',
      text: 'ffffff', text85: 'dde0f0', text65: 'a0a8c8', text40: '555577',
      panelDark: '111428',
    },
  },

  // ── 2. Crimson — deep wine red + rose/gold ──────────────────────────────
  'crimson': {
    id: 'crimson',
    label: 'Crimson',
    swatch: '#1c0a10',
    bg: '#1c0a10',
    panel: '#2d1018',
    border: '#3d1a22',
    primary: '#ff6b8a',
    secondary: '#fbbf24',
    text: '#ffffff',
    subtle: 'rgba(255,255,255,0.6)',
    faint: 'rgba(255,255,255,0.32)',
    panelAlt: '#160808',
    titleBg: '#130609',
    pptx: {
      bg: '1c0a10', titleBg: '130609', contentBg: '2d1018', panelBg: '3d1a22',
      primary: 'ff6b8a', secondary: 'fbbf24',
      text: 'ffffff', text85: 'fde8ec', text65: 'f9a8b4', text40: '885565',
      panelDark: '160808',
    },
  },

  // ── 3. Clinical White — pure white + royal blue/red ─────────────────────
  'clinical-white': {
    id: 'clinical-white',
    label: 'Clinical White',
    swatch: '#ffffff',
    bg: '#ffffff',
    panel: '#f0f4fb',
    border: '#d4dae6',
    primary: '#1d4ed8',
    secondary: '#dc2626',
    text: '#0d1117',
    subtle: 'rgba(13,17,23,0.65)',
    faint: 'rgba(13,17,23,0.38)',
    panelAlt: '#e3eaf5',
    titleBg: '#edf2fc',
    pptx: {
      bg: 'ffffff', titleBg: 'edf2fc', contentBg: 'ffffff', panelBg: 'd4dae6',
      primary: '1d4ed8', secondary: 'dc2626',
      text: '0d1117', text85: '1e2a3a', text65: '4a5568', text40: '9ca3af',
      panelDark: 'c8d3e8',
    },
  },

  // ── 4. Parchment — warm cream + amber/violet ────────────────────────────
  'parchment': {
    id: 'parchment',
    label: 'Parchment',
    swatch: '#fef6e8',
    bg: '#fef6e8',
    panel: '#f5e8c8',
    border: '#e8d5a3',
    primary: '#b45309',
    secondary: '#7c3aed',
    text: '#1a0f00',
    subtle: 'rgba(26,15,0,0.65)',
    faint: 'rgba(26,15,0,0.38)',
    panelAlt: '#ead5a0',
    titleBg: '#f5e8c8',
    pptx: {
      bg: 'fef6e8', titleBg: 'f5e8c8', contentBg: 'fef6e8', panelBg: 'e8d5a3',
      primary: 'b45309', secondary: '7c3aed',
      text: '1a0f00', text85: '2d1a00', text65: '5c3d1a', text40: '8a6a40',
      panelDark: 'e0ccaa',
    },
  },
};

export const THEME_IDS = Object.keys(DECK_THEMES) as DeckThemeId[];

export function getDeckTheme(id: string | null | undefined): DeckTheme {
  return DECK_THEMES[(id as DeckThemeId) ?? 'deep-space'] ?? DECK_THEMES['deep-space'];
}
