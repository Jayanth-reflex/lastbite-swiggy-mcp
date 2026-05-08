"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Zap,
  Command as CommandIcon,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [liveDialogOpen, setLiveDialogOpen] = useState(false);
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

  // Cmd/Ctrl-K opens the example palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-scroll on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  const send = useCallback(
    async (text: string) => {
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
        toast.error("Couldn't reach the server", {
          description: (err as Error).message,
        });
      } finally {
        setPending(false);
      }
    },
    [pending, router],
  );

  async function applyMode(target: OrderMode) {
    if (!me) return;
    const res = await fetch("/api/me/mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: target }),
    });
    if (!res.ok) {
      toast.error(`Couldn't switch mode (HTTP ${res.status})`);
      return;
    }
    const json = (await res.json()) as {
      mode: OrderMode;
      effectiveMode: OrderMode;
      realOrdersAvailable: boolean;
    };
    setMe({ ...me, ...json });
    if (json.effectiveMode === "live") {
      toast.warning("Live mode active", {
        description: "Final YES will place a real Swiggy COD order.",
      });
    } else if (json.mode === "live") {
      toast.info("Saved as live, but host hasn't enabled real orders globally — staying in demo.");
    } else {
      toast.success("Demo mode active", {
        description: "Confirmations work end-to-end, no real order placed.",
      });
    }
  }

  function flipMode(target: OrderMode) {
    if (!me) return;
    if (target === "live") {
      if (!me.realOrdersAvailable) {
        toast.error("Live mode is disabled by the host", {
          description: "The site owner needs to set LB_REAL_ORDERS=1 first.",
        });
        return;
      }
      setLiveDialogOpen(true);
      return;
    }
    void applyMode("demo");
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

  if (!me) return <ChatSkeleton />;

  const isDemo = me.effectiveMode !== "live";
  const items = isDemo ? SUGGESTIONS_DEMO : SUGGESTIONS_LIVE;

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
          {pending && <PendingBubble />}
        </div>

        {messages.length <= 1 && (
          <EmptyHints
            items={items}
            pending={pending}
            onPick={(s) => void send(s)}
            onOpenPalette={() => setPaletteOpen(true)}
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
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={items}
        onPick={(s) => {
          setPaletteOpen(false);
          void send(s);
        }}
      />

      <LiveModeDialog
        open={liveDialogOpen}
        onOpenChange={setLiveDialogOpen}
        onConfirm={() => {
          setLiveDialogOpen(false);
          void applyMode("live");
        }}
      />
    </main>
  );
}

function ChatSkeleton() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="border-b border-border/60 bg-card/40">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-2.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-7 w-24 rounded-full" />
        </div>
      </div>
      <section className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Skeleton className="h-20 w-3/4 rounded-2xl" />
      </section>
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
    <div className="border-b border-border/60 bg-card/40 backdrop-blur">
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
              <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/15 text-rose-500 dark:bg-rose-500/20 dark:text-rose-300">
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
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent>Safe mode — no real orders</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onFlip("live")}
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
        </TooltipTrigger>
        <TooltipContent>
          {available ? "Real Swiggy COD orders" : "Disabled by host"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function EmptyHints({
  items,
  pending,
  onPick,
  onOpenPalette,
}: {
  items: string[];
  pending: boolean;
  onPick: (s: string) => void;
  onOpenPalette: () => void;
}) {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="mt-8 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Try an example
        </span>
        <button
          type="button"
          onClick={onOpenPalette}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <CommandIcon className="h-3 w-3" />
          <span>{isMac ? "⌘K" : "Ctrl+K"}</span>
        </button>
      </div>
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
  onOpenPalette,
}: {
  input: string;
  setInput: (v: string) => void;
  pending: boolean;
  onSend: () => void;
  phone: string;
  onReset: () => void;
  onOpenPalette: () => void;
}) {
  return (
    <div className="border-t border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-3xl px-6 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
          className="flex items-center gap-2 rounded-full border border-input bg-card px-2 py-1.5 transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenPalette}
                aria-label="Open command palette"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <CommandIcon className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Examples (⌘K)</TooltipContent>
          </Tooltip>
          <Input
            type="text"
            autoFocus
            autoComplete="off"
            placeholder={pending ? "Working on it…" : "Type an order, or YES / STOP at a gate"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
            className="h-9 flex-1 rounded-none border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="submit"
                size="icon-sm"
                disabled={pending || !input.trim()}
                aria-label="Send"
                className="rounded-full"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Send (Return)</TooltipContent>
          </Tooltip>
        </form>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-default items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Connected as {maskPhone(phone)}
              </span>
            </TooltipTrigger>
            <TooltipContent>Session active · token sealed in Upstash</TooltipContent>
          </Tooltip>
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

function CommandPalette({
  open,
  onOpenChange,
  items,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: string[];
  onPick: (s: string) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search example orders…" />
      <CommandList>
        <CommandEmpty>No examples match.</CommandEmpty>
        <CommandGroup heading="Examples">
          {items.map((s) => (
            <CommandItem key={s} onSelect={() => onPick(s)} value={s}>
              <Sparkles className="text-brand" />
              <span>{s}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Gate replies">
          <CommandItem onSelect={() => onPick("YES")} value="yes confirm">
            <span className="font-mono text-xs">YES</span>
            <span className="text-muted-foreground">Advance the current gate</span>
          </CommandItem>
          <CommandItem onSelect={() => onPick("STOP")} value="stop cancel">
            <span className="font-mono text-xs">STOP</span>
            <span className="text-muted-foreground">Cancel the in-flight order</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function LiveModeDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="inline-flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/15 text-rose-500 dark:bg-rose-500/20 dark:text-rose-300">
              <Zap className="h-3.5 w-3.5" />
            </span>
            Switch to live mode?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Your <strong className="text-foreground">next confirmed order</strong> will place a
            real Swiggy COD order. Three confirmation gates and a 30-second STOP grace timer
            still apply, but <strong className="text-foreground">orders cannot be cancelled
            after they fire</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay in demo</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600/20"
          >
            Switch to live
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PendingBubble() {
  return (
    <div className="flex items-end gap-2 self-start">
      <BotAvatar />
      <div className="rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60 [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/60 [animation-delay:240ms]" />
        </span>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="my-2 inline-flex items-center gap-1.5 self-center rounded-full border border-border/60 bg-secondary/60 px-3 py-1 text-[11px] text-muted-foreground animate-bubble-in">
        <AlertCircle className="h-3 w-3" /> {message.text}
      </div>
    );
  }
  if (message.role === "user") {
    return (
      <div className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background animate-bubble-in">
        {message.text}
      </div>
    );
  }
  return (
    <div className="flex max-w-[85%] items-end gap-2 self-start animate-bubble-in">
      <BotAvatar />
      <div className="whitespace-pre-line rounded-2xl rounded-bl-md bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground">
        {message.text}
      </div>
    </div>
  );
}

function BotAvatar() {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background ring-1 ring-foreground/10 dark:ring-foreground/30"
    >
      <Bot className="h-3.5 w-3.5" />
    </span>
  );
}

function maskPhone(p: string): string {
  if (!p) return "—";
  const digits = p.replace(/\D/g, "");
  if (digits.length <= 4) return p;
  return `${p.slice(0, p.length - digits.length + 2)}…${digits.slice(-4)}`;
}
