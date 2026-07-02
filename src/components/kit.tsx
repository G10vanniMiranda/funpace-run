import { Shirt, Sparkles } from 'lucide-react';
import { eventInfo } from '../config/event';
import { Reveal } from './premium';

export function KitSection() {
  return (
    <section className="relative overflow-hidden border-t border-zinc-900 bg-black px-4 py-16 sm:px-6 md:py-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_38%,rgba(215,255,0,0.12),transparent_28rem)]" />
      <div className="premium-grid opacity-60" />

      <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16 xl:gap-24">
        <Reveal className="min-w-0">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest text-brand">Kit oficial</p>
          <h2 className="font-display text-[clamp(2.8rem,13vw,5.75rem)] font-black uppercase leading-none tracking-tighter text-white">
            Feito para correr.
          </h2>

          <div className="mt-7 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
            {eventInfo.kitItems.map((item) => (
              <div key={item} className="premium-card flex min-w-0 items-center gap-3 p-4">
                <Sparkles className="h-5 w-5 shrink-0 text-brand" />
                <span className="font-mono text-sm text-zinc-300">{item}</span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.08} className="relative min-w-0">
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-28 -translate-y-1/2 bg-brand/20 blur-3xl sm:h-40" />
          <div className="relative mx-auto flex w-full max-w-5xl items-center justify-center overflow-hidden border border-white/10 bg-white/[0.03] p-3 shadow-[0_24px_90px_rgba(0,0,0,0.45)] sm:p-5 lg:p-6">
            <img
              src="/kit.webp"
              alt="Kit oficial FunPace Run"
              className="h-auto max-h-[68svh] w-full object-contain lg:max-h-[72svh]"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500 sm:text-xs">
            <Shirt className="h-4 w-4 text-brand" />
            <span>Imagem ilustrativa do kit</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
