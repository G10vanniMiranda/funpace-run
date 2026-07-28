import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, Download } from 'lucide-react';
import { regulationChapters, type RegulationBlock } from '../content/regulation';
import { usePageMetadata } from '../lib/seo';

const canonicalUrl = 'https://funpace.club/regulamento';
const description = 'Consulte o regulamento oficial da Funpace Run Experience 2026, com informações sobre a prova, premiação, inscrição, número de peito e instruções gerais.';

export function RegulationPage() {
  usePageMetadata({
    title: 'Regulamento | Funpace Run Experience 2026',
    description,
    canonical: canonicalUrl,
  });

  const openChapter = (chapterId: string) => {
    const chapter = document.getElementById(chapterId);
    chapter?.querySelector('details')?.setAttribute('open', '');
  };

  return (
    <main id="top" className="premium-shell min-h-screen bg-black text-white">
      <section className="relative overflow-hidden border-b border-white/10 px-4 pb-14 pt-14 sm:px-6 sm:pb-18 sm:pt-18 md:pb-24 md:pt-24">
        <div className="premium-aurora opacity-30" aria-hidden="true" />
        <div className="premium-grid opacity-25" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl">
          <a
            href="/"
            className="inline-flex min-h-11 items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-400 transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar para o evento
          </a>

          <h1 className="mt-4 max-w-5xl font-display text-[clamp(2.8rem,10vw,7rem)] font-black uppercase leading-[0.88] tracking-tighter">
            Regulamento
          </h1>
          <p className="mt-5 max-w-3xl text-lg font-medium leading-relaxed text-zinc-300 sm:text-xl">
            Funpace Run Experience 2026
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#indice"
              className="premium-button inline-flex min-h-12 items-center justify-center gap-2 bg-brand px-5 py-3 text-xs font-black uppercase tracking-widest text-black hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:w-fit"
            >
              Explorar capítulos
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </a>
            <a
              href="/regulamento/regulamento.docx"
              download
              className="inline-flex min-h-12 items-center justify-center gap-2 border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-widest text-zinc-200 transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand sm:w-fit"
              aria-label="Baixar o regulamento oficial em formato Word"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Baixar documento oficial
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:py-18 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-14 lg:py-24">
        <aside id="indice" className="scroll-mt-28 lg:sticky lg:top-24 lg:self-start" aria-labelledby="indice-title">
          <div className="border border-white/10 bg-zinc-950/90 p-5 sm:p-6">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-brand">
              Navegação rápida
            </p>
            <h2 id="indice-title" className="mt-2 font-display text-2xl font-black uppercase">
              Índice
            </h2>
            <nav className="mt-5" aria-label="Índice do regulamento">
              <ol className="space-y-1">
                {regulationChapters.map((chapter, index) => (
                  <li key={chapter.id}>
                    <a
                      href={`#${chapter.id}`}
                      onClick={() => openChapter(chapter.id)}
                      className="group flex min-h-11 items-start gap-3 border-l border-white/10 px-3 py-2.5 text-sm leading-snug text-zinc-400 transition-colors hover:border-brand hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <span className="font-mono text-[10px] font-bold text-brand" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span>{chapter.indexLabel}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </aside>

        <article aria-label="Texto do regulamento oficial" className="min-w-0 space-y-5">
          {regulationChapters.map((chapter, index) => (
            <section key={chapter.id} id={chapter.id} className="scroll-mt-24">
              <details
                open={index === 0}
                className="group overflow-hidden border border-white/10 bg-zinc-950/80 open:border-brand/35"
              >
                <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-4 px-5 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-brand sm:px-7 sm:py-6 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <h2 className="mt-2 font-display text-[clamp(1.35rem,5vw,2.25rem)] font-black uppercase leading-tight tracking-tight text-white">
                      {chapter.title}
                    </h2>
                  </div>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/15 text-brand transition-transform group-open:rotate-180" aria-hidden="true">
                    <ChevronDown className="h-5 w-5" />
                  </span>
                </summary>

                <div className="border-t border-white/10 px-5 py-6 sm:px-7 sm:py-8 md:px-9">
                  <div className="space-y-5 text-[0.95rem] leading-7 text-zinc-300 sm:text-base sm:leading-8">
                    {chapter.blocks.map((block, blockIndex) => (
                      <RegulationBlockContent key={`${chapter.id}-${blockIndex}`} block={block} />
                    ))}
                  </div>
                  <a
                    href="#indice"
                    className="mt-8 inline-flex min-h-11 items-center gap-2 text-xs font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                  >
                    Voltar ao índice
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </a>
                </div>
              </details>
            </section>
          ))}
        </article>
      </div>

    </main>
  );
}

function RegulationBlockContent({ block }: { block: RegulationBlock }) {
  if (block.kind === 'highlight') {
    return (
      <div className="border-l-2 border-brand bg-white/4 px-4 py-4 sm:px-5">
        <p className="font-display text-base font-black uppercase leading-snug text-white">{block.title}</p>
        {block.text ? <p className="mt-2 text-zinc-300">{block.text}</p> : null}
      </div>
    );
  }

  if (block.kind === 'schedule') {
    return (
      <section className="border border-white/10 bg-black/40 p-4 sm:p-5" aria-label="Programação da prova">
        <h3 className="font-display text-lg font-black uppercase text-brand">{block.title}</h3>
        <p className="mt-3 font-bold text-white">{block.location}</p>
        <ul className="mt-4 space-y-2 font-mono text-sm text-zinc-300">
          {block.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
    );
  }

  return (
    <div className="grid gap-2 border-b border-white/7 pb-5 sm:grid-cols-[3.75rem_minmax(0,1fr)] sm:gap-4">
      <p className="font-mono text-xs font-black text-brand">{block.number}</p>
      <p>{block.text}</p>
    </div>
  );
}
