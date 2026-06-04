import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { LoginForm } from './login-form';

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

// Server component. Bounces already-authenticated users straight to their
// intended destination so they never see the form for a moment after navigating
// to /login. The actual form is a client island below.
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  const params = await searchParams;

  if (session?.user) {
    // Honour ?callbackUrl when it's a same-origin path; otherwise default to
    // /dashboard. Never trust an absolute URL — it would redirect off-host.
    const target =
      params.callbackUrl && params.callbackUrl.startsWith('/') && !params.callbackUrl.startsWith('//')
        ? params.callbackUrl
        : '/dashboard';
    redirect(target);
  }

  // useSearchParams in the form requires a Suspense boundary so this page can
  // be statically pre-rendered.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
