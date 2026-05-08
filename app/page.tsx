import { cookies } from "next/headers";
import Link from "next/link";
import {
  ArrowRight,
  ShieldCheck,
  MessageCircle,
  Timer,
  KeyRound,
  CheckCircle2,
} from "lucide-react";
import { readSessionCookie } from "@/lib/session";
import { Button } from "@/components/ui/button";

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

function Hero({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 top-0 h-[480px] hero-grid opacity-50" />
      <div aria-hidden className="absolute inset-x-0 top-0 h-[480px] hero-glow" />

      <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-6 pt-20 pb-16 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
        <div className="flex flex-col gap-7">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            Powered by Swiggy · Beta
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Order Swiggy in plain English.{" "}
            <span className="text-muted-foreground">Confirm before you regret.</span>
          </h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Last Bite is an agent that takes natural-language Swiggy orders, walks them through
            three confirmation gates, then waits 30 seconds before committing. COD-only by design,
            so a sleepy ₹500 biryani never goes through without intent.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href={ctaHref}>
                {ctaLabel}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="#how-it-works">How it works</Link>
            </Button>
          </div>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <li className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> BYOC token, AES-256 sealed
            </li>
            <li className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> COD-only, ₹999 cap
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" /> 30-second STOP window
            </li>
          </ul>
        </div>

        <ChatPreview />
      </div>
    </section>
  );
}

function ChatPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-4 rounded-3xl bg-brand/5 blur-2xl" aria-hidden />
      <div className="relative overflow-hidden rounded-2xl bg-card text-card-foreground shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_32px_-12px_rgba(0,0,0,0.12)] ring-1 ring-foreground/[0.06]">
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
          </span>
          <span className="ml-1 font-mono">last-bite</span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            online
          </span>
        </div>
        <div className="flex flex-col gap-3 p-5 text-sm">
          <Bubble side="user">biryani Paradise ₹500</Bubble>
          <Bubble side="bot">
            Cart ready: <strong>Paradise Special Biryani</strong> ₹449 + delivery ₹40 = ₹489.
            <br />
            <span className="text-muted-foreground">Reply YES to continue or STOP to cancel.</span>
          </Bubble>
          <Bubble side="user">yes</Bubble>
          <Bubble side="bot">
            ~1,100 kcal. Still go? <span className="text-muted-foreground">(gate 1 of 3)</span>
          </Bubble>
          <div className="mt-1 flex items-center gap-2 self-start rounded-full bg-brand-soft px-3 py-1 text-[11px] font-medium text-brand-muted">
            <Timer className="h-3 w-3" />
            30s grace timer activates after final YES
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: "user" | "bot"; children: React.ReactNode }) {
  if (side === "user") {
    return (
      <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
        {children}
      </div>
    );
  }
  return (
    <div className="max-w-[85%] self-start rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2 text-sm">
      {children}
    </div>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="mb-10 flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          How it works
        </span>
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Four steps. Three gates. Zero accidental orders.
        </h2>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-2xl bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
        <Step
          n={1}
          icon={<KeyRound className="h-4 w-4" />}
          title="Connect"
          text="Authorize Swiggy MCP once in Claude Desktop, paste the bearer token here. We seal it AES-256 and never see your OTP."
        />
        <Step
          n={2}
          icon={<MessageCircle className="h-4 w-4" />}
          title="Tell us"
          text="Type or WhatsApp in plain English: 'biryani Paradise, ₹500 budget'."
        />
        <Step
          n={3}
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Three gates"
          text="Calorie check, ETA check, final confirm. Each waits for an explicit YES."
        />
        <Step
          n={4}
          icon={<Timer className="h-4 w-4" />}
          title="30-second grace"
          text="A visible countdown after the final YES. Reply STOP to cancel; otherwise it commits."
        />
      </ol>
    </section>
  );
}

function Step({
  n,
  icon,
  title,
  text,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <li className="flex flex-col gap-3 bg-card p-6">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-foreground">
          {icon}
        </span>
        <span className="font-mono text-xs">0{n}</span>
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
    </li>
  );
}

function TrustBand() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-20">
      <div className="grid gap-px overflow-hidden rounded-2xl bg-border/60 sm:grid-cols-2">
        <Trust
          title="COD-only, by design"
          text="Swiggy MCP orders cannot be cancelled after they fire. The three gates and the 30-second grace timer exist to make sure that fire is intentional."
        />
        <Trust
          title="Your token, encrypted"
          text="Your Swiggy access token is sealed with AES-256-GCM at rest. Reply FORGET ME on WhatsApp anytime to wipe it."
        />
      </div>
    </section>
  );
}

function Trust({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-3 bg-card p-7">
      <ShieldCheck className="h-5 w-5 text-brand" />
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function FAQSection() {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 pb-24">
      <div className="mb-8 flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          FAQ
        </span>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Common questions</h2>
      </div>
      <dl className="divide-y divide-border/60 border-y border-border/60">
        <FAQ
          q="Do I need an API key or developer account?"
          a={
            <>
              No developer account. You do need <strong>Claude Desktop</strong> with Swiggy MCP
              configured (a one-time, ~3 minute setup) so it can run the OTP login for you. You
              then paste the resulting bearer token into Last Bite. Step-by-step instructions are
              on the connect page. We're working with Swiggy to skip this step once they
              whitelist our redirect URI (<a href="https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53" target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">tracked here</a>).
            </>
          }
        />
        <FAQ
          q="Will my friends see my food choices?"
          a="No. Each user is scoped to their own Swiggy account. Last Bite can only place orders that you, the signed-in user, confirm."
        />
        <FAQ
          q="What if I order by mistake?"
          a={
            <>
              Three gates have to clear (calorie / ETA / final), and after the final YES there's a
              visible 30-second window where typing <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">STOP</code> cancels.
              An idempotency guard on the server prevents double-orders.
            </>
          }
        />
        <FAQ
          q="What does 'Powered by Swiggy' mean?"
          a="Last Bite uses Swiggy's official Model Context Protocol server (mcp.swiggy.com). Restaurants, menus, prices, and order placement all come from Swiggy. Last Bite is a third-party UX layer; it isn't affiliated with or endorsed by Swiggy."
        />
      </dl>
    </section>
  );
}

function FAQ({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="grid gap-2 py-6 sm:grid-cols-[1fr_2fr] sm:gap-8">
      <dt className="font-medium">{q}</dt>
      <dd className="text-sm leading-relaxed text-muted-foreground">{a}</dd>
    </div>
  );
}
