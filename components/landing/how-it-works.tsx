"use client";

import { CheckCircle2, KeyRound, MessageCircle, Timer } from "lucide-react";
import { motion } from "motion/react";
import { fadeUpAt, fadeUpFrom, spring } from "@/lib/motion";

const STEPS = [
  {
    icon: <KeyRound className="h-4 w-4" />,
    title: "Connect",
    text: "Authorize Swiggy MCP once in Claude Desktop, paste the bearer token here. We seal it AES-256 and never see your OTP.",
  },
  {
    icon: <MessageCircle className="h-4 w-4" />,
    title: "Tell us",
    text: "Type or WhatsApp in plain English: 'biryani Paradise, ₹500 budget'.",
  },
  {
    icon: <CheckCircle2 className="h-4 w-4" />,
    title: "Three gates",
    text: "Calorie check, ETA check, final confirm. Each waits for an explicit YES.",
  },
  {
    icon: <Timer className="h-4 w-4" />,
    title: "30-second grace",
    text: "A visible countdown after the final YES. Reply STOP to cancel; otherwise it commits.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="mb-10 flex flex-col gap-2">
        <motion.span
          initial={fadeUpFrom}
          whileInView={fadeUpAt(0)}
          viewport={{ once: true, margin: "-80px" }}
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          How it works
        </motion.span>
        <motion.h2
          initial={fadeUpFrom}
          whileInView={fadeUpAt(0.05)}
          viewport={{ once: true, margin: "-80px" }}
          className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Four steps. Three gates. Zero accidental orders.
        </motion.h2>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-2xl bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.title}
            initial={fadeUpFrom}
            whileInView={fadeUpAt(i * 0.06)}
            viewport={{ once: true, margin: "-80px" }}
            whileHover={{ y: -2 }}
            transition={spring.snappy}
            className="flex flex-col gap-3 bg-card p-6"
          >
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-foreground">
                {s.icon}
              </span>
              <span className="font-mono text-xs tabular-nums">0{i + 1}</span>
            </div>
            <h3 className="font-semibold">{s.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{s.text}</p>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}
