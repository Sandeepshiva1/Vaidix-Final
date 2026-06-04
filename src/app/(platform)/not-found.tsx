import Link from 'next/link'
import { MapPin, ArrowLeft, Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-2xl bg-linear-to-br from-teal-500/15 to-blue-500/15 border border-teal-500/20">
          <Compass className="size-10 text-teal-500" />
        </div>

        {/* Status */}
        <div className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <MapPin className="size-3" />
          Page not found
        </div>

        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
          Nothing here yet
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          This page hasn&apos;t been built yet or the URL may have changed.
          If you expected to find something here, it&apos;s likely coming soon.
        </p>

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-md transition-all hover:opacity-90"
        >
          <ArrowLeft className="size-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
