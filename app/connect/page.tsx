"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  KeyRound,
  MessageCircle,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const ERROR_MESSAGES: Record<string, string> = {
  state_invalid: "The sign-in link expired or was tampered with. Please try again.",
  state_mismatch: "The sign-in link didn't match this browser session. Please try again.",
  state_expired: "The sign-in window expired. Please try again.",
  missing_cookie: "Cookies for this site are required to sign in. Enable cookies and retry.",
  missing_code_or_state: "Swiggy didn't return a valid response. Please try again.",
  exchange_failed: "Couldn't finalise sign-in with Swiggy. Please try again.",
  register_failed: "Couldn't reach Swiggy auth right now. Try again in a minute.",
  storage_failed: "We couldn't save your session right now. Try again in a minute.",
};

function errorMessage(key: string | null): string | null {
  if (!key) return null;
  if (key.startsWith("swiggy_")) return `Swiggy returned an error: ${key.slice("swiggy_".length)}`;
  return ERROR_MESSAGES[key] ?? "Something went wrong. Please try again.";
}

export default function ConnectPage() {
  return (
    <main className="relative flex flex-1 flex-col">
      <div aria-hidden className="absolute inset-x-0 top-0 h-72 hero-glow" />
      <section className="relative mx-auto flex w-full max-w-xl flex-col gap-10 px-6 py-16 sm:py-24">
        <div className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            Step 1 of 2 · Sign in
          </span>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Connect your Swiggy account
          </h1>
          <p className="text-pretty text-muted-foreground">
            One click sends you to Swiggy's secure sign-in. You verify with the same OTP you'd
            use in the Swiggy app, and we get an access token scoped to <em>your</em> orders.
            We never see your password.
          </p>
        </div>

        <Suspense fallback={null}>
          <ConnectForm />
        </Suspense>

        <ul className="grid gap-3 sm:grid-cols-3">
          <Hint
            icon={<KeyRound className="h-3.5 w-3.5" />}
            title="Swiggy OTP only"
            text="Sign in on Swiggy's own page. We don't see your OTP."
          />
          <Hint
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            title="Encrypted at rest"
            text="Your token is sealed with AES-256-GCM."
          />
          <Hint
            icon={<MessageCircle className="h-3.5 w-3.5" />}
            title="Wipe anytime"
            text="Reply FORGET ME on WhatsApp."
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
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, inviteCode: inviteCode || undefined }),
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
        <h2 className="font-semibold">Pair your WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          We'll DM you on this number once your token is connected.
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
        <Field label="Invite code" hint="Optional, only if you have one">
          <input
            inputMode="text"
            autoComplete="off"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="h-11 w-full rounded-lg border border-input bg-background px-3.5 text-base outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />
        </Field>
        <Button type="submit" size="lg" disabled={submitting || !phone}>
          {submitting ? (
            "Redirecting to Swiggy…"
          ) : (
            <>
              Continue with Swiggy
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </>
          )}
        </Button>
      </form>
    </div>
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
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
