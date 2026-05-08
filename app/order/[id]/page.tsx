import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { PoweredBySwiggy } from "@/components/powered-by-swiggy";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrderPage({ params }: PageProps) {
  const { id } = await params;
  const isDemo = id.startsWith("demo_");
  return (
    <main className="relative flex flex-1 flex-col">
      <div aria-hidden className="absolute inset-x-0 top-0 h-72 hero-glow" />
      <section className="relative mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-16 sm:py-24">
        <PoweredBySwiggy variant="inline" className="self-start" />

        <div className="flex flex-col gap-4">
          <div
            className={
              isDemo
                ? "inline-flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground ring-1 ring-foreground/[0.06]"
                : "inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30"
            }
          >
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {isDemo ? "Demo order recorded" : "Order placed"}
          </h1>
          <p className="text-pretty text-muted-foreground">
            {isDemo
              ? "This was a demo run — nothing was sent to Swiggy. Use this URL to share the flow with friends."
              : "Live tracking lands when Trail (Project 2) ships. For now, this page exists so every order has a shareable URL with the required Swiggy attribution."}
          </p>
        </div>

        <div className="rounded-2xl bg-card p-6 ring-1 ring-foreground/[0.06]">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Order ID
          </div>
          <div className="mt-1.5 break-all font-mono text-sm text-foreground">{id}</div>
        </div>

        <Link
          href="/order/new"
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to chat
        </Link>
      </section>
    </main>
  );
}
