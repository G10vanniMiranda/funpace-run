import { Instagram, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { eventInfo } from '../config/event';

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const links = [
    { href: '#about', label: 'A Prova' },
    { href: '#map', label: 'Percurso' },
    { href: '#register', label: 'Inscricoes' },
    { href: '#faq', label: 'FAQ' },
  ];

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className="fixed left-0 top-0 z-50 w-full px-4 py-3 text-white sm:px-6 sm:py-4">
      <div className={`mx-auto flex w-full max-w-7xl items-center justify-between gap-3 border px-3 py-2 transition-all duration-300 sm:px-4 ${isScrolled ? 'border-white/10 bg-black/80 shadow-2xl shadow-black/25 backdrop-blur-md' : 'border-transparent bg-transparent'
        }`}>
        <a href="/" className="font-display text-lg font-bold uppercase tracking-tighter sm:text-xl">
          Funpace Run
        </a>

        <div className="hidden items-center gap-6 text-xs font-bold uppercase tracking-widest lg:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="group relative py-2 text-zinc-300 transition-colors hover:text-white">
              {link.label}
              <span className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-brand transition-transform duration-300 group-hover:scale-x-100" />
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <a
            href="#register"
            className="premium-button rounded-full bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-brand sm:px-5"
          >
            Participar
          </a>
          <button
            type="button"
            aria-label={isOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={isOpen}
            onClick={() => setIsOpen((current) => !current)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/80 backdrop-blur-sm transition-colors hover:border-brand lg:hidden"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mx-auto mt-3 w-full max-w-7xl border border-white/10 bg-black/90 p-3 shadow-2xl backdrop-blur-md lg:hidden">
          <div className="grid gap-1">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="px-3 py-4 text-sm font-black uppercase tracking-widest text-white hover:bg-brand hover:text-black"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

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
          <p className="text-zinc-400 font-mono text-sm max-w-sm">
            Destrua seus limites. Corrida oficial em {eventInfo.city}, Brasil - 2026.
          </p>
          <a
            href={`mailto:${eventInfo.contactEmail}`}
            className="font-mono text-sm text-zinc-400 transition-colors hover:text-brand"
          >
            {eventInfo.contactEmail}
          </a>
        </div>

        <div className="flex w-full flex-col gap-4 md:w-auto">
          <h3 className="font-bold uppercase tracking-widest text-sm text-zinc-500 mb-2">Conecte-se</h3>
          <div className="flex gap-4">
            <a
              href={eventInfo.instagramUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram oficial do FunPace"
              className="w-12 h-12 rounded-full border border-zinc-700 flex items-center justify-center hover:bg-white hover:text-black transition-colors"
            >
              <Instagram className="w-5 h-5" />
            </a>
          </div>
          <div className="mt-8 text-xs text-zinc-600 font-mono">
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
