"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles, AlertCircle, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Message {
  role: "user" | "bot" | "system";
  text: string;
  ts: number;
}

type OrderMode = "demo" | "live";

interface Me {
  authenticated: boolean;
  phone?: string;
  mode?: OrderMode;
  effectiveMode?: OrderMode;
  realOrdersAvailable?: boolean;
}

const SUGGESTIONS_DEMO = [
  "chocolate ice cream within 7km of MyHome, best rated, under ₹300",
  "biryani at Paradise, ₹500",
  "veg pizza near Work, top rated within 5km",
  "paneer butter masala, 2 plates, under ₹600",
];

const SUGGESTIONS_LIVE = [
  "chocolate ice cream within 7km of MyHome, best rated, under ₹300",
  "biryani at Paradise, ₹500",
  "veg pizza near Work, top rated within 5km",
];

const EXAMPLE_HINT =
  "Try: \"chocolate ice cream within 7km of my MyHome address, best rated, under ₹300\". " +
  "I understand budgets, distance limits, ratings, named addresses (MyHome / Work / Gym), " +
  "veg-only filters, and quantities.";

export default function NewOrderPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) {
        router.replace("/connect?error=needs_login");
        return;
      }
      const data = (await res.json()) as Me;
      setMe(data);
      const isDemo = data.effectiveMode === "demo";
      setMessages([
        {
          role: "bot",
          ts: Date.now(),
          text: isDemo
            ? `Hi! ${EXAMPLE_HINT} I'll walk you through three confirmation gates. We're in demo mode, so no real Swiggy order will be placed — perfect for trying things out.`
            : `Hi! ${EXAMPLE_HINT} I'll walk you through three confirmation gates and a 30-second grace timer before any real order goes through.`,
        },
      ]);
    })();
  }, [router]);

  async function flipMode(target: OrderMode) {
    if (!me) return;
    if (target === "live") {
      if (!me.realOrdersAvailable) {
        setMessages((m) => [
          ...m,
          {
            role: "system",
            text: "Live mode is disabled by the host. The site owner needs to set LB_REAL_ORDERS=1 first.",
            ts: Date.now(),
          },
        ]);
        return;
      }
      const ok = window.confirm(
        "Switch to LIVE mode?\n\nYour next confirmed order will place a REAL Swiggy order (cash on delivery). Three confirmation gates and a 30-second grace timer still apply.\n\nClick OK to switch, Cancel to stay in demo.",
      );
      if (!ok) return;
    }
    const res = await fetch("/api/me/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: target }),
    });
    if (!res.ok) {
      setMessages((m) => [
        ...m,
        { role: "system", text: `Couldn't switch mode (HTTP ${res.status}).`, ts: Date.now() },
      ]);
      return;
    }
    const json = (await res.json()) as {
      mode: OrderMode;
      effectiveMode: OrderMode;
      realOrdersAvailable: boolean;
    };
    setMe({ ...me, ...json });
    setMessages((m) => [
      ...m,
      {
        role: "system",
        text:
          json.effectiveMode === "live"
            ? "Switched to LIVE mode. Real Swiggy orders will be placed on your final YES."
            : json.mode === "live"
              ? "Saved your preference as LIVE, but the host hasn't enabled live orders globally — staying in demo for now."
              : "Switched to DEMO mode. No real orders will be placed.",
        ts: Date.now(),
      },
    ]);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
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
        {
          role: "system",
          text: `Couldn't reach the server: ${(err as Error).message}`,
          ts: Date.now(),
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  function reset() {
    void send("STOP");
    setTimeout(() => {
      setMessages((m) => [...m, { role: "system", text: "— new order —", ts: Date.now() }]);
    }, 600);
  }

  if (!me) {
    return (
      <main className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60 [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60 [animation-delay:240ms]" />
        </span>
      </main>
    );
  }

  const isDemo = me.effectiveMode !== "live";

  return (
    <main className="flex flex-1 flex-col">
      <ModeBanner
        isDemo={isDemo}
        mode={me.effectiveMode ?? "demo"}
        available={me.realOrdersAvailable ?? false}
        onFlip={flipMode}
      />

      <section
        ref={scrollRef}
        className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-6 py-8"
      >
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <Bubble key={`${m.ts}-${i}`} message={m} />
          ))}
          {pending && (
            <div className="self-start rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60 [animation-delay:240ms]" />
              </span>
            </div>
          )}
        </div>

        {messages.length <= 1 && (
          <EmptyHints
            isDemo={isDemo}
            pending={pending}
            onPick={(s) => void send(s)}
          />
        )}
      </section>

      <Composer
        input={input}
        setInput={setInput}
        pending={pending}
        onSend={() => void send(input)}
        phone={me.phone ?? ""}
        onReset={reset}
      />
    </main>
  );
}

function ModeBanner({
  isDemo,
  mode,
  available,
  onFlip,
}: {
  isDemo: boolean;
  mode: OrderMode;
  available: boolean;
  onFlip: (target: OrderMode) => void;
}) {
  return (
    <div className="border-b border-border/60 bg-card/50 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-2.5">
        <span className="inline-flex items-center gap-2 text-xs">
          {isDemo ? (
            <>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-soft text-brand-muted">
                <Sparkles className="h-3 w-3" />
              </span>
              <span className="text-muted-foreground">
                <strong className="font-medium text-foreground">Demo mode</strong> — confirmations
                run end-to-end, no real order placed.
              </span>
            </>
          ) : (
            <>
              <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                <Zap className="h-3 w-3" />
                <span className="absolute -inset-0.5 animate-ping rounded-full bg-rose-500/20" />
              </span>
              <span className="text-muted-foreground">
                <strong className="font-medium text-foreground">Live mode</strong> — final YES
                places a real Swiggy COD order.
              </span>
            </>
          )}
        </span>
        <ModeToggle mode={mode} available={available} onFlip={onFlip} />
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  available,
  onFlip,
}: {
  mode: OrderMode;
  available: boolean;
  onFlip: (target: OrderMode) => void;
}) {
  return (
    <div className="ml-auto inline-flex items-center rounded-full bg-secondary p-0.5 text-[11px] font-medium ring-1 ring-foreground/[0.04]">
      <button
        type="button"
        onClick={() => onFlip("demo")}
        className={
          mode === "demo"
            ? "rounded-full bg-card px-2.5 py-1 text-foreground shadow-sm ring-1 ring-foreground/[0.06]"
            : "rounded-full px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
        }
      >
        Demo
      </button>
      <button
        type="button"
        onClick={() => onFlip("live")}
        title={available ? "Switch to live (real orders)" : "Live disabled by host"}
        className={
          mode === "live"
            ? "rounded-full bg-rose-600 px-2.5 py-1 text-white shadow-sm"
            : `rounded-full px-2.5 py-1 transition-colors ${
                available
                  ? "text-muted-foreground hover:text-foreground"
                  : "cursor-not-allowed text-muted-foreground/40"
              }`
        }
      >
        Live
      </button>
    </div>
  );
}

function EmptyHints({
  isDemo,
  pending,
  onPick,
}: {
  isDemo: boolean;
  pending: boolean;
  onPick: (s: string) => void;
}) {
  const items = isDemo ? SUGGESTIONS_DEMO : SUGGESTIONS_LIVE;
  return (
    <div className="mt-8 flex flex-col gap-4">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Try an example
      </span>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            disabled={pending}
            className="group flex items-start gap-2 rounded-xl border border-border/60 bg-card p-3 text-left text-sm text-muted-foreground transition-all hover:-translate-y-px hover:border-foreground/20 hover:text-foreground hover:shadow-sm disabled:opacity-50"
          >
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand opacity-70 transition-opacity group-hover:opacity-100" />
            <span className="leading-relaxed">{s}</span>
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        I understand <strong className="text-foreground">budgets</strong> (₹300, under ₹500),{" "}
        <strong className="text-foreground">distance</strong> (within 5km),{" "}
        <strong className="text-foreground">rating</strong> (best rated),{" "}
        <strong className="text-foreground">saved addresses</strong> (MyHome / Work / Gym),{" "}
        <strong className="text-foreground">veg / non-veg</strong>, and{" "}
        <strong className="text-foreground">quantities</strong> (2 plates).
      </p>
    </div>
  );
}

function Composer({
  input,
  setInput,
  pending,
  onSend,
  phone,
  onReset,
}: {
  input: string;
  setInput: (v: string) => void;
  pending: boolean;
  onSend: () => void;
  phone: string;
  onReset: () => void;
}) {
  return (
    <div className="border-t border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-3xl px-6 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          className="flex items-center gap-2 rounded-full border border-input bg-card px-4 py-1.5 transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30"
        >
          <input
            type="text"
            autoFocus
            autoComplete="off"
            placeholder={pending ? "Working on it…" : "Type an order, or YES / STOP at a gate"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={pending || !input.trim()}
            aria-label="Send"
            className="rounded-full"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
        </form>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Connected as {maskPhone(phone)}
          </span>
          <button
            onClick={onReset}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" /> Start over
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="my-2 inline-flex items-center gap-1.5 self-center rounded-full border border-border/60 bg-secondary/60 px-3 py-1 text-[11px] text-muted-foreground">
        <AlertCircle className="h-3 w-3" /> {message.text}
      </div>
    );
  }
  const isUser = message.role === "user";
  return (
    <div
      className={
        isUser
          ? "max-w-[80%] self-end rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background"
          : "max-w-[80%] self-start whitespace-pre-line rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground"
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
