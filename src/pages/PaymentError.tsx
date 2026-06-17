import { AlertTriangle } from 'lucide-react';

export function PaymentErrorPage() {
  return (
    <main className="flex min-h-screen items-center bg-black px-4 py-12 text-white sm:px-6 md:py-20">
      <section className="mx-auto w-full max-w-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-8 md:p-12">
        <AlertTriangle className="w-12 h-12 text-brand mb-8" />
        <h1 className="mb-6 font-display text-[clamp(2.6rem,12vw,4.5rem)] font-black uppercase leading-none tracking-tighter">
          Pagamento nao concluido.
        </h1>
        <p className="text-zinc-400 font-mono leading-relaxed mb-8">
          A vaga nao foi confirmada. Volte para a inscricao para tentar novamente quando o checkout real estiver habilitado.
        </p>
        <a href="/#register" className="inline-flex min-h-12 items-center bg-brand px-5 py-3 text-sm font-black uppercase tracking-widest text-black sm:px-6 sm:py-4">
          Tentar novamente
        </a>
      </section>
    </main>
  );
}
