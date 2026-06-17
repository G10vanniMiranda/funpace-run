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
    <main className="flex min-h-screen items-center bg-black px-4 py-12 text-white sm:px-6 md:py-20">
      <section className="mx-auto w-full max-w-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-8 md:p-12">
        <CheckCircle2 className="w-12 h-12 text-brand mb-8" />
        <h1 className="mb-6 font-display text-[clamp(2.6rem,12vw,4.5rem)] font-black uppercase leading-none tracking-tighter">
          {status ? statusLabels[status] : 'Pagamento em confirmacao'}.
        </h1>
        <p className="text-zinc-400 font-mono leading-relaxed mb-8">
          {message}
        </p>
        {registrationId && (
          <p className="break-words text-sm font-bold uppercase tracking-widest text-brand">Inscricao: {registrationId}</p>
        )}
        {captureMethod && (
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Metodo: {captureMethod}</p>
        )}
        {transactionNsu && (
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Transacao: {transactionNsu}</p>
        )}
        {receiptUrl && (
          <a href={receiptUrl} className="mr-3 mt-8 inline-flex min-h-12 items-center border border-zinc-700 px-5 py-3 text-sm font-black uppercase tracking-widest sm:px-6 sm:py-4">
            Ver comprovante
          </a>
        )}
        <a href="/" className="mt-6 inline-flex min-h-12 items-center bg-brand px-5 py-3 text-sm font-black uppercase tracking-widest text-black sm:mt-10 sm:px-6 sm:py-4">
          Voltar para a landing
        </a>
      </section>
    </main>
  );
}
