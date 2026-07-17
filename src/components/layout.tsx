import { Instagram, PartyPopper } from 'lucide-react';
import { eventInfo } from '../config/event';

export function Marquee() {
  return (
    <div className="relative z-10 flex w-full overflow-hidden whitespace-nowrap border-y border-black bg-brand py-2.5 text-black shadow-[0_0_40px_rgba(215,255,0,0.18)] sm:py-3">
      <div className="marquee-track flex w-max shrink-0 font-display text-base font-bold uppercase tracking-tighter sm:text-xl">
        <MarqueeSequence />
        <MarqueeSequence ariaHidden />
      </div>
    </div>
  );
}

function MarqueeSequence({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div className="flex shrink-0" aria-hidden={ariaHidden || undefined}>
      {Array.from({ length: 6 }, (_, index) => (
        <MarqueeGroup key={index} ariaHidden={ariaHidden || index > 0} />
      ))}
    </div>
  );
}

function MarqueeGroup({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div
      className="flex shrink-0 items-center gap-5 pr-5 sm:gap-8 sm:pr-8 lg:gap-10 lg:pr-10"
      aria-hidden={ariaHidden || undefined}
    >
      <span className="inline-flex items-center gap-2">
        <PartyPopper className="h-[1em] w-[1em] shrink-0" strokeWidth={2.75} aria-hidden="true" />
        <span>1 ano de movimento</span>
      </span>
      <span aria-hidden="true">•</span>
      <span>Funpace Run 2026</span>
      <span aria-hidden="true">•</span>
      <span>10K 5K</span>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-zinc-800 bg-black px-4 py-14 text-white sm:px-6 md:py-20">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-10 md:flex-row md:items-end md:gap-12">
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
            &copy; {new Date().getFullYear()} Funpace. Todos os direitos reservados.
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
