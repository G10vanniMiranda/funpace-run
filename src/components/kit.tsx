import { Sparkles } from 'lucide-react';
import { eventInfo } from '../config/event';
import { Reveal } from './premium';

export function KitSection() {
  return (
    <section className="relative overflow-hidden border-t border-zinc-900 bg-black px-4 py-16 sm:px-6 md:py-24">
      <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16 xl:gap-24">
        <Reveal className="min-w-0">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest text-brand">Kit oficial</p>

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
          <div className="relative mx-auto flex w-full max-w-5xl items-center justify-center">
            <img
              src="/kit.webp"
              alt="Kit oficial FunPace Run"
              className="h-auto max-h-[68svh] w-full object-contain lg:max-h-[72svh]"
              loading="lazy"
              decoding="async"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
