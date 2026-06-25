import { Mail } from 'lucide-react';

const maintenanceContactHref = 'mailto:contato@funpace.club';
// Para WhatsApp, troque por: https://wa.me/5599999999999

export function MaintenancePage() {
  const pillars = ['Performance', 'Inovação', 'Comunidade'];

  return (
    <main className="maintenance-page min-h-screen bg-[#050505] text-white">
      <section className="relative mx-auto flex min-h-screen w-full max-w-472 flex-col justify-between px-3 py-6 sm:px-8 sm:py-8 lg:px-12">
        <header className="maintenance-reveal flex items-center justify-center pt-2 sm:pt-3" style={{ '--maintenance-delay': '80ms' } as React.CSSProperties}>
          <a
            href="/"
            aria-label="FunPace"
            className="group relative inline-flex h-8 w-44 items-center justify-center overflow-hidden text-white sm:h-14 sm:w-72 lg:h-18 lg:w-88"
          >
            <img
              src="/funpace1.png"
              alt="FunPace"
              width="320"
              height="86"
              className="absolute left-1/2 top-1/2 w-full max-w-none -translate-x-1/2 -translate-y-1/2 object-contain mix-blend-screen transition-transform duration-200 group-hover:-translate-x-1/2 group-hover:translate-y-[-52%]"
            />
          </a>
        </header>

        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-start pt-[18vh] text-center sm:justify-center sm:py-16">
          <h1
            className="maintenance-reveal w-full max-w-none wrap-break-word font-display text-[clamp(3.15rem,15vw,9.5rem)] font-black uppercase leading-[0.88] tracking-normal text-white sm:max-w-5xl sm:text-[clamp(3.5rem,11vw,9.5rem)]"
            style={{ '--maintenance-delay': '160ms' } as React.CSSProperties}
          >
            Estamos preparando uma nova experiência
          </h1>

          <div
            className="maintenance-reveal mt-7 max-w-2xl space-y-3 text-base leading-7 text-zinc-300 sm:mt-9 sm:text-lg md:text-xl md:leading-8"
            style={{ '--maintenance-delay': '260ms' } as React.CSSProperties}
          >
            <p>Voltaremos em breve.</p>
          </div>

          <div
            className="maintenance-reveal mt-9 flex w-full justify-center sm:mt-11"
            style={{ '--maintenance-delay': '360ms' } as React.CSSProperties}
          >
            <a
              href={maintenanceContactHref}
              className="premium-button inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black uppercase tracking-normal text-black transition-colors hover:bg-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:min-h-14 sm:px-8"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              <span>Receber novidades</span>
            </a>
          </div>
        </div>

        <footer
          className="maintenance-reveal flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-5 text-center text-xs uppercase tracking-[0.18em] text-zinc-400 sm:flex-row sm:text-left"
          style={{ '--maintenance-delay': '540ms' } as React.CSSProperties}
        >
          <p className="font-mono normal-case tracking-normal text-zinc-400">© 2026 FUNPACE</p>
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-bold text-zinc-400">
            {pillars.map((pillar) => (
              <li key={pillar}>{pillar}</li>
            ))}
          </ul>
        </footer>
      </section>
    </main>
  );
}
