"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, KeyRound, Timer } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { spring } from "@/lib/motion";

/**
 * Landing hero. Plain HTML for the prose so it always renders, even when
 * motion's hydration is unhappy on prod. Motion is reserved for hover/tap
 * micro-interactions on the CTAs and the chat preview reveal — those don't
 * have an SSR-stuck-at-initial failure mode.
 */
export function Hero({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px]">
        <div className="absolute inset-0 hero-grid opacity-40" />
        <div className="absolute inset-0 hero-glow orb-drift" />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-6 pt-20 pb-16 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
        <div className="flex flex-col gap-7">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            Developer beta · requires Claude Desktop
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Order Swiggy in plain English.{" "}
            <span className="text-muted-foreground">Confirm before you regret.</span>
          </h1>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Last Bite is an agent that takes natural-language Swiggy orders, walks them through
            three confirmation gates, then waits 30 seconds before committing. COD-only by
            design, so a sleepy ₹500 biryani never goes through without intent.
          </p>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Honest beta caveat.</strong> Swiggy hasn't
            whitelisted our OAuth callback yet (
            <a
              href="https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline-offset-4 hover:underline"
            >
              tracked here
            </a>
            ), so signing in here today requires <strong className="text-foreground">Claude
            Desktop with Swiggy MCP configured</strong> — you authorize Swiggy there once and
            paste the resulting bearer token into Last Bite. Setup is documented step-by-step on
            the Connect page; expect ~10 minutes if you're comfortable editing a config file.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring.snappy}>
              <Button asChild size="lg">
                <Link href={ctaHref}>
                  {ctaLabel}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </motion.div>
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring.snappy}>
              <Button asChild variant="outline" size="lg">
                <Link href="#how-it-works">How it works</Link>
              </Button>
            </motion.div>
          </div>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <li className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> COD-only, orders capped at ₹999
            </li>
            <li className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Token encrypted at rest, never logged
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" /> 30-second STOP window after final YES
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
      <div aria-hidden className="absolute -inset-4 rounded-3xl bg-brand/5 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl bg-card text-card-foreground shadow-[0_1px_0_rgba(255,255,255,0.04),0_30px_60px_-20px_rgba(0,0,0,0.5)] ring-1 ring-foreground/[0.06]">
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
          </span>
          <span className="ml-1 font-mono">last-bite</span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            online
          </span>
        </div>
        <div className="flex flex-col gap-3 p-5 text-sm">
          <Bubble side="user">biryani Paradise ₹500</Bubble>
          <Bubble side="bot">
            Cart ready: <strong>Paradise Special Biryani</strong> <span className="tabular-nums">₹449</span> + delivery <span className="tabular-nums">₹40</span> = <span className="tabular-nums">₹489</span>.
            <br />
            <span className="text-muted-foreground">Reply YES to continue or STOP to cancel.</span>
          </Bubble>
          <Bubble side="user">yes</Bubble>
          <Bubble side="bot">
            <span className="tabular-nums">~1,100 kcal</span>. Still go? <span className="text-muted-foreground">(gate 1 of 3)</span>
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

function Bubble({
  side,
  children,
}: {
  side: "user" | "bot";
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        side === "user"
          ? "max-w-[80%] self-end rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background"
          : "max-w-[85%] self-start rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2 text-sm"
      }
    >
      {children}
    </div>
  );
}
