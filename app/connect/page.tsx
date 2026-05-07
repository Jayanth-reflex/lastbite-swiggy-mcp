"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, KeyRound, MessageCircle, ShieldCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12 sm:py-16">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Connect your Swiggy account
          </h1>
          <p className="text-muted-foreground">
            One click sends you to Swiggy's secure sign-in. You verify with the same OTP you'd use in the Swiggy app, and we get an access token scoped to <em>your</em> orders. We never see your password.
          </p>
        </div>

        <Suspense fallback={null}>
          <ConnectForm />
        </Suspense>

        <ul className="grid gap-3 sm:grid-cols-3">
          <Hint
            icon={<KeyRound className="h-4 w-4" />}
            title="Swiggy OTP only"
            text="Sign in with phone + OTP on Swiggy's own page. We don't see it."
          />
          <Hint
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Encrypted at rest"
            text="Your token is sealed with AES-256-GCM before storage."
          />
          <Hint
            icon={<MessageCircle className="h-4 w-4" />}
            title="Wipe anytime"
            text="Reply FORGET ME on WhatsApp to instantly delete your token."
          />
        </ul>

        <p className="text-xs text-muted-foreground">
          By continuing, you agree to our <Link href="/privacy" className="underline">privacy policy</Link>.
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
    <Card>
      <CardHeader>
        <CardTitle>Pair your WhatsApp</CardTitle>
        <CardDescription>
          We'll DM you on this number once your token is connected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <Field label="WhatsApp number" hint="Include the country code, e.g. +91 98765 00001">
            <input
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="+919876500001"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <Field label="Invite code (only if you have one)">
            <input
              inputMode="text"
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <Button type="submit" size="lg" disabled={submitting || !phone}>
            {submitting ? "Redirecting to Swiggy…" : (
              <>
                Continue with Swiggy
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Hint({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border/60 p-3 text-sm">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span>
        <span className="font-medium">{title}</span>
        <span className="block text-muted-foreground">{text}</span>
      </span>
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
