import { lazy, Suspense } from "react";
import { MaintenancePage } from "./components/maintenance";

const SiteApp = lazy(() => import("./SiteApp"));

const maintenanceMode = false;

export default function App() {
  if (maintenanceMode) {
    return <MaintenancePage />;
  }

  return (
    <Suspense fallback={null}>
      <SiteApp />
    </Suspense>
  );
}
