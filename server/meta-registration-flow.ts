import { isMarketingConsentGranted } from '../src/lib/privacyConsent.js';

export type MetaRegistrationFlowDecision = {
  registrationId: string;
  completeRegistrationEventId: string | null;
  initiateCheckoutEventId: string | null;
  shouldQueueCompleteRegistration: boolean;
  shouldQueueInitiateCheckout: boolean;
};

type ResolveMetaRegistrationFlowInput = {
  registrationId: string;
  statusCode: number;
  success: boolean;
  checkoutRequested: boolean;
  marketingConsent?: boolean;
};

export function resolveMetaRegistrationFlow(
  input: ResolveMetaRegistrationFlowInput,
): MetaRegistrationFlowDecision {
  const registrationId = input.registrationId.trim();
  const registrationCommitted = Boolean(
    registrationId
    && input.success
    && input.statusCode >= 200
    && input.statusCode < 300,
  );
  const consentGranted = isMarketingConsentGranted(input.marketingConsent);
  const shouldQueueCompleteRegistration = registrationCommitted && consentGranted;
  const shouldQueueInitiateCheckout = shouldQueueCompleteRegistration && input.checkoutRequested;

  return {
    registrationId,
    completeRegistrationEventId: shouldQueueCompleteRegistration
      ? `complete_registration_${registrationId}`
      : null,
    initiateCheckoutEventId: shouldQueueInitiateCheckout
      ? `initiate_checkout_${registrationId}`
      : null,
    shouldQueueCompleteRegistration,
    shouldQueueInitiateCheckout,
  };
}

type MetaRegistrationQueueHandlers = {
  queueCompleteRegistration: (eventId: string) => Promise<boolean>;
  queueInitiateCheckout: (eventId: string) => Promise<boolean>;
};

export type MetaRegistrationQueueResult = {
  completeRegistrationQueued: boolean;
  initiateCheckoutQueued: boolean;
  failures: Array<{
    eventName: 'CompleteRegistration' | 'InitiateCheckout';
    error: unknown;
  }>;
};

export async function enqueueMetaRegistrationFlow(
  decision: MetaRegistrationFlowDecision,
  handlers: MetaRegistrationQueueHandlers,
): Promise<MetaRegistrationQueueResult> {
  const result: MetaRegistrationQueueResult = {
    completeRegistrationQueued: false,
    initiateCheckoutQueued: false,
    failures: [],
  };

  if (decision.shouldQueueCompleteRegistration && decision.completeRegistrationEventId) {
    try {
      result.completeRegistrationQueued = await handlers.queueCompleteRegistration(
        decision.completeRegistrationEventId,
      );
    } catch (error) {
      result.failures.push({ eventName: 'CompleteRegistration', error });
    }
  }

  if (decision.shouldQueueInitiateCheckout && decision.initiateCheckoutEventId) {
    try {
      result.initiateCheckoutQueued = await handlers.queueInitiateCheckout(
        decision.initiateCheckoutEventId,
      );
    } catch (error) {
      result.failures.push({ eventName: 'InitiateCheckout', error });
    }
  }

  return result;
}
