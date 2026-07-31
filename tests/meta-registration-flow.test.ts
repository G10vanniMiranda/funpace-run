import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { areExternalPaymentsAllowed } from '../server/environment';
import {
  enqueueMetaRegistrationFlow,
  resolveMetaRegistrationFlow,
} from '../server/meta-registration-flow';

const committedRegistration = {
  registrationId: 'registration-123',
  statusCode: 201,
  success: true,
  checkoutRequested: false,
  marketingConsent: true,
};

test('persisted registration queues CompleteRegistration without a checkout URL', () => {
  const flow = resolveMetaRegistrationFlow(committedRegistration);
  assert.equal(flow.shouldQueueCompleteRegistration, true);
  assert.equal(flow.completeRegistrationEventId, 'complete_registration_registration-123');
  assert.equal(flow.shouldQueueInitiateCheckout, false);
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

test('Meta queue failure is isolated and does not reject the registration flow', async () => {
  const flow = resolveMetaRegistrationFlow({
    ...committedRegistration,
    checkoutRequested: true,
  });
  let initiateCalls = 0;
  const result = await enqueueMetaRegistrationFlow(flow, {
    queueCompleteRegistration: async () => {
      throw new Error('simulated Meta outage');
    },
    queueInitiateCheckout: async () => {
      initiateCalls += 1;
      return true;
    },
  });
  assert.equal(result.completeRegistrationQueued, false);
  assert.equal(result.initiateCheckoutQueued, true);
  assert.equal(result.failures.length, 1);
  assert.equal(initiateCalls, 1);
});

test('repeating the same registration resolves the same event IDs', () => {
  const input = { ...committedRegistration, checkoutRequested: true };
  assert.deepEqual(resolveMetaRegistrationFlow(input), resolveMetaRegistrationFlow(input));
});

test('negative marketing consent suppresses both registration events', () => {
  const flow = resolveMetaRegistrationFlow({
    ...committedRegistration,
    checkoutRequested: true,
    marketingConsent: false,
  });
  assert.equal(flow.shouldQueueCompleteRegistration, false);
  assert.equal(flow.shouldQueueInitiateCheckout, false);
  assert.equal(flow.completeRegistrationEventId, null);
  assert.equal(flow.initiateCheckoutEventId, null);
});

test('missing marketing consent fails closed and does not call queue handlers', async () => {
  const flow = resolveMetaRegistrationFlow({
    registrationId: committedRegistration.registrationId,
    statusCode: committedRegistration.statusCode,
    success: committedRegistration.success,
    checkoutRequested: true,
  });
  let queueCalls = 0;
  const result = await enqueueMetaRegistrationFlow(flow, {
    queueCompleteRegistration: async () => {
      queueCalls += 1;
      return true;
    },
    queueInitiateCheckout: async () => {
      queueCalls += 1;
      return true;
    },
  });

  assert.equal(flow.shouldQueueCompleteRegistration, false);
  assert.equal(flow.shouldQueueInitiateCheckout, false);
  assert.equal(queueCalls, 0);
  assert.equal(result.completeRegistrationQueued, false);
  assert.equal(result.initiateCheckoutQueued, false);
});

test('real checkout intent gets a backend-authoritative deterministic attempt ID', () => {
  const flow = resolveMetaRegistrationFlow({
    ...committedRegistration,
    checkoutRequested: true,
  });
  assert.equal(flow.shouldQueueInitiateCheckout, true);
  assert.equal(flow.initiateCheckoutEventId, 'initiate_checkout_registration-123');
});

test('simple registration creation does not queue InitiateCheckout', () => {
  const flow = resolveMetaRegistrationFlow(committedRegistration);
  assert.equal(flow.shouldQueueInitiateCheckout, false);
  assert.equal(flow.initiateCheckoutEventId, null);
});

test('failed persistence does not queue Meta registration events', () => {
  const flow = resolveMetaRegistrationFlow({
    ...committedRegistration,
    success: false,
    statusCode: 500,
    checkoutRequested: true,
  });
  assert.equal(flow.shouldQueueCompleteRegistration, false);
  assert.equal(flow.shouldQueueInitiateCheckout, false);
});

test('homologation response is controlled and InfinitePay remains server-gated', () => {
  const source = readFileSync('server/index.ts', 'utf8');
  const queuePosition = source.indexOf('enqueueMetaRegistrationFlow(metaFlow');
  const providerPosition = source.indexOf('const checkout = await createInfinitePayCheckout');
  const processPosition = source.indexOf('if (metaEventsQueued) await processMetaIntegrationQueue');
  const responsePosition = source.indexOf('json(res, statusCode, payloadResponse)');
  assert.ok(queuePosition >= 0 && providerPosition > queuePosition);
  assert.ok(processPosition > queuePosition && responsePosition > processPosition);
  assert.match(source, /processMetaIntegrationQueue\(5\)\.catch\(\(\) => undefined\)/);
  assert.match(source, /paymentProvider === 'infinitepay'/);
  assert.match(source, /isHomologationEnvironment\(\)\s*&&\s*!externalPaymentsAllowed/);
  assert.match(source, /Pagamento externo desabilitado em homologacao\./);
  assert.match(source, /checkoutSimulated = false/);
  assert.match(source, /paymentProviderCalled = false/);
});

test('browser consumes the exact event IDs returned or confirmed by the backend', () => {
  const form = readFileSync('src/components/forms.tsx', 'utf8');
  assert.match(form, /eventID: `complete_registration_\$\{response\.registrationId\}`/);
  assert.match(form, /eventID: response\.attemptId/);
  assert.doesNotMatch(form, /createMetaInitiateCheckoutId/);
});

test('Purchase eligibility remains restricted to persisted paid state', () => {
  const events = readFileSync('server/meta-events.ts', 'utf8');
  assert.match(
    events,
    /registrationStatus === 'paid' && paymentStatus === 'paid' && Boolean\(paidAt\)/,
  );
});
