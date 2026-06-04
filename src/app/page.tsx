import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Landing } from '@/components/marketing/landing'

// Root entrypoint.
// Authenticated visitors go straight to the dashboard. Unauthenticated
// visitors see the public marketing landing page (Vaidix LXS pitch) and
// can either Request a Demo or click Login to reach `/login`.
// `/` is listed as a public path in auth.config.ts so middleware never
// prepends `?callbackUrl=...` to this URL.
export default async function Home() {
  const session = await auth()
  if (session?.user) redirect('/dashboard')
  return <Landing />
}
