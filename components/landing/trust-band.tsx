import { ShieldCheck } from "lucide-react";

const TRUST = [
  {
    title: "COD-only, by design",
    text: "Swiggy MCP orders cannot be cancelled after they fire. The three gates and the 30-second grace timer exist to make sure that fire is intentional.",
  },
  {
    title: "Your token, encrypted",
    text: "Your Swiggy access token is sealed with AES-256-GCM at rest. Reply FORGET ME on WhatsApp anytime to wipe it.",
  },
];

export function TrustBand() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-20">
      <div className="grid gap-px overflow-hidden rounded-2xl bg-border/60 sm:grid-cols-2">
        {TRUST.map((t) => (
          <div key={t.title} className="flex flex-col gap-3 bg-card p-7">
            <ShieldCheck className="h-5 w-5 text-brand" />
            <h3 className="font-semibold">{t.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{t.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
