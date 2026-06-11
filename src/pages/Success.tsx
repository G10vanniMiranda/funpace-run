import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, getRegistrationStatus } from '../lib/api';
import type { RegistrationStatus } from '../types/registration';

const statusLabels: Record<RegistrationStatus, string> = {
  pending_payment: 'Pagamento em confirmacao',
  paid: 'Inscricao confirmada',
  payment_failed: 'Pagamento nao aprovado',
  expired: 'Pagamento expirado',
  cancelled: 'Inscricao cancelada',
  refunded: 'Pagamento reembolsado',
};

export function SuccessPage() {
  const params = new URLSearchParams(window.location.search);
  const registrationId = params.get('registrationId') || params.get('order_nsu') || '';
  const receiptUrl = params.get('receipt_url');
  const captureMethod = params.get('capture_method');
  const transactionNsu = params.get('transaction_nsu');
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [message, setMessage] = useState('Consultando status da inscricao...');

  useEffect(() => {
    if (!registrationId) {
      setMessage('Nao encontramos o identificador da inscricao no retorno do pagamento.');
      return;
    }

    getRegistrationStatus(registrationId)
      .then((registration) => {
        setStatus(registration.status);
        setMessage(
          registration.status === 'paid'
            ? 'Pagamento aprovado. Sua inscricao esta confirmada.'
            : 'Recebemos o retorno do checkout. A confirmacao final depende do processamento do pagamento pela InfinitePay.',
        );
      })
      .catch((error) => {
        setMessage(error instanceof ApiError ? error.message : 'Nao foi possivel consultar a inscricao.');
      });
  }, [registrationId]);

  return (
    <main className="min-h-screen bg-black text-white px-6 py-20 flex items-center">
      <section className="max-w-3xl mx-auto border border-zinc-800 bg-zinc-950 p-8 md:p-12">
        <CheckCircle2 className="w-12 h-12 text-brand mb-8" />
        <h1 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tighter leading-none mb-6">
          {status ? statusLabels[status] : 'Pagamento em confirmacao'}.
        </h1>
        <p className="text-zinc-400 font-mono leading-relaxed mb-8">
          {message}
        </p>
        {registrationId && (
          <p className="text-sm font-bold uppercase tracking-widest text-brand">Inscricao: {registrationId}</p>
        )}
        {captureMethod && (
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Metodo: {captureMethod}</p>
        )}
        {transactionNsu && (
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Transacao: {transactionNsu}</p>
        )}
        {receiptUrl && (
          <a href={receiptUrl} className="inline-flex mt-8 mr-3 border border-zinc-700 px-6 py-4 font-black uppercase tracking-widest text-sm">
            Ver comprovante
          </a>
        )}
        <a href="/" className="inline-flex mt-10 bg-brand text-black px-6 py-4 font-black uppercase tracking-widest text-sm">
          Voltar para a landing
        </a>
      </section>
    </main>
  );
}
