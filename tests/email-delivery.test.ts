import test from 'node:test';
import assert from 'node:assert/strict';

test('sends Resend requests with a stable idempotency key and timeout signal', async () => {
  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'FunPace <test@funpace.club>';

  let request: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(JSON.stringify({ id: 'email_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const { sendRegistrationConfirmationEmail } = await import(`../server/email.js?test=${Date.now()}`);
    const result = await sendRegistrationConfirmationEmail({
      registration: {
        id: 'registration-123',
        eventId: 'event-123',
        distanceId: 'distance-123',
        lotId: 'lot-123',
        cpfHash: 'hash',
        status: 'paid',
        amountCents: 7990,
        payload: {
          fullName: 'Test Athlete',
          email: 'athlete@example.com',
          cpf: '000.000.000-00',
          phone: '(00) 00000-0000',
          city: 'Porto Velho',
          state: 'RO',
          team: '',
          birthDate: '1990-01-01',
          gender: 'male',
          shirtSize: 'M',
          distance: '5K',
          emergencyContactName: 'Test Contact',
          emergencyContactPhone: '(00) 00000-0000',
          termsAccepted: true,
          regulationAccepted: true,
          privacyAccepted: true,
        },
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        paidAt: '2026-07-07T00:10:00.000Z',
        confirmedAt: '2026-07-07T00:10:00.000Z',
        bibNumber: '0001',
      },
      event: {
        id: 'event-123',
        name: 'FunPace Run 2026',
        slug: 'funpace-run-2026',
        status: 'published',
        date: '2026-09-20',
        startTime: '06:00',
        locationName: 'Complexo Madeira Mamore',
        city: 'Porto Velho',
        state: 'RO',
      },
      distanceName: '5K',
      lot: null,
      paymentMethod: 'pix',
      deliveryKey: 'confirmation/registration-123',
    });

    assert.equal(result.ok, true);
    assert.equal(result.providerMessageId, 'email_123');
    assert.equal(new Headers(request?.headers).get('Idempotency-Key'), 'confirmation/registration-123');
    assert.ok(request?.signal instanceof AbortSignal);
    const body = JSON.parse(String(request?.body || '{}'));
    assert.equal(body.subject, 'Inscrição confirmada | FunPace Run');
    assert.match(body.text, /Status: INSCRIÇÃO CONFIRMADA/);
    assert.match(body.text, /Forma de pagamento: pix/);
    assert.match(body.html, /QR Code da inscrição/);
    assert.doesNotMatch(body.subject, /recebida/i);
    assert.doesNotMatch(body.text, /Inscrição recebida/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
