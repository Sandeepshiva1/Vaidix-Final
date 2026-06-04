'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
      className="relative"
    >
      <Sun className="size-4.5 rotate-0 scale-100 text-muted-foreground transition-transform duration-300 dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4.5 rotate-90 scale-0 text-muted-foreground transition-transform duration-300 dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
