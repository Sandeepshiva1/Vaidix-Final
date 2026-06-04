'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface Props {
  initialQuery: string
}

export function LearnerSearch({ initialQuery }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(initialQuery)

  function commit(next: string) {
    const url = next.trim() ? `/teacher/learners?q=${encodeURIComponent(next.trim())}` : '/teacher/learners'
    router.replace(url)
  }

  return (
    <div className="relative max-w-md">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Search by name or email..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(value)
          if (e.key === 'Escape') {
            setValue('')
            commit('')
          }
        }}
        className="pl-9"
      />
    </div>
  )
}
