"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  Info,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const ERROR_MESSAGES: Record<string, string> = {
  needs_login: "Please connect your Swiggy MCP token to continue.",
  session_expired: "Your session expired. Please reconnect.",
};

function errorMessage(key: string | null): string | null {
  if (!key) return null;
  return ERROR_MESSAGES[key] ?? null;
}

export default function ConnectPage() {
  return (
    <main className="relative flex flex-1 flex-col">
      <div aria-hidden className="absolute inset-x-0 top-0 h-72 hero-glow" />
      <section className="relative mx-auto flex w-full max-w-xl flex-col gap-10 px-6 py-16 sm:py-24">
        <div className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            Connect · Bring your own Claude
          </span>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Paste your Swiggy MCP token
          </h1>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            While Swiggy reviews our whitelist request, Last Bite runs in <strong>BYOC mode</strong>:
            you authorize Swiggy MCP once inside Claude Desktop, then paste the bearer token
            here. We encrypt it at rest and use it only for the orders you confirm.
          </p>
        </div>

        <Suspense fallback={null}>
          <ConnectForm />
        </Suspense>

        <HowToCapture />

        <ul className="grid gap-3 sm:grid-cols-3">
          <Hint
            icon={<KeyRound className="h-3.5 w-3.5" />}
            title="Your token, your account"
            text="Each token is scoped to one Swiggy account. We never see your password or OTP."
          />
          <Hint
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            title="Encrypted at rest"
            text="Sealed with AES-256-GCM in Upstash. 30-day TTL."
          />
          <Hint
            icon={<Info className="h-3.5 w-3.5" />}
            title="Wipe anytime"
            text="Reply FORGET ME on WhatsApp or just disconnect Swiggy MCP in Claude Desktop."
          />
        </ul>

        <p className="text-xs text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            privacy policy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

function ConnectForm() {
  const params = useSearchParams();
  const initialError = errorMessage(params.get("error"));

  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/oauth/byoc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone,
          token,
          inviteCode: inviteCode || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.redirectUrl) {
        setError(json.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      window.location.href = json.redirectUrl;
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl bg-card p-6 ring-1 ring-foreground/[0.06] sm:p-7">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="font-semibold">Pair your token</h2>
        <p className="text-sm text-muted-foreground">
          Use a phone number you can receive WhatsApp on. We'll DM you order receipts there.
        </p>
      </div>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <Field
          label="WhatsApp number"
          hint="Include the country code, e.g. +91 98765 00001"
        >
          <input
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91 98765 00001"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />
        </Field>
        <Field
          label="Swiggy MCP bearer token"
          hint="Starts with eyJ… and is a few hundred characters long. Don't include the 'Bearer ' prefix — we strip it either way."
        >
          <div className="relative">
            <textarea
              required
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={4}
              className={`w-full resize-y rounded-lg border border-input bg-background p-3.5 pr-11 font-mono text-xs outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 ${
                showToken ? "" : "[-webkit-text-security:disc] [text-security:disc]"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? "Hide token" : "Show token"}
              className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </Field>
        <Field label="Invite code" hint="Optional, only if you have one">
          <input
            inputMode="text"
            autoComplete="off"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />
        </Field>
        <Button type="submit" size="lg" disabled={submitting || !phone || !token}>
          {submitting ? (
            "Verifying with Swiggy…"
          ) : (
            <>
              Connect token
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </>
          )}
        </Button>
      </form>
    </div>
  );
}

function HowToCapture() {
  return (
    <details className="group rounded-xl border border-border/60 bg-card p-5 open:bg-brand-soft/30">
      <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Info className="h-4 w-4 text-brand" />
          How do I get the token from Claude Desktop?
        </span>
        <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">▾</span>
      </summary>
      <ol className="mt-4 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        <Step n={1}>
          Install <a href="https://claude.ai/download" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-foreground underline-offset-4 hover:underline">Claude Desktop <ExternalLink className="h-3 w-3" /></a> if you haven't already.
        </Step>
        <Step n={2}>
          Open the config file:
          <code className="mt-1 block rounded-md bg-secondary px-2 py-1.5 font-mono text-xs text-foreground">
            ~/Library/Application Support/Claude/claude_desktop_config.json
          </code>
          <span className="block text-xs">(Windows: <code className="rounded bg-secondary px-1 py-0.5 font-mono">%APPDATA%\Claude\claude_desktop_config.json</code>)</span>
        </Step>
        <Step n={3}>
          Add the Swiggy Food MCP server and restart Claude Desktop:
          <pre className="mt-1 overflow-x-auto rounded-md bg-secondary p-3 font-mono text-[11px] leading-relaxed text-foreground">{`{
  "mcpServers": {
    "swiggy-food": { "url": "https://mcp.swiggy.com/food" }
  }
}`}</pre>
        </Step>
        <Step n={4}>
          Claude Desktop will pop up an OTP login. Sign in with your Swiggy phone number — Claude
          finishes the OAuth and stores the token locally.
        </Step>
        <Step n={5}>
          Type <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">/mcp</code> in any Claude Desktop chat. You'll see <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">swiggy-food</code> listed as <em>connected</em>.
        </Step>
        <Step n={6}>
          Find the token. Easiest path: open Claude's data folder
          (<code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">~/Library/Application Support/Claude</code>),
          look in <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">Cache</code> or
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">Local State</code> for the
          stored OAuth blob, copy the <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">access_token</code> value (a long
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">eyJ…</code> string).
          Paste it above.
        </Step>
      </ol>
      <p className="mt-4 rounded-md bg-background/60 p-3 text-xs text-muted-foreground">
        Tokens last ~24 hours. If Last Bite ever says “your token expired,” pop back into Claude Desktop, run any tool, copy the fresh access_token, and re-paste here.
      </p>
    </details>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-muted">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Hint({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl bg-card p-4 ring-1 ring-foreground/[0.06]">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        {icon}
      </span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{text}</span>
    </li>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>}
    </label>
  );
}
