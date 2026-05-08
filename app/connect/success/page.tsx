import Link from "next/link";
import { CheckCircle2, MessageCircle, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageProps {
  searchParams: Promise<{ phone?: string }>;
}

export default async function ConnectSuccessPage({ searchParams }: PageProps) {
  const { phone } = await searchParams;
  const masked = phone ? maskPhone(phone) : null;

  const botPhone = process.env.GUPSHUP_SOURCE_PHONE;
  const exampleQuery = "biryani Paradise ₹500";
  const waLink = botPhone
    ? `https://wa.me/${botPhone.replace(/\D/g, "")}?text=${encodeURIComponent(exampleQuery)}`
    : null;

  return (
    <main className="relative flex flex-1 flex-col">
      <div aria-hidden className="absolute inset-x-0 top-0 h-72 hero-glow" />
      <section className="relative mx-auto flex w-full max-w-xl flex-col gap-10 px-6 py-16 sm:py-24">
        <div className="flex flex-col items-start gap-4">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Step 2 of 2 · Connected
            </span>
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              You're connected
            </h1>
            {masked && (
              <p className="text-pretty text-muted-foreground">
                Your Swiggy access token is sealed and paired with{" "}
                <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-sm text-foreground">
                  {masked}
                </span>
                .
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-card p-6 ring-1 ring-foreground/[0.06] sm:p-7">
          <div className="mb-4 flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Try your first order</h2>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Open the chat and tell me what you'd like — for example{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
              {exampleQuery}
            </code>
            . I'll walk you through three confirmation gates.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/order/new">
                Open chat
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Or message on WhatsApp →
              </a>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-brand-soft/40 p-4 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div>
            <p className="font-medium">Three gates, then a 30-second grace timer</p>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              Calorie → ETA → final confirm. After the final YES, you have 30 seconds to reply{" "}
              <code className="rounded bg-background/80 px-1 py-0.5 font-mono text-xs">STOP</code>
              {" "}before the order goes in. COD only, ₹999 cap during beta.
            </p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Want out? Reply{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono">FORGET ME</code> on
          WhatsApp anytime — we'll wipe your token and any in-flight order. Or read the{" "}
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            privacy policy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return phone;
  return `${phone.slice(0, phone.length - digits.length + 2)}…${digits.slice(-4)}`;
}
