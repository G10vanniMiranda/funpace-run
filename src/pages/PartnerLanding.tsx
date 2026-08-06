import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, ShieldCheck, Users } from 'lucide-react';
import { activatePartnerLink, ApiError } from '../lib/api';
import { buildPartnerRegistrationUrl } from '../lib/partners';
import { captureCurrentMarketingAttribution, permittedMarketingQuery } from '../lib/marketingAttribution';

function getPartnerLinkErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return 'Nao foi possivel validar este beneficio agora. Tente novamente ou continue sem desconto.';
  }

  if (error.code === 'endpoint_not_found' || error.code === 'network_error' || error.code === 'timeout' || (error.status && error.status >= 500)) {
    return 'Nao foi possivel validar este beneficio agora. Tente novamente ou continue sem desconto.';
  }

  return error.message;
}

export function PartnerLandingPage({ slug }: { slug: string }) {
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    captureCurrentMarketingAttribution();
    const permittedQuery = permittedMarketingQuery(window.location.search);
    void activatePartnerLink(slug)
      .then(() => { if (active) window.location.replace(buildPartnerRegistrationUrl(permittedQuery.toString())); })
      .catch((requestError) => {
        if (active) setError(getPartnerLinkErrorMessage(requestError));
      });
    return () => { active = false; };
  }, [slug]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 py-16 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,rgba(215,255,0,0.13),transparent_30rem)]" />
      <section className="relative w-full max-w-xl border border-white/10 bg-zinc-950 p-7 text-center shadow-2xl sm:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center border border-brand/30 bg-brand/10 text-brand">
          {error ? <Users className="h-8 w-8" /> : <Loader2 className="h-8 w-8 animate-spin" />}
        </div>
        <p className="mt-7 text-xs font-black uppercase tracking-[0.28em] text-brand">Parceiros FunPace</p>
        <h1 className="mt-3 font-display text-4xl font-black uppercase leading-none tracking-tighter sm:text-5xl">
          {error ? 'Link indisponível' : 'Benefício identificado'}
        </h1>
        <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-zinc-400">
          {error || 'Estamos validando seu parceiro e preparando a inscrição com o desconto automático.'}
        </p>
        {error ? (
          <a href="/#register" className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 bg-brand px-5 text-xs font-black uppercase tracking-widest text-black hover:bg-white">
            Continuar sem benefício <ArrowRight className="h-4 w-4" />
          </a>
        ) : (
          <div className="mt-8 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
            <ShieldCheck className="h-4 w-4 text-brand" /> Validação segura no servidor
          </div>
        )}
      </section>
    </main>
  );
}
