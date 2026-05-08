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
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
        <header className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-card/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            Connect · Bring your own Claude
          </span>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Paste your Swiggy MCP token
          </h1>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            While Swiggy reviews our whitelist request, Last Bite runs in <strong className="text-foreground">BYOC mode</strong>:
            you authorize Swiggy MCP once inside Claude Desktop, then paste the bearer token
            here. We encrypt it at rest and use it only for the orders you confirm.
          </p>
        </header>

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
            text="Reply FORGET ME on WhatsApp or disconnect Swiggy MCP in Claude Desktop."
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
      <form className="flex flex-col gap-5" onSubmit={submit}>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">WhatsApp number</Label>
          <Input
            id="phone"
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91 98765 00001"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="h-11 text-base sm:text-base"
          />
          <p className="text-xs text-muted-foreground">
            Include the country code, e.g. +91 98765 00001
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="token">Swiggy MCP bearer token</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  aria-label={showToken ? "Hide token" : "Show token"}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{showToken ? "Hide token" : "Show token"}</TooltipContent>
            </Tooltip>
          </div>
          <Textarea
            id="token"
            required
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={4}
            className={`min-h-24 resize-y font-mono text-xs ${
              showToken ? "" : "[-webkit-text-security:disc] [text-security:disc]"
            }`}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Starts with eyJ… and is a few hundred characters long. Don't include the
            'Bearer ' prefix — we strip it either way.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite">Invite code <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input
            id="invite"
            inputMode="text"
            autoComplete="off"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="h-11 text-base sm:text-base"
          />
        </div>

        <Button type="submit" size="lg" disabled={submitting || !phone || !token}>
          {submitting ? (
            <>
              <Spinner className="mr-1.5" />
              Verifying with Swiggy…
            </>
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

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      aria-hidden
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
    </span>
  );
}

function HowToCapture() {
  return (
    <details className="group rounded-xl border border-border/60 bg-card/50 p-5 open:bg-brand-soft/30 transition-colors">
      <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Info className="h-4 w-4 text-brand" />
          How do I get the token from Claude Desktop?
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
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
          Claude Desktop pops up Swiggy's OTP login. Sign in — Claude finishes the OAuth and
          stores the token locally.
        </Step>
        <Step n={5}>
          Type <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">/mcp</code> in any Claude Desktop chat. You'll see <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">swiggy-food</code> as <em>connected</em>.
        </Step>
        <Step n={6}>
          Open <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">~/Library/Application Support/Claude</code>,
          find the OAuth blob, copy the <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">access_token</code>
          value (a long <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">eyJ…</code>
          string), and paste it above.
        </Step>
      </ol>
      <p className="mt-4 rounded-md bg-background/60 p-3 text-xs text-muted-foreground">
        Tokens last ~24 hours. If Last Bite says "your token expired," pop back into Claude
        Desktop, run any tool, copy the fresh access_token, and re-paste here.
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
