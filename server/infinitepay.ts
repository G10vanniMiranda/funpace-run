import type { RegistrationFormData } from '../src/types/registration';

const linksEndpoint = 'https://api.checkout.infinitepay.io/links';
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

export async function createInfinitePayCheckout(input: InfinitePayCheckoutInput) {
  const body = {
    handle: input.handle,
    order_nsu: input.orderNsu,
    redirect_url: input.redirectUrl,
    webhook_url: input.webhookUrl,
    metadata: {
      registrationId: input.orderNsu,
      orderId: input.orderNsu,
      athleteEmail: input.customer.email,
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
