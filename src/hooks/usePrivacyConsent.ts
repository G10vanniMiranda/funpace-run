import { useSyncExternalStore } from 'react';
import {
  getPrivacyConsentSnapshot,
  getServerPrivacyConsentSnapshot,
  subscribePrivacyConsent,
} from '../lib/privacyConsent';

export function usePrivacyConsent() {
  return useSyncExternalStore(
    subscribePrivacyConsent,
    getPrivacyConsentSnapshot,
    getServerPrivacyConsentSnapshot,
  );
}
