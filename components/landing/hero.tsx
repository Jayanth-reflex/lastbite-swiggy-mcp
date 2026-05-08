"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, KeyRound, Timer } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { fadeUpAt, fadeUpFrom, spring } from "@/lib/motion";

export function Hero({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  return (
    <section className="relative overflow-hidden">
      {/* Subtle layered glow — drifts slowly. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px]">
        <div className="absolute inset-0 hero-grid opacity-40" />
        <div className="absolute inset-0 hero-glow orb-drift" />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-6 pt-20 pb-16 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
        <div className="flex flex-col gap-7">
          <motion.span
            initial={fadeUpFrom}
            animate={fadeUpAt(0.05)}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur"
          >
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            Powered by Swiggy · Beta
          </motion.span>
          <motion.h1
            initial={fadeUpFrom}
            animate={fadeUpAt(0.15)}
            className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl"
          >
            Order Swiggy in plain English.{" "}
            <span className="text-muted-foreground">Confirm before you regret.</span>
          </motion.h1>
          <motion.p
            initial={fadeUpFrom}
            animate={fadeUpAt(0.25)}
            className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            Last Bite is an agent that takes natural-language Swiggy orders, walks them through
            three confirmation gates, then waits 30 seconds before committing. COD-only by design,
            so a sleepy ₹500 biryani never goes through without intent.
          </motion.p>
          <motion.div
            initial={fadeUpFrom}
            animate={fadeUpAt(0.35)}
            className="flex flex-wrap items-center gap-3"
          >
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
          </motion.div>
          <motion.ul
            initial={fadeUpFrom}
            animate={fadeUpAt(0.45)}
            className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"
          >
            <li className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> BYOC token, AES-256 sealed
            </li>
            <li className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> COD-only, ₹999 cap
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" /> 30-second STOP window
            </li>
          </motion.ul>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
            transition: { ...spring.cushion, delay: 0.25 },
          }}
        >
          <ChatPreview />
        </motion.div>
      </div>
    </section>
  );
}

function ChatPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div
        aria-hidden
        className="absolute -inset-4 rounded-3xl bg-brand/5 blur-2xl"
      />
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
          <Bubble side="user" delay={0.6}>biryani Paradise ₹500</Bubble>
          <Bubble side="bot" delay={1.0}>
            Cart ready: <strong>Paradise Special Biryani</strong> <span className="tabular-nums">₹449</span> + delivery <span className="tabular-nums">₹40</span> = <span className="tabular-nums">₹489</span>.
            <br />
            <span className="text-muted-foreground">Reply YES to continue or STOP to cancel.</span>
          </Bubble>
          <Bubble side="user" delay={1.6}>yes</Bubble>
          <Bubble side="bot" delay={2.0}>
            <span className="tabular-nums">~1,100 kcal</span>. Still go? <span className="text-muted-foreground">(gate 1 of 3)</span>
          </Bubble>
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { ...spring.gentle, delay: 2.6 },
            }}
            className="mt-1 flex items-center gap-2 self-start rounded-full bg-brand-soft px-3 py-1 text-[11px] font-medium text-brand-muted"
          >
            <Timer className="h-3 w-3" />
            30s grace timer activates after final YES
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  side,
  children,
  delay,
}: {
  side: "user" | "bot";
  children: React.ReactNode;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { ...spring.snappy, delay },
      }}
      className={
        side === "user"
          ? "max-w-[80%] self-end rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background"
          : "max-w-[85%] self-start rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2 text-sm"
      }
    >
      {children}
    </motion.div>
  );
}
