import { useSyncExternalStore } from 'react';
import {
  getMarketingConsentSyncSnapshot,
  getServerMarketingConsentSyncSnapshot,
  subscribeMarketingConsentSync,
} from '../lib/marketingConsentSync';

export function useMarketingConsentSync() {
  return useSyncExternalStore(
    subscribeMarketingConsentSync,
    getMarketingConsentSyncSnapshot,
    getServerMarketingConsentSyncSnapshot,
  );
}
