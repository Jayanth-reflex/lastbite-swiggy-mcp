"use client";

import { motion } from "motion/react";
import { fadeUpAt, fadeUpFrom } from "@/lib/motion";

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Do I need an API key or developer account?",
    a: (
      <>
        No developer account. You do need <strong>Claude Desktop</strong> with Swiggy MCP
        configured (a one-time, ~3 minute setup) so it can run the OTP login for you. You
        then paste the resulting bearer token into Last Bite. Step-by-step instructions are
        on the connect page. We're working with Swiggy to skip this step once they
        whitelist our redirect URI (<a href="https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53" target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">tracked here</a>).
      </>
    ),
  },
  {
    q: "Will my friends see my food choices?",
    a: "No. Each user is scoped to their own Swiggy account. Last Bite can only place orders that you, the signed-in user, confirm.",
  },
  {
    q: "What if I order by mistake?",
    a: (
      <>
        Three gates have to clear (calorie / ETA / final), and after the final YES there's a
        visible 30-second window where typing <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">STOP</code> cancels.
        An idempotency guard on the server prevents double-orders.
      </>
    ),
  },
  {
    q: "What does 'Powered by Swiggy' mean?",
    a: "Last Bite uses Swiggy's official Model Context Protocol server (mcp.swiggy.com). Restaurants, menus, prices, and order placement all come from Swiggy. Last Bite is a third-party UX layer; it isn't affiliated with or endorsed by Swiggy.",
  },
];

export function FAQSection() {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 pb-24">
      <div className="mb-8 flex flex-col gap-2">
        <motion.span
          initial={fadeUpFrom}
          whileInView={fadeUpAt(0)}
          viewport={{ once: true, margin: "-80px" }}
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          FAQ
        </motion.span>
        <motion.h2
          initial={fadeUpFrom}
          whileInView={fadeUpAt(0.05)}
          viewport={{ once: true, margin: "-80px" }}
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Common questions
        </motion.h2>
      </div>
      <dl className="divide-y divide-border/60 border-y border-border/60">
        {FAQS.map((f, i) => (
          <motion.div
            key={f.q}
            initial={fadeUpFrom}
            whileInView={fadeUpAt(i * 0.05)}
            viewport={{ once: true, margin: "-100px" }}
            className="grid gap-2 py-6 sm:grid-cols-[1fr_2fr] sm:gap-8"
          >
            <dt className="font-medium">{f.q}</dt>
            <dd className="text-sm leading-relaxed text-muted-foreground">{f.a}</dd>
          </motion.div>
        ))}
      </dl>
    </section>
  );
}
