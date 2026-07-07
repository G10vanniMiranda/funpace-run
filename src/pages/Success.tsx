import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getWhatsAppUrl } from '../config/whatsapp';
import { ApiError, getRegistrationStatus } from '../lib/api';
import type { RegistrationStatus } from '../types/registration';

const statusLabels: Record<RegistrationStatus, string> = {
  pending_payment: 'Pagamento em processamento',
  paid: 'Inscrição confirmada',
  payment_failed: 'Pagamento não aprovado',
  expired: 'Pagamento expirado',
  cancelled: 'Inscrição cancelada',
  refunded: 'Pagamento reembolsado',
};

const failedStatuses: RegistrationStatus[] = ['payment_failed', 'cancelled', 'refunded', 'expired'];
const pollingDelaysMs = [0, 1500, 3000, 5000, 8000, 12000, 16000, 20000];

export function SuccessPage() {
  const params = new URLSearchParams(window.location.search);
  const registrationId = params.get('registrationId') || params.get('order_nsu') || '';
  const receiptUrl = params.get('receipt_url');
  const captureMethod = params.get('capture_method');
  const transactionNsu = params.get('transaction_nsu');
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [message, setMessage] = useState('Consultando status da inscrição...');
  const supportUrl = getWhatsAppUrl(
    registrationId
      ? `Olá, fiz o pagamento da FunPace Run e preciso confirmar minha inscrição ${registrationId}.`
      : 'Olá, fiz o pagamento da FunPace Run e preciso confirmar minha inscrição.',
  );

  useEffect(() => {
    let cancelled = false;

    if (!registrationId) {
      setMessage('Não encontramos o identificador da inscrição no retorno do pagamento.');
      return;
    }

    async function pollRegistrationStatus() {
      setIsPolling(true);

      for (const delayMs of pollingDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        }

        if (cancelled) {
          return;
        }

        try {
          const registration = await getRegistrationStatus(registrationId);
          const nextStatus = registration.status;

          if (cancelled) {
            return;
          }

          setStatus(nextStatus);

          if (nextStatus === 'paid') {
            setMessage('Pagamento aprovado. Sua inscrição está confirmada.');
            setIsPolling(false);
            return;
          }

          if (failedStatuses.includes(nextStatus)) {
            setMessage('O pagamento não foi confirmado pelo gateway. Se o valor saiu da sua conta, fale com o suporte para conferência.');
            setIsPolling(false);
            return;
          }

          setMessage('Pagamento em processamento. Estamos aguardando a confirmação automática da InfinitePay.');
        } catch (error) {
          if (cancelled) {
            return;
          }

          setMessage(error instanceof ApiError ? error.message : 'Não foi possível consultar a inscrição.');
        }
      }

      if (!cancelled) {
        setIsPolling(false);
        setMessage('Pagamento em processamento. Se o pagamento já foi aprovado no seu banco, aguarde alguns instantes ou fale com o suporte.');
      }
    }

    pollRegistrationStatus();

    return () => {
      cancelled = true;
    };
  }, [registrationId]);

  const isFailed = status ? failedStatuses.includes(status) : false;
  const StatusIcon = status === 'paid' ? CheckCircle2 : isFailed ? XCircle : isPolling ? Loader2 : AlertTriangle;

  return (
    <main className="flex min-h-screen items-center bg-black px-4 py-12 text-white sm:px-6 md:py-20">
      <section className="mx-auto w-full max-w-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-8 md:p-12">
        <StatusIcon className={`mb-8 h-12 w-12 ${isFailed ? 'text-red-400' : 'text-brand'} ${isPolling && status !== 'paid' ? 'animate-spin' : ''}`} />
        <h1 className="mb-6 font-display text-[clamp(2.6rem,12vw,4.5rem)] font-black uppercase leading-none tracking-tighter">
          {status ? statusLabels[status] : 'Pagamento em confirmação'}.
        </h1>
        <p className="mb-8 font-mono leading-relaxed text-zinc-400">
          {message}
        </p>
        {registrationId && (
          <p className="wrap-break-word text-sm font-bold uppercase tracking-widest text-brand">Inscrição: {registrationId}</p>
        )}
        {captureMethod && (
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Método: {captureMethod}</p>
        )}
        {transactionNsu && (
          <p className="mt-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Transação: {transactionNsu}</p>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {receiptUrl && (
            <a href={receiptUrl} className="inline-flex min-h-12 items-center justify-center border border-zinc-700 px-5 py-3 text-sm font-black uppercase tracking-widest sm:px-6 sm:py-4">
              Ver comprovante
            </a>
          )}
          {registrationId && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-12 items-center justify-center border border-zinc-700 px-5 py-3 text-sm font-black uppercase tracking-widest sm:px-6 sm:py-4"
            >
              Ver minha inscrição
            </button>
          )}
          <a href={supportUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center border border-zinc-700 px-5 py-3 text-sm font-black uppercase tracking-widest sm:px-6 sm:py-4">
            Falar com suporte
          </a>
          <a href="/" className="inline-flex min-h-12 items-center justify-center bg-brand px-5 py-3 text-sm font-black uppercase tracking-widest text-black sm:px-6 sm:py-4">
            Voltar para a home
          </a>
        </div>
      </section>
    </main>
  );
}
