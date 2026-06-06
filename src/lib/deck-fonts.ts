// ─── Deck Font Definitions ────────────────────────────────────────────────────
// Curated list of Google Fonts suited for medical presentations.
// `family` is the CSS font-family value; `google` is the URL query fragment
// used when loading on demand from fonts.googleapis.com.

export interface DeckFont {
  id: string
  label: string
  family: string        // CSS font-family (with fallback)
  google: string        // Google Fonts URL query param (family=...)
  category: 'sans' | 'serif' | 'mono'
}

export const DECK_FONTS: DeckFont[] = [
  { id: 'inter',             label: 'Inter',              family: "'Inter', sans-serif",             google: 'Inter:wght@400;500;600;700;800',            category: 'sans'  },
  { id: 'roboto',            label: 'Roboto',             family: "'Roboto', sans-serif",            google: 'Roboto:wght@400;500;700;900',               category: 'sans'  },
  { id: 'open-sans',         label: 'Open Sans',          family: "'Open Sans', sans-serif",         google: 'Open+Sans:wght@400;600;700;800',            category: 'sans'  },
  { id: 'lato',              label: 'Lato',               family: "'Lato', sans-serif",              google: 'Lato:wght@400;700;900',                     category: 'sans'  },
  { id: 'montserrat',        label: 'Montserrat',         family: "'Montserrat', sans-serif",        google: 'Montserrat:wght@400;600;700;800',           category: 'sans'  },
  { id: 'poppins',           label: 'Poppins',            family: "'Poppins', sans-serif",           google: 'Poppins:wght@400;600;700;800',              category: 'sans'  },
  { id: 'raleway',           label: 'Raleway',            family: "'Raleway', sans-serif",           google: 'Raleway:wght@400;600;700;800',              category: 'sans'  },
  { id: 'nunito',            label: 'Nunito',             family: "'Nunito', sans-serif",            google: 'Nunito:wght@400;600;700;800',               category: 'sans'  },
  { id: 'dm-sans',           label: 'DM Sans',            family: "'DM Sans', sans-serif",           google: 'DM+Sans:wght@400;500;700',                  category: 'sans'  },
  { id: 'ibm-plex-sans',     label: 'IBM Plex Sans',      family: "'IBM Plex Sans', sans-serif",     google: 'IBM+Plex+Sans:wght@400;500;600;700',        category: 'sans'  },
  { id: 'playfair-display',  label: 'Playfair Display',   family: "'Playfair Display', serif",       google: 'Playfair+Display:wght@400;600;700;800',     category: 'serif' },
  { id: 'merriweather',      label: 'Merriweather',       family: "'Merriweather', serif",           google: 'Merriweather:wght@400;700;900',             category: 'serif' },
  { id: 'libre-baskerville', label: 'Libre Baskerville',  family: "'Libre Baskerville', serif",      google: 'Libre+Baskerville:wght@400;700',            category: 'serif' },
  { id: 'pt-serif',          label: 'PT Serif',           family: "'PT Serif', serif",               google: 'PT+Serif:wght@400;700',                     category: 'serif' },
  { id: 'source-sans-3',     label: 'Source Sans 3',      family: "'Source Sans 3', sans-serif",     google: 'Source+Sans+3:wght@400;600;700',            category: 'sans'  },
]

export const DEFAULT_FONT_ID = 'inter'

export function getFontById(id: string | null | undefined): DeckFont {
  return DECK_FONTS.find((f) => f.id === id) ?? DECK_FONTS[0]
}

// Builds the Google Fonts <link> href for a given font ID.
export function googleFontsUrl(id: string): string {
  const font = getFontById(id)
  return `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`
}
