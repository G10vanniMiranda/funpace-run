import { CheckCircle2 } from 'lucide-react';

export function SuccessPage() {
  const params = new URLSearchParams(window.location.search);
  const registrationId = params.get('registrationId');

  return (
    <main className="min-h-screen bg-black text-white px-6 py-20 flex items-center">
      <section className="max-w-3xl mx-auto border border-zinc-800 bg-zinc-950 p-8 md:p-12">
        <CheckCircle2 className="w-12 h-12 text-brand mb-8" />
        <h1 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none mb-6">
          Pagamento em confirmacao.
        </h1>
        <p className="text-zinc-400 font-mono leading-relaxed mb-8">
          Quando o gateway confirmar o pagamento pelo webhook, a inscricao mudara para status pago e a confirmacao podera ser enviada por e-mail ou WhatsApp.
        </p>
        {registrationId && (
          <p className="text-sm font-bold uppercase tracking-widest text-brand">Inscricao: {registrationId}</p>
        )}
        <a href="/" className="inline-flex mt-10 bg-brand text-black px-6 py-4 font-black uppercase tracking-widest text-sm">
          Voltar para a landing
        </a>
      </section>
    </main>
  );
}
