'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { ReactNode } from 'react'

/**
 * Theme provider — uses next-themes for runtime switching but the initial
 * theme class is set by the inline <script> in app/layout.tsx BEFORE this
 * provider mounts. This prevents the React 19 "script tag inside component"
 * dev warning while keeping FOUC prevention.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
