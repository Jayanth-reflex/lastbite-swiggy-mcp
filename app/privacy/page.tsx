import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Privacy — Last Bite",
  description: "DPDP-aligned privacy policy for Last Bite.",
};

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16 sm:py-24">
        <header className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            Privacy
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Privacy at Last Bite
          </h1>
          <p className="text-pretty text-muted-foreground">
            Last Bite is built around the principles of India&rsquo;s Digital Personal Data
            Protection Act (DPDP), 2023. We collect the minimum data needed to place a Swiggy
            order on your behalf and to honour the three-gate confirmation flow.
          </p>
        </header>

        <Section title="What we store">
          <Bullet>
            <strong>Phone number.</strong> The WhatsApp number you contact us from. Used as your
            account identifier.
          </Bullet>
          <Bullet>
            <strong>BYOC bearer token.</strong> Your personal Swiggy MCP OAuth token, captured
            from your Claude Desktop session. Encrypted at rest in Upstash Redis with a 30-day
            TTL. Never logged, never displayed, never shared.
          </Bullet>
          <Bullet>
            <strong>Order context.</strong> The cart you confirmed, the gates you passed, the
            order ID Swiggy returned. Retained for 30 days for receipts and dispute support.
          </Bullet>
        </Section>

        <Section title="What we do not store">
          <Bullet>Payment instruments. Last Bite is COD-only.</Bullet>
          <Bullet>Free-text WhatsApp messages outside an active order.</Bullet>
          <Bullet>Your Swiggy account password. We never see it.</Bullet>
        </Section>

        <Section title="Third parties">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Swiggy receives the order details required to fulfil your request via the Swiggy MCP
            server. Gupshup transports your WhatsApp messages. Upstash Redis holds short-lived
            state. We don&rsquo;t sell your data, ever.
          </p>
        </Section>

        <Section title="Your rights">
          <p className="text-sm leading-relaxed text-muted-foreground">
            You can revoke your BYOC token at any time by emailing{" "}
            <a
              href="mailto:privacy@lastbite.fun"
              className="text-foreground underline-offset-4 hover:underline"
            >
              privacy@lastbite.fun
            </a>
            . We&rsquo;ll wipe your token, cart history, and pending grace timers within 24 hours.
          </p>
        </Section>

        <Section title="Powered by Swiggy">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Last Bite is a third-party agent that uses your personal Swiggy MCP connection. The
            Swiggy logo and the &ldquo;Powered by Swiggy&rdquo; mark appear on every surface that
            renders Swiggy data. Last Bite is not affiliated with or endorsed by Swiggy.
          </p>
        </Section>

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Last Bite
        </Link>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 sm:grid-cols-[1fr_2fr] sm:gap-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
      <span>{children}</span>
    </div>
  );
}
