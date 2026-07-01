import { Instagram } from 'lucide-react';
import { eventInfo } from '../config/event';

export function Marquee() {
  const marqueeText = 'FUNPACE RUN EXPERIENCE - 10KM - 5KM';
  const marqueeItems = Array.from({ length: 8 }, (_, index) => index);

  return (
    <div className="relative z-10 flex w-full overflow-hidden whitespace-nowrap border-y border-black bg-brand py-2.5 text-black shadow-[0_0_40px_rgba(215,255,0,0.18)] sm:py-3">
      <div className="marquee-track flex w-max shrink-0 gap-8 font-display text-base font-bold uppercase tracking-tighter sm:text-xl">
        {[...marqueeItems, ...marqueeItems].map((_, index) => (
          <span key={index}>{marqueeText}</span>
        ))}
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-black px-4 py-14 text-white sm:px-6 md:py-20">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-10 md:flex-row md:items-end md:gap-12">
        <div className="flex flex-col gap-6">
          <h2 className="font-display text-[clamp(3rem,14vw,6rem)] font-black uppercase leading-none tracking-tighter">
            Funpace<br />
            <span className="text-zinc-500 stroke-text">Run</span>
          </h2>
          <a
            href={`mailto:${eventInfo.contactEmail}`}
            className="font-mono text-sm text-zinc-400 transition-colors hover:text-brand"
          >
            {eventInfo.contactEmail}
          </a>
        </div>

        <div className="flex w-full flex-col gap-4 md:w-auto">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-zinc-500">Conecte-se</h3>
          <div className="flex gap-4">
            <a
              href={eventInfo.instagramUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram oficial do FunPace"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 transition-colors hover:bg-white hover:text-black"
            >
              <Instagram className="h-5 w-5" />
            </a>
          </div>
          <div className="mt-8 font-mono text-xs text-zinc-600">
            &copy; {new Date().getFullYear()} Funpace Run. Todos os direitos reservados.
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
            <a href="/regulamento" className="hover:text-brand">Regulamento</a>
            <a href="/privacidade" className="hover:text-brand">Privacidade</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
