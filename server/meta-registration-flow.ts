import { isMarketingConsentGranted } from '../src/lib/privacyConsent.js';

export type MetaRegistrationFlowDecision = {
  registrationId: string;
  completeRegistrationEventId: string | null;
  shouldQueueCompleteRegistration: boolean;
};

type ResolveMetaRegistrationFlowInput = {
  registrationId: string;
  statusCode: number;
  success: boolean;
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

  return {
    registrationId,
    completeRegistrationEventId: shouldQueueCompleteRegistration
      ? `complete_registration_${registrationId}`
      : null,
    shouldQueueCompleteRegistration,
  };
}

export type MetaCheckoutFlowDecision = {
  registrationId: string;
  initiateCheckoutEventId: string | null;
  shouldQueueInitiateCheckout: boolean;
};

export function resolveMetaCheckoutFlow(input: {
  registrationId: string;
  checkoutPersisted: boolean;
  checkoutReferencePresent: boolean;
  marketingConsent?: boolean;
}): MetaCheckoutFlowDecision {
  const registrationId = input.registrationId.trim();
  const shouldQueueInitiateCheckout = Boolean(
    registrationId
    && input.checkoutPersisted
    && input.checkoutReferencePresent
    && isMarketingConsentGranted(input.marketingConsent),
  );
  return {
    registrationId,
    initiateCheckoutEventId: shouldQueueInitiateCheckout
      ? `initiate_checkout_${registrationId}`
      : null,
    shouldQueueInitiateCheckout,
  };
}

type MetaRegistrationQueueHandlers = {
  queueCompleteRegistration: (eventId: string) => Promise<boolean>;
};

export type MetaRegistrationQueueResult = {
  completeRegistrationQueued: boolean;
  failures: Array<{
    eventName: 'CompleteRegistration';
    error: unknown;
  }>;
};

export async function enqueueMetaRegistrationFlow(
  decision: MetaRegistrationFlowDecision,
  handlers: MetaRegistrationQueueHandlers,
): Promise<MetaRegistrationQueueResult> {
  const result: MetaRegistrationQueueResult = {
    completeRegistrationQueued: false,
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
  return result;
}
