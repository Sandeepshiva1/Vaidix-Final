// ════════════════════════════════════════════════════════════════════════════
// Public Promo Share Page — W9
// ════════════════════════════════════════════════════════════════════════════
// Unauthenticated landing page rendered at /p/[token]. Pulls session + asset
// bundle via the public API, then renders flyer + WA banner + IG card
// previews along with session details (host, when, objectives, tags) and a
// registration CTA pointing at the login (deep-link comes after auth).
//
// Visual language matches the LVPEI promo mockup (4_1_2_promo_generator.html)
// — navy/teal/amber palette so the page reads as the same product as the
// generated flyer itself.

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PromoShareClient } from './client';
import {
  getPublicPromoByToken,
  PromoShareError,
} from '@/server/services/promo/promo-share-service';

type Params = Promise<{ token: string }>;

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { token } = await params;
  try {
    // Metadata pass — do NOT bump accessCount; the main render below already does.
    const view = await getPublicPromoByToken(token, { countAccess: false });
    return {
      title: `${view.session.title} · VAIDIX`,
      description:
        view.session.description ??
        `Live clinical teaching session with ${view.session.hostName}. Register to attend.`,
      openGraph: {
        title: view.session.title,
        description: view.session.description ?? undefined,
        type: 'website',
      },
    };
  } catch {
    return { title: 'Promo not available · VAIDIX' };
  }
}

export default async function PromoSharePage({ params }: { params: Params }) {
  const { token } = await params;

  let view;
  try {
    view = await getPublicPromoByToken(token);
  } catch (err) {
    if (err instanceof PromoShareError) {
      if (err.code === 'NOT_FOUND') return notFound();
      return (
        <ExpiredFrame
          code={err.code}
          message={err.message}
        />
      );
    }
    throw err;
  }

  return <PromoShareClient view={view} />;
}

function ExpiredFrame({ code, message }: { code: PromoShareError['code']; message: string }) {
  const heading =
    code === 'EXPIRED'
      ? 'This promo link has expired'
      : code === 'REVOKED'
      ? 'This promo link was revoked'
      : 'Promo unavailable';
  return (
    <main className="min-h-screen bg-[#0E1730] flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mb-4 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/70">
          VAIDIX · LVPEI
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">{heading}</h1>
        <p className="text-sm text-white/60 mb-6">{message}</p>
        <p className="text-xs text-white/40">
          If you received this link by mistake, ask the session host for an updated one.
        </p>
      </div>
    </main>
  );
}
