import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { ThemeProvider } from '@/providers/theme-provider'
import { CsrfFetchProvider } from '@/providers/csrf-fetch-provider'
import { CommandPalette } from '@/components/shared/command-palette'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Vaidix — Clinical Learning Intelligence',
  description: 'AI-powered conversational learning platform for medical education',
}

const themeInitScript = `(function(){try{var s=localStorage.getItem('theme');var t=s||'light';if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark')document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider>
          <CsrfFetchProvider>
            <CommandPalette />
            {children}
          </CsrfFetchProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
