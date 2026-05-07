"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUp, Sparkles, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Message {
  role: "user" | "bot" | "system";
  text: string;
  ts: number;
}

interface Me {
  authenticated: boolean;
  phone?: string;
  demoMode?: boolean;
}

const SUGGESTIONS = [
  "biryani from Paradise, ₹500",
  "paneer butter masala under ₹400",
  "pizza margherita",
  "chinese for one, ₹300",
];

export default function NewOrderPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auth + intro on mount.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) {
        router.replace("/connect?error=needs_login");
        return;
      }
      const data = (await res.json()) as Me;
      setMe(data);
      setMessages([
        {
          role: "bot",
          ts: Date.now(),
          text: data.demoMode
            ? "Hi! Tell me what you'd like to order — e.g. \"biryani from Paradise, ₹500\". I'll walk you through three confirmation gates. We're in demo mode, so no real Swiggy order will be placed."
            : "Hi! Tell me what you'd like to order — e.g. \"biryani from Paradise, ₹500\". I'll walk you through three confirmation gates and a 30-second grace timer.",
        },
      ]);
    })();
  }, [router]);

  // Auto-scroll on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setMessages((m) => [...m, { role: "user", text: trimmed, ts: Date.now() }]);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.status === 401) {
        router.replace("/connect?error=session_expired");
        return;
      }
      const json = await res.json();
      const reply = json.reply ?? json.error ?? "(no reply)";
      setMessages((m) => [...m, { role: "bot", text: reply, ts: Date.now() }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "system", text: `Couldn't reach the server: ${(err as Error).message}`, ts: Date.now() },
      ]);
    } finally {
      setPending(false);
    }
  }

  function reset() {
    void send("STOP");
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        { role: "system", text: "— new order —", ts: Date.now() },
      ]);
    }, 600);
  }

  if (!me) {
    return (
      <main className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      {me.demoMode && (
        <div className="border-b border-orange-200/60 bg-orange-50/60 dark:bg-orange-500/10">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-6 py-2 text-xs text-orange-900 dark:text-orange-200">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Demo mode</strong> — confirmations work end-to-end, but the final order is
              not actually placed on Swiggy. No money, no delivery.
            </span>
          </div>
        </div>
      )}

      <section
        ref={scrollRef}
        className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-6"
      >
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <Bubble key={`${m.ts}-${i}`} message={m} />
          ))}
          {pending && (
            <div className="self-start rounded-2xl rounded-bl-sm bg-secondary px-4 py-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60 [animation-delay:240ms]" />
              </span>
            </div>
          )}
        </div>

        {messages.length <= 1 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                disabled={pending}
                className="rounded-full border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="border-t border-border/60 bg-background">
        <div className="mx-auto w-full max-w-3xl px-6 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              autoFocus
              autoComplete="off"
              placeholder={pending ? "Working on it…" : "Type an order, or YES / STOP at a gate"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={pending}
              className="h-11 flex-1 rounded-full border border-input bg-background px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <Button
              type="submit"
              size="icon"
              disabled={pending || !input.trim()}
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </form>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Connected as {maskPhone(me.phone ?? "")}</span>
            <button
              onClick={reset}
              disabled={pending}
              className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              <RefreshCw className="h-3 w-3" /> Start over
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="my-2 flex items-center gap-2 self-center rounded-md border border-border/60 bg-secondary/40 px-3 py-1 text-xs text-muted-foreground">
        <AlertCircle className="h-3 w-3" /> {message.text}
      </div>
    );
  }
  const isUser = message.role === "user";
  return (
    <div
      className={
        isUser
          ? "max-w-[80%] self-end rounded-2xl rounded-br-sm bg-foreground px-4 py-2 text-sm text-background"
          : "max-w-[80%] self-start whitespace-pre-line rounded-2xl rounded-bl-sm bg-secondary px-4 py-2 text-sm text-foreground"
      }
    >
      {message.text}
    </div>
  );
}

function maskPhone(p: string): string {
  if (!p) return "—";
  const digits = p.replace(/\D/g, "");
  if (digits.length <= 4) return p;
  return `${p.slice(0, p.length - digits.length + 2)}…${digits.slice(-4)}`;
}
