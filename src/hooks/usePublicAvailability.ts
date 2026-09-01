import { useEffect, useState } from 'react';
import { getAvailability } from '../lib/api';
import type { AvailabilityResponse } from '../types/registration';
import { selectPublicActiveLot, type PublicActiveLotState } from '../lib/publicActiveLot';

export function createSharedInFlightLoader<T>(request: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;

  return () => {
    if (inFlight) return inFlight;

    const pending = request();
    inFlight = pending;
    void pending.then(
      () => {
        if (inFlight === pending) inFlight = null;
      },
      () => {
        if (inFlight === pending) inFlight = null;
      },
    );
    return pending;
  };
}

// Hero and RegistrationSection share concurrent requests, but a settled
// response is not retained across a later SPA remount.
const loadAvailability = createSharedInFlightLoader(getAvailability);

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
