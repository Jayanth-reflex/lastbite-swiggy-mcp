"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PoweredBySwiggy } from "@/components/powered-by-swiggy";

interface Status {
  kind: "idle" | "submitting" | "ok" | "error";
  message?: string;
}

export default function ConnectPage() {
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    const res = await fetch("/api/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, token, inviteCode: inviteCode || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus({ kind: "error", message: json.error ?? `HTTP ${res.status}` });
      return;
    }
    setStatus({
      kind: "ok",
      message: `Connected ${json.phone}. Check WhatsApp for confirmation.`,
    });
    setToken("");
  }

  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-16">
        <PoweredBySwiggy variant="inline" className="self-start" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Connect Swiggy MCP</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bring Your Own Claude (BYOC). Paste your personal Swiggy MCP bearer token from your
            Claude Desktop OAuth session. We&rsquo;ll encrypt it at rest with AES-256-GCM and use
            it only for orders you confirm via WhatsApp.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pair this number</CardTitle>
            <CardDescription>
              Phone is your WhatsApp identifier. Token is a single string from your Claude
              Desktop config.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <Field label="WhatsApp phone (E.164, e.g. +9198…)">
                <input
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+919876500001"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </Field>
              <Field label="Swiggy MCP bearer token">
                <textarea
                  required
                  rows={4}
                  placeholder="ey…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </Field>
              <Field label="Invite code (beta — leave blank if you don't have one)">
                <input
                  inputMode="text"
                  autoComplete="off"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </Field>
              <Button type="submit" disabled={status.kind === "submitting"}>
                {status.kind === "submitting" ? "Connecting…" : "Connect"}
              </Button>
              {status.kind === "ok" && (
                <p className="text-sm text-emerald-600">{status.message}</p>
              )}
              {status.kind === "error" && (
                <p className="text-sm text-destructive">{status.message}</p>
              )}
            </form>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          By connecting, you agree to the <Link href="/privacy" className="underline">privacy policy</Link>.
          Reply <code>FORGET ME</code> on WhatsApp to revoke and wipe your token at any time.
        </p>
      </section>
      <PoweredBySwiggy />
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
