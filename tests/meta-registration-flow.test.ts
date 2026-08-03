import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { areExternalPaymentsAllowed } from '../server/environment';
import {
  enqueueMetaRegistrationFlow,
  resolveMetaCheckoutFlow,
  resolveMetaRegistrationFlow,
} from '../server/meta-registration-flow';

const committedRegistration = {
  registrationId: 'registration-123',
  statusCode: 201,
  success: true,
  marketingConsent: true,
};

test('persisted registration queues only CompleteRegistration before checkout exists', () => {
  const flow = resolveMetaRegistrationFlow(committedRegistration);
  assert.equal(flow.shouldQueueCompleteRegistration, true);
  assert.equal(flow.completeRegistrationEventId, 'complete_registration_registration-123');
  assert.equal('initiateCheckoutEventId' in flow, false);
});

test('persisted registration still queues CompleteRegistration with homologation payments disabled', () => {
  const environment = {
    APP_ENV: 'homologation',
    PAYMENTS_ENABLED: 'false',
    HOMOLOGATION_PAYMENTS_ENABLED: 'false',
  };
  assert.equal(areExternalPaymentsAllowed(environment), false);
  assert.equal(resolveMetaRegistrationFlow(committedRegistration).shouldQueueCompleteRegistration, true);
});

test('CompleteRegistration queue failure is isolated from the registration flow', async () => {
  const result = await enqueueMetaRegistrationFlow(
    resolveMetaRegistrationFlow(committedRegistration),
    { queueCompleteRegistration: async () => { throw new Error('simulated Meta outage'); } },
  );
  assert.equal(result.completeRegistrationQueued, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.eventName, 'CompleteRegistration');
});

test('negative or missing marketing consent suppresses registration events', async () => {
  for (const marketingConsent of [false, undefined]) {
    const flow = resolveMetaRegistrationFlow({ ...committedRegistration, marketingConsent });
    let queueCalls = 0;
    const result = await enqueueMetaRegistrationFlow(flow, {
      queueCompleteRegistration: async () => { queueCalls += 1; return true; },
    });
    assert.equal(flow.shouldQueueCompleteRegistration, false);
    assert.equal(flow.completeRegistrationEventId, null);
    assert.equal(queueCalls, 0);
    assert.equal(result.completeRegistrationQueued, false);
  }
});

test('failed persistence does not queue Meta registration events', () => {
  const flow = resolveMetaRegistrationFlow({ ...committedRegistration, success: false, statusCode: 500 });
  assert.equal(flow.shouldQueueCompleteRegistration, false);
});

test('gateway OK creates deterministic InitiateCheckout only after persisted valid reference', () => {
  const flow = resolveMetaCheckoutFlow({
    registrationId: committedRegistration.registrationId,
    checkoutPersisted: true,
    checkoutReferencePresent: true,
    marketingConsent: true,
  });
  assert.equal(flow.shouldQueueInitiateCheckout, true);
  assert.equal(flow.initiateCheckoutEventId, 'initiate_checkout_registration-123');
});

test('gateway failure or invalid response creates no InitiateCheckout', () => {
  const base = { registrationId: committedRegistration.registrationId, marketingConsent: true };
  assert.equal(resolveMetaCheckoutFlow({ ...base, checkoutPersisted: false, checkoutReferencePresent: true }).shouldQueueInitiateCheckout, false);
  assert.equal(resolveMetaCheckoutFlow({ ...base, checkoutPersisted: true, checkoutReferencePresent: false }).shouldQueueInitiateCheckout, false);
});

test('InitiateCheckout resolution is idempotent and does not mutate checkout state', () => {
  const input = Object.freeze({
    registrationId: committedRegistration.registrationId,
    checkoutPersisted: true,
    checkoutReferencePresent: true,
    marketingConsent: true,
  });
  assert.deepEqual(resolveMetaCheckoutFlow(input), resolveMetaCheckoutFlow(input));
  assert.deepEqual(input, {
    registrationId: 'registration-123', checkoutPersisted: true,
    checkoutReferencePresent: true, marketingConsent: true,
  });
});

test('revoked consent suppresses InitiateCheckout after checkout persistence', () => {
  const flow = resolveMetaCheckoutFlow({
    registrationId: committedRegistration.registrationId,
    checkoutPersisted: true,
    checkoutReferencePresent: true,
    marketingConsent: false,
  });
  assert.equal(flow.shouldQueueInitiateCheckout, false);
  assert.equal(flow.initiateCheckoutEventId, null);
});

test('server queues InitiateCheckout after gateway response and checkout persistence', () => {
  const source = readFileSync('server/index.ts', 'utf8');
  const providerPosition = source.indexOf('const checkout = await createInfinitePayCheckout');
  const persistPosition = source.indexOf("logStage('checkout_persist_finished'");
  const decisionPosition = source.indexOf('const checkoutMetaFlow = resolveMetaCheckoutFlow');
  const queuePosition = source.indexOf('const queued = await queueMetaInitiateCheckoutEvent');
  const processPosition = source.indexOf('if (metaEventsQueued) await processMetaIntegrationQueue');
  const responsePosition = source.indexOf('json(res, statusCode, payloadResponse)');
  assert.ok(providerPosition >= 0);
  assert.ok(persistPosition > providerPosition);
  assert.ok(decisionPosition > persistPosition);
  assert.ok(queuePosition > decisionPosition);
  assert.ok(processPosition > queuePosition && responsePosition > processPosition);
  assert.match(source, /checkoutReferencePresent: Boolean\(checkout\.checkoutUrl\?\.trim\(\) \|\| checkout\.providerPaymentId\?\.trim\(\)\)/);
  assert.match(source, /response\.attemptId = null/);
  assert.match(source, /processMetaIntegrationQueue\(5\)\.catch\(\(\) => undefined\)/);
});

test('gateway catch path does not enqueue InitiateCheckout', () => {
  const source = readFileSync('server/index.ts', 'utf8');
  const catchStart = source.indexOf("logStage('checkout_create_failed'");
  const catchEnd = source.indexOf('const { statusCode', catchStart);
  const catchBlock = source.slice(catchStart, catchEnd);
  assert.doesNotMatch(catchBlock, /queueMetaInitiateCheckoutEvent/);
});

test('browser consumes the exact event IDs returned or confirmed by the backend', () => {
  const form = readFileSync('src/components/forms.tsx', 'utf8');
  assert.match(form, /eventID: `complete_registration_\$\{response\.registrationId\}`/);
  assert.match(form, /eventID: response\.attemptId/);
  assert.doesNotMatch(form, /createMetaInitiateCheckoutId/);
});

test('Purchase eligibility remains restricted to paid state and current consent', () => {
  const events = readFileSync('server/meta-events.ts', 'utf8');
  assert.match(events, /registrationStatus === 'paid'/);
  assert.match(events, /paymentStatus === 'paid'/);
  assert.match(events, /isMarketingConsentGranted\(marketingConsent\)/);
});
