import { useEffect, useState } from 'react';
import { getAvailability } from '../lib/api';
import type { AvailabilityResponse } from '../types/registration';
import { selectPublicActiveLot, type PublicActiveLotState } from '../lib/publicActiveLot';

// One shared /api/availability request for the whole public page. Hero and
// RegistrationSection both need the canonical active lot; caching the in-flight
// promise at module scope means mounting both fires ONE request, not two. This
// is request de-duplication, not a global store.
let sharedRequest: Promise<AvailabilityResponse> | null = null;

function loadAvailability(): Promise<AvailabilityResponse> {
  if (!sharedRequest) {
    sharedRequest = getAvailability().catch((error: unknown) => {
      sharedRequest = null; // a failed fetch must not be cached — allow a later retry
      throw error;
    });
  }
  return sharedRequest;
}

// Test seam: drop the cached request between cases.
export function __resetPublicAvailabilityCache() {
  sharedRequest = null;
}

export type PublicAvailability = {
  availability: AvailabilityResponse | null;
  fetchFailed: boolean;
  activeLot: PublicActiveLotState;
};

export function usePublicAvailability(): PublicAvailability {
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadAvailability()
      .then((response) => {
        if (mounted) {
          setAvailability(response);
          setFetchFailed(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setAvailability(null);
          setFetchFailed(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  return { availability, fetchFailed, activeLot: selectPublicActiveLot(availability, fetchFailed) };
}
