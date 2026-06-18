import type { RegistrationFormData } from '../src/types/registration';

const linksEndpoint = 'https://api.checkout.infinitepay.io/links';

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

export async function createInfinitePayCheckout(input: InfinitePayCheckoutInput) {
  const body = {
    handle: input.handle,
    order_nsu: input.orderNsu,
    redirect_url: input.redirectUrl,
    webhook_url: input.webhookUrl,
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

  const response = await fetch(linksEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as InfinitePayLinksResponse | null;

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
