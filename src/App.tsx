import { lazy, Suspense, useEffect } from "react";
import { Analytics } from "@vercel/analytics/react";
import { MaintenancePage } from "./components/maintenance";
import { MetaPixelTracker } from "./components/MetaPixelTracker";
import { PrivacyConsentManager } from "./components/privacy/PrivacyConsentManager";
import { usePrivacyConsent } from "./hooks/usePrivacyConsent";
import { synchronizeMarketingConsent } from "./lib/marketingConsentSync";

const SiteApp = lazy(() => import("./SiteApp"));

const maintenanceMode = false;

export default function App() {
  const consent = usePrivacyConsent();

  useEffect(() => {
    if (!consent.hasDecision) return;
    void synchronizeMarketingConsent(consent.preferences.marketing, consent.updatedAt || new Date().toISOString());
  }, [consent.hasDecision, consent.preferences.marketing, consent.updatedAt]);

  if (maintenanceMode) {
    return (
      <>
        <MaintenancePage />
        <MetaPixelTracker marketingAllowed={consent.preferences.marketing} />
        {consent.preferences.statistics ? <Analytics /> : null}
        <PrivacyConsentManager />
      </>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <SiteApp />
      </Suspense>
      <MetaPixelTracker marketingAllowed={consent.preferences.marketing} />
      {consent.preferences.statistics ? <Analytics /> : null}
      <PrivacyConsentManager />
    </>
  );
}
