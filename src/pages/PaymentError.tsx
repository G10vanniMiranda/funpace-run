import { AlertTriangle } from 'lucide-react';

export function PaymentErrorPage() {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-20 flex items-center">
      <section className="max-w-3xl mx-auto border border-zinc-800 bg-zinc-950 p-8 md:p-12">
        <AlertTriangle className="w-12 h-12 text-brand mb-8" />
        <h1 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none mb-6">
          Pagamento nao concluido.
        </h1>
        <p className="text-zinc-400 font-mono leading-relaxed mb-8">
          A vaga nao foi confirmada. Volte para a inscricao para tentar novamente quando o checkout real estiver habilitado.
        </p>
        <a href="/#register" className="inline-flex bg-brand text-black px-6 py-4 font-black uppercase tracking-widest text-sm">
          Tentar novamente
        </a>
      </section>
    </main>
  );
}
