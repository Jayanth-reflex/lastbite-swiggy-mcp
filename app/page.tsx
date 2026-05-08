import { cookies } from "next/headers";
import { readSessionCookie } from "@/lib/session";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { TrustBand } from "@/components/landing/trust-band";
import { FAQSection } from "@/components/landing/faq";

export default async function Home() {
  const jar = await cookies();
  const session = readSessionCookie(jar.toString());
  const cta = session
    ? { href: "/order/new", label: "Open chat" }
    : { href: "/connect", label: "Get started" };

  return (
    <main className="relative flex flex-1 flex-col">
      <Hero ctaHref={cta.href} ctaLabel={cta.label} />
      <HowItWorks />
      <TrustBand />
      <FAQSection />
    </main>
  );
}
