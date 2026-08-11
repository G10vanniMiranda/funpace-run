import type { RegistrationFormData } from '../src/types/registration';
import { arePaymentConfirmationsAllowed, arePaymentCreationsAllowed } from './environment.js';

const linksEndpoint = 'https://api.checkout.infinitepay.io/links';
const paymentCheckEndpoint = 'https://api.checkout.infinitepay.io/payment_check';
const requestTimeoutMs = Number(process.env.INFINITEPAY_TIMEOUT_MS || 10_000);

export type InfinitePayCheckoutInput = {
  handle: string;
  orderNsu: string;
  amountCents: number;
  description: string;
  redirectUrl: string;
  webhookUrl: string;
  customer: RegistrationFormData;
};

export type InfinitePayCheckout = {
  checkoutUrl: string;
  providerPaymentId: string | null;
  raw: unknown;
};

export type InfinitePayPaymentCheckInput = {
  handle: string;
  orderNsu: string;
  transactionNsu: string;
  slug: string;
};

export type InfinitePayPaymentCheck = {
  paid: boolean;
  amountCents: number | null;
  paidAmountCents: number | null;
  raw: unknown;
};

type InfinitePayLinksResponse = {
  url?: string;
  link?: string;
  checkout_url?: string;
  checkoutUrl?: string;
  payment_url?: string;
  invoice_url?: string;
  slug?: string;
  invoice_slug?: string;
  message?: string;
  error?: string;
};

export class InfinitePayError extends Error {
  statusCode?: number;
  payload: unknown;

  constructor(message: string, statusCode?: number, payload?: unknown) {
    super(message);
    this.name = 'InfinitePayError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits ? `+55${digits}` : undefined;
}

function getCheckoutUrl(payload: InfinitePayLinksResponse) {
  return (
    payload.url
    || payload.link
    || payload.checkout_url
    || payload.checkoutUrl
    || payload.payment_url
    || payload.invoice_url
    || ''
  );
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function toCents(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

export async function checkInfinitePayPayment(input: InfinitePayPaymentCheckInput): Promise<InfinitePayPaymentCheck> {
  if (!arePaymentConfirmationsAllowed()) {
    throw new InfinitePayError('Confirmacoes de pagamento desabilitadas neste ambiente.', 503);
  }

  if (!input.handle || !input.orderNsu || !input.transactionNsu || !input.slug) {
    throw new InfinitePayError('Dados insuficientes para consultar o pagamento na InfinitePay.', 400);
  }

  const timeout = createTimeoutSignal(requestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(paymentCheckEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        handle: input.handle,
        order_nsu: input.orderNsu,
        transaction_nsu: input.transactionNsu,
        slug: input.slug,
      }),
      signal: timeout.signal,
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    throw new InfinitePayError(timedOut ? 'A consulta a InfinitePay expirou.' : 'Nao foi possivel consultar a InfinitePay.', timedOut ? 504 : 502);
  } finally {
    timeout.clear();
  }

  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    throw new InfinitePayError('InfinitePay nao confirmou o pagamento.', response.status, payload);
  }

  return {
    paid: payload.paid === true || String(payload.paid).toLowerCase() === 'true',
    amountCents: toCents(payload.amount),
    paidAmountCents: toCents(payload.paid_amount),
    raw: payload,
  };
}

export async function createInfinitePayCheckout(input: InfinitePayCheckoutInput) {
  if (!arePaymentCreationsAllowed()) {
    throw new InfinitePayError('Criacao de pagamentos desabilitada neste ambiente.', 503);
  }

  const body = {
    handle: input.handle,
    order_nsu: input.orderNsu,
    redirect_url: input.redirectUrl,
    webhook_url: input.webhookUrl,
    metadata: {
      registrationId: input.orderNsu,
      orderId: input.orderNsu,
      eventId: 'funpace-run-2026',
    },
    items: [
      {
        quantity: 1,
        price: input.amountCents,
        description: input.description,
      },
    ],
    customer: {
      name: input.customer.fullName,
      email: input.customer.email,
      phone_number: normalizePhone(input.customer.phone),
    },
  };

  const timeout = createTimeoutSignal(requestTimeoutMs);
  const startedAt = Date.now();
  let response: Response;

  try {
    response = await fetch(linksEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    const headersAt = Date.now();
    console.log(JSON.stringify({
      at: new Date(headersAt).toISOString(),
      message: 'infinitepay_checkout_headers_received',
      orderNsu: input.orderNsu,
      statusCode: response.status,
      headersElapsedMs: headersAt - startedAt,
    }));
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';

    throw new InfinitePayError(
      timedOut
        ? 'InfinitePay demorou mais do que o esperado para criar o checkout.'
        : 'Nao foi possivel conectar ao InfinitePay.',
      timedOut ? 504 : undefined,
    );
  } finally {
    timeout.clear();
  }

  const payloadStartedAt = Date.now();
  const payload = await response.json().catch(() => null) as InfinitePayLinksResponse | null;
  const payloadFinishedAt = Date.now();

  console.log(JSON.stringify({
    at: new Date(payloadFinishedAt).toISOString(),
    message: 'infinitepay_checkout_payload_received',
    orderNsu: input.orderNsu,
    statusCode: response.status,
    headersElapsedMs: payloadStartedAt - startedAt,
    payloadElapsedMs: payloadFinishedAt - payloadStartedAt,
    totalElapsedMs: payloadFinishedAt - startedAt,
  }));

  if (!response.ok || !payload) {
    throw new InfinitePayError(
      payload?.message || payload?.error || 'InfinitePay nao criou o link de pagamento.',
      response.status,
      payload,
    );
  }

  const checkoutUrl = getCheckoutUrl(payload);

  if (!checkoutUrl) {
    throw new InfinitePayError('InfinitePay respondeu sem URL de checkout.', response.status, payload);
  }

  return {
    checkoutUrl,
    providerPaymentId: payload.slug || payload.invoice_slug || null,
    raw: payload,
  } satisfies InfinitePayCheckout;
}
