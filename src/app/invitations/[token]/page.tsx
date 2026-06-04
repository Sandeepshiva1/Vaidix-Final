import { auth } from '@/auth';
import { AcceptInvitationClient } from './accept-client';

// Server component wrapper. Reads the current NextAuth session so the client
// component can detect the "already logged in as someone else" case and force
// the user to sign out before accepting an invitation for a different email.
//
// Why this matters: without this guard, an admin who opens an invitation link
// in their own browser ends up holding both their admin cookie AND the newly
// created user — the redirect to /login silently bounces them back into the
// admin dashboard because their session is still valid. The fix is two-fold:
//   1) block accept until the session matches the invited email (here)
//   2) auto-signIn the new user after a successful POST (in accept-client.tsx)
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();

  return (
    <AcceptInvitationClient
      token={token}
      currentSessionEmail={session?.user?.email ?? null}
      currentSessionName={session?.user?.name ?? null}
    />
  );
}
