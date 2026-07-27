import type { ReactNode } from "react";
import { Marquee, Footer } from "./components/layout";
import { Hero } from "./components/hero";
import { RegistrationSection, SponsorSection } from "./components/forms";
import { CourseMap, Gallery } from "./components/visuals";
import { FAQSection } from "./components/faq";
import { KitSection } from "./components/kit";
import { PremiumCursor } from "./components/premium";
import { WhatsAppSupportButton } from "./components/WhatsAppSupportButton";
import { AdminPage } from "./pages/Admin";
import { PaymentErrorPage } from "./pages/PaymentError";
import { PrivacyPage, TermsPage } from "./pages/Privacy";
import { SuccessPage } from "./pages/Success";
import { PartnerLandingPage } from "./pages/PartnerLanding";

// Re-enable only after the official course map is available.
const showCourseMap = false;

export default function SiteApp() {
  const pathname = window.location.pathname;
  const partnerPath = pathname.match(/^\/p\/([^/]+)\/?$/);

  if (partnerPath) {
    return <PublicPage><PartnerLandingPage slug={decodeURIComponent(partnerPath[1])} /></PublicPage>;
  }

  if (pathname === '/sucesso') {
    return (
      <PublicPage>
        <SuccessPage />
      </PublicPage>
    );
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return <AdminPage />;
  }

  if (pathname === '/privacidade') {
    return (
      <PublicPage>
        <PrivacyPage />
      </PublicPage>
    );
  }

  if (pathname === '/regulamento') {
    return (
      <PublicPage>
        <TermsPage />
      </PublicPage>
    );
  }

  if (pathname === '/erro' || pathname === '/pagamento-cancelado') {
    return (
      <PublicPage>
        <PaymentErrorPage />
      </PublicPage>
    );
  }

  return (
    <PublicPage>
      <main className="premium-shell min-h-screen w-full bg-black text-white">
        <PremiumCursor />
        <Hero />
        <Marquee />
        <KitSection />
        <RegistrationSection />
        {showCourseMap && <CourseMap />}
        <Gallery />
        <FAQSection />
        <SponsorSection />
        <Footer />
      </main>
    </PublicPage>
  );
}

function PublicPage({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <WhatsAppSupportButton />
    </>
  );
}
