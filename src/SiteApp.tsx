import { Navbar, Marquee, Footer } from "./components/layout";
import { Hero } from "./components/hero";
import { RegistrationSection, SponsorSection } from "./components/forms";
import { CourseMap, Gallery } from "./components/visuals";
import { FAQSection } from "./components/faq";
import { PremiumCursor } from "./components/premium";
import { AdminPage } from "./pages/Admin";
import { PaymentErrorPage } from "./pages/PaymentError";
import { PrivacyPage, TermsPage } from "./pages/Privacy";
import { SuccessPage } from "./pages/Success";

export default function SiteApp() {
  const pathname = window.location.pathname;

  if (pathname === '/sucesso') {
    return <SuccessPage />;
  }

  if (pathname === '/admin') {
    return <AdminPage />;
  }

  if (pathname === '/privacidade') {
    return <PrivacyPage />;
  }

  if (pathname === '/regulamento') {
    return <TermsPage />;
  }

  if (pathname === '/erro' || pathname === '/pagamento-cancelado') {
    return <PaymentErrorPage />;
  }

  return (
    <main className="premium-shell min-h-screen w-full bg-black text-white">
      <PremiumCursor />
      <Navbar />
      <Hero />
      <Marquee />
      <RegistrationSection />
      <CourseMap />
      <Gallery />
      <FAQSection />
      <SponsorSection />
      <Footer />
    </main>
  );
}
