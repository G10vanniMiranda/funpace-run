import { lazy, Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { MaintenancePage } from "./components/maintenance";

const SiteApp = lazy(() => import("./SiteApp"));

const maintenanceMode = false;

export default function App() {
  if (maintenanceMode) {
    return (
      <>
        <MaintenancePage />
        <Analytics />
      </>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <SiteApp />
      </Suspense>
      <Analytics />
    </>
  );
}
