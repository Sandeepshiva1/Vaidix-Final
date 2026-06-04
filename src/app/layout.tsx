import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/providers/theme-provider'
import { CommandPalette } from '@/components/shared/command-palette'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Vaidix — Clinical Learning Intelligence',
  description: 'AI-powered conversational learning platform for medical education',
}

// Inline blocking script — runs during initial HTML parse so the theme class
// is on <html> before paint. Placed in <head> as a plain <script> (NOT
// next/script) because next/script's beforeInteractive trips React 19's
// "script tag inside a component" warning in App Router.
const themeInitScript = `(function(){try{var s=localStorage.getItem('theme');var t=s||'light';if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark')document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider>
          <CommandPalette />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
