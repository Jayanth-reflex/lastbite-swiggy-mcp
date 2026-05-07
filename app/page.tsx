import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowRight, ShieldCheck, MessageCircle, Timer, KeyRound, CheckCircle2 } from "lucide-react";
import { readSessionCookie } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const jar = await cookies();
  const session = readSessionCookie(jar.toString());
  const cta = session
    ? { href: "/order/new", label: "Open chat" }
    : { href: "/connect", label: "Get started" };

  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-16 pb-10 sm:pt-24">
        <Badge variant="secondary" className="self-start gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-orange-500" />
          Powered by Swiggy
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Order Swiggy on WhatsApp.
          <br />
          <span className="text-muted-foreground">Confirm before you regret.</span>
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Last Bite is a WhatsApp agent that takes natural-language Swiggy orders, walks them through three confirmation gates, then waits 30 seconds before committing. COD-only by design, so a sleepy ₹500 biryani never goes through without intent.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href={cta.href}>
              {cta.label}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#how-it-works">How it works</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          One-click sign-in with your existing Swiggy account · No password ever leaves Swiggy · COD only
        </p>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto w-full max-w-5xl px-6 py-12">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <span className="text-sm text-muted-foreground">~2 minutes to set up</span>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Step
            n={1}
            icon={<KeyRound className="h-5 w-5" />}
            title="Connect"
            text="Click ‘Continue with Swiggy’ and sign in with the OTP you already use. We never see your password."
          />
          <Step
            n={2}
            icon={<MessageCircle className="h-5 w-5" />}
            title="Message us"
            text="WhatsApp the bot in plain English: ‘chicken biryani from Paradise, ₹500 budget’."
          />
          <Step
            n={3}
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Confirm three gates"
            text="Calorie check, ETA check, final confirm. Each one waits for an explicit YES."
          />
          <Step
            n={4}
            icon={<Timer className="h-5 w-5" />}
            title="30-second grace"
            text="Visible countdown after the final YES. Reply STOP within 30 seconds to cancel; otherwise it commits."
          />
        </ol>
      </section>

      {/* Trust */}
      <section className="mx-auto w-full max-w-5xl px-6 py-8">
        <Card className="border-orange-200/60 bg-orange-50/40 dark:bg-orange-500/5">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:gap-8">
            <div className="flex items-start gap-3 sm:w-1/2">
              <ShieldCheck className="mt-1 h-5 w-5 text-orange-600" />
              <div>
                <h3 className="font-semibold">COD-only and non-cancellable, by design</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Swiggy MCP orders cannot be cancelled after they fire. The three gates and the 30-second grace timer exist to make sure that fire is intentional.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 sm:w-1/2">
              <ShieldCheck className="mt-1 h-5 w-5 text-orange-600" />
              <div>
                <h3 className="font-semibold">Your token, encrypted</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your Swiggy access token is encrypted with AES-256-GCM at rest. Reply <code className="rounded bg-background/60 px-1 py-0.5 text-xs">FORGET ME</code> on WhatsApp anytime to wipe it.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* FAQ */}
      <section className="mx-auto w-full max-w-3xl px-6 py-12">
        <h2 className="mb-4 text-2xl font-semibold tracking-tight">FAQ</h2>
        <dl className="grid gap-5">
          <FAQ
            q="Do I need an API key or developer account?"
            a={
              <>
                No. You sign in with the same phone-number-and-OTP flow you use in the Swiggy app. Last Bite asks Swiggy to grant it ordering permission scoped to <em>your</em> account.
              </>
            }
          />
          <FAQ
            q="Will my friends see my food choices?"
            a="No. Each user is scoped to their own Swiggy account. Last Bite can only place orders that you, the signed-in user, confirm via WhatsApp."
          />
          <FAQ
            q="What if I order by mistake?"
            a={
              <>
                Three gates have to clear (calorie / ETA / final), and after the final YES there's a visible 30-second window where typing <code className="rounded bg-background/60 px-1 py-0.5 text-xs">STOP</code> cancels. Same idempotency guard on the server prevents double-orders.
              </>
            }
          />
          <FAQ
            q="What does ‘Powered by Swiggy’ mean?"
            a="Last Bite uses Swiggy's official Model Context Protocol server (mcp.swiggy.com). Restaurants, menus, prices, and order placement all come from Swiggy. Last Bite is a third-party UX layer; it isn't affiliated with or endorsed by Swiggy."
          />
        </dl>
      </section>
    </main>
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
    <li>
      <Card className="h-full">
        <CardContent className="flex h-full flex-col gap-3 p-5">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="rounded-full bg-secondary p-2 text-foreground">{icon}</span>
            <span className="font-mono text-xs">0{n}</span>
          </div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{text}</p>
        </CardContent>
      </Card>
    </li>
  );
}

function FAQ({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 p-5">
      <dt className="font-semibold">{q}</dt>
      <dd className="mt-2 text-sm text-muted-foreground">{a}</dd>
    </div>
  );
}
