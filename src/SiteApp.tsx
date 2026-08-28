import { useEffect, type ReactNode } from "react";
import { Marquee, Footer, SiteHeader } from "./components/layout";
import { Hero } from "./components/hero";
import { RegistrationSection, SponsorSection } from "./components/forms";
import { CourseMap, Gallery } from "./components/visuals";
import { FAQSection } from "./components/faq";
import { KitSection } from "./components/kit";
import { PremiumCursor } from "./components/premium";
import { WhatsAppSupportButton } from "./components/WhatsAppSupportButton";
import { AdminPage } from "./pages/Admin";
import { PaymentErrorPage } from "./pages/PaymentError";
import { PrivacyPage } from "./pages/Privacy";
import { SuccessPage } from "./pages/Success";
import { PartnerLandingPage } from "./pages/PartnerLanding";
import { RegulationPage } from "./pages/Regulation";

const showCourseMap = true;

export default function SiteApp() {
  const pathname = window.location.pathname;
  const partnerPath = pathname.match(/^\/p\/([^/]+)\/?$/);

  if (partnerPath) {
    return <PublicPage showHeader={false}><PartnerLandingPage slug={decodeURIComponent(partnerPath[1])} /></PublicPage>;
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
        <RegulationPage />
        <Footer />
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
        {showCourseMap && <CourseMap />}
        <RegistrationSection />
        <Gallery />
        <FAQSection />
        <SponsorSection />
        <Footer />
      </main>
    </PublicPage>
  );
}

function PublicPage({ children, showHeader = true }: { children: ReactNode; showHeader?: boolean }) {
  return (
    <>
      {showHeader ? <SiteHeader /> : null}
      {children}
      <HashScrollRestoration />
      <WhatsAppSupportButton />
    </>
  );
}

function HashScrollRestoration() {
  useEffect(() => {
    if (!window.location.hash) return;

    const targetId = decodeURIComponent(window.location.hash.slice(1));
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    const timeout = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
      document.documentElement.style.scrollBehavior = previousScrollBehavior;
    }, 100);

    return () => {
      window.clearTimeout(timeout);
      document.documentElement.style.scrollBehavior = previousScrollBehavior;
    };
  }, []);

  return null;
}
