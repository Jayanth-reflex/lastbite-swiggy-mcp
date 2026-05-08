const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Do I need a developer account?",
    a: (
      <>
        Not a developer account, but right now you do need <strong>Claude Desktop with Swiggy
        MCP set up</strong> — Last Bite can't run Swiggy's OTP login itself yet because Swiggy
        hasn't whitelisted our OAuth callback (
        <a
          href="https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-4 hover:underline"
        >
          issue #53
        </a>
        ). The workaround: you sign in to Swiggy inside Claude Desktop once, then paste the
        token it gives you into Last Bite. Realistic time budget: 10–15 minutes for someone
        comfortable editing a JSON config file; longer otherwise. Full step-by-step on the
        Connect page. The day Swiggy whitelists us, this whole step disappears.
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
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          FAQ
        </span>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Common questions</h2>
      </div>
      <dl className="divide-y divide-border/60 border-y border-border/60">
        {FAQS.map((f) => (
          <div
            key={f.q}
            className="grid gap-2 py-6 sm:grid-cols-[1fr_2fr] sm:gap-8"
          >
            <dt className="font-medium">{f.q}</dt>
            <dd className="text-sm leading-relaxed text-muted-foreground">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
