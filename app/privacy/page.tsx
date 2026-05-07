import Link from "next/link";
import { PoweredBySwiggy } from "@/components/powered-by-swiggy";

export const metadata = {
  title: "Privacy — Last Bite",
  description: "DPDP-aligned privacy policy for Last Bite.",
};

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col">
      <article className="prose prose-zinc dark:prose-invert mx-auto w-full max-w-3xl flex-1 px-6 py-20">
        <h1>Privacy</h1>
        <p className="text-muted-foreground">
          Last Bite is built around the principles of India&rsquo;s Digital Personal Data
          Protection Act (DPDP), 2023. We collect the minimum data needed to place a Swiggy
          order on your behalf and to honour the three-gate confirmation flow.
        </p>

        <h2>What we store</h2>
        <ul>
          <li>
            <strong>Phone number.</strong> The WhatsApp number you contact us from. Used as your
            account identifier.
          </li>
          <li>
            <strong>BYOC bearer token.</strong> Your personal Swiggy MCP OAuth token, captured from
            your Claude Desktop session. Encrypted at rest in Upstash Redis with a 30-day TTL.
            Never logged, never displayed, never shared.
          </li>
          <li>
            <strong>Order context.</strong> The cart you confirmed, the gates you passed, the
            order ID Swiggy returned. Retained for 30 days for receipts and dispute support.
          </li>
        </ul>

        <h2>What we do not store</h2>
        <ul>
          <li>Payment instruments. Last Bite is COD-only.</li>
          <li>Free-text WhatsApp messages outside an active order.</li>
          <li>Your Swiggy account password. We never see it.</li>
        </ul>

        <h2>Third parties</h2>
        <p>
          Swiggy receives the order details required to fulfil your request via the Swiggy MCP
          server. Gupshup transports your WhatsApp messages. Upstash Redis holds short-lived
          state. We don&rsquo;t sell your data, ever.
        </p>

        <h2>Your rights</h2>
        <p>
          You can revoke your BYOC token at any time by replying <code>FORGET ME</code> on
          WhatsApp or by emailing privacy@lastbite.fun. We&rsquo;ll wipe your token, cart history,
          and pending grace timers within 24 hours.
        </p>

        <h2>Powered by Swiggy</h2>
        <p>
          Last Bite is a third-party agent that uses your personal Swiggy MCP connection. The
          Swiggy logo and the &ldquo;Powered by Swiggy&rdquo; mark appear on every surface that
          renders Swiggy data. Last Bite is not affiliated with or endorsed by Swiggy.
        </p>

        <p>
          <Link href="/">Back to Last Bite</Link>
        </p>
      </article>
      <PoweredBySwiggy />
    </main>
  );
}
