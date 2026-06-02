# Last Bite v2 — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ChatGPT/Claude-style web UI — auth, thread rail with memory, multi-model chat with streaming tool calls, the Swiggy connect flow, the demo/live toggle, and the **spending-gate card with a real, cancellable grace countdown** (fixing v1's F1).

**Architecture:** Next.js 16 App Router (client components for the chat surface). Auth via `@supabase/ssr` browser client. Chat via Vercel AI SDK `useChat` (`@ai-sdk/react`) consuming the backend's UI message stream; the commit-tool **gate** surfaces as a `data-gate` part rendered by `GateCard`. The frontend develops **fully against MSW mocks** of the API contract (spec §6) so it never blocks on the backend session.

**Tech Stack:** Next.js 16, TypeScript, Tailwind v4 + shadcn/ui, `@ai-sdk/react`, `@supabase/ssr`/`supabase-js`, `msw`, `vitest` + `@testing-library/react` + `jsdom`.

**Spec:** `docs/superpowers/specs/2026-06-03-lastbite-v2-design.md`. The **API Contract is §6** (the only thing this plan depends on from the backend). The **2-phase confirm** (yes→grace→commit) is §6.2 / §6.3 / §7.

---

## Parallelization & ownership (READ FIRST)

This plan runs in **Session 2 (frontend)**, parallel to **Session 1 (backend)**.

- **Start after backend Task B0** is pushed (scaffold + `lib/contract/types.ts` + env). Branch from that commit.
- **Frontend owns:** `app/(auth)/*`, `app/(app)/*` pages, `components/*`, `hooks/*`, `lib/supabase/client.ts`,
  `lib/api.ts` (typed fetch client), `mocks/*` (MSW), `middleware.ts` (route guard).
- **Do NOT touch backend-owned files** (`app/api/*`, `lib/gate/*`, `lib/mcp/*`, `lib/swiggy/*`, `lib/models/*`,
  `supabase/*`). Import types **only** from `@/lib/contract/types`.
- **Develop against MSW** (Task F1) implementing the exact §6 contract — so the UI is fully buildable/testable
  before the backend routes exist. Switch to the real API in **Task F-INT**.
- **Calibration note (honest):** the parallelization-enabling and safety-visible code (MSW handlers, `GateCard` +
  countdown, `useChat` wiring + `data-gate` handling, auth) is given as **complete code**. Standard pages and
  shadcn-wrapped components are given as **exact files + props + test cases + acceptance**, since they're mechanical
  and the contract pins the data. No step is a hidden "TODO".

---

## File structure (frontend-owned)

```
middleware.ts                         route guard (redirect unauth → /login)
lib/supabase/client.ts                browser client (createBrowserClient)
lib/api.ts                            typed fetch wrappers for every §6 endpoint
hooks/useMe.ts                        GET /api/me (SWR-ish)
hooks/useThreads.ts                   threads CRUD
hooks/usePendingActions.ts            GET /api/actions/pending (resume on load)
app/(auth)/login/page.tsx             Google + email magic-link
app/(app)/layout.tsx                  app shell: ThreadRail + header + ModeBanner
app/(app)/chat/[threadId]/page.tsx    chat surface (client)
app/(app)/chat/new/page.tsx           create thread → redirect
app/connect/page.tsx                  Connect Swiggy (start OAuth)
app/connect/success/page.tsx          post-connect
app/privacy/page.tsx                  DPDP page
components/chat/Composer.tsx
components/chat/MessageList.tsx
components/chat/MessageBubble.tsx
components/chat/ToolCallCard.tsx       renders read/cart/track tool parts
components/chat/GateCard.tsx          ★ commit-tool gate + grace countdown + STOP
components/threads/ThreadRail.tsx
components/ModelPicker.tsx
components/ModeToggle.tsx             demo/live + AlertDialog
components/ConnectSwiggyButton.tsx
components/PoweredBySwiggy.tsx
components/ui/*                        shadcn primitives
mocks/handlers.ts                     MSW handlers implementing spec §6
mocks/browser.ts  mocks/server.ts     MSW worker (dev) + node (tests)
mocks/fixtures.ts                     sample Me/threads/messages/cart
```

---

# PHASE P1 — Foundation (UI shell + auth, all on MSW)

### Task F0: Branch + FE deps + contract + supabase client

**Files:**
- Create: `lib/supabase/client.ts`, `lib/api.ts`
- Verify: `lib/contract/types.ts` exists (from backend B0)

- [ ] **Step 1: Branch from backend B0 commit** and install FE deps:

```bash
npm i @ai-sdk/react msw
npm i -D @testing-library/react @testing-library/user-event jsdom @testing-library/jest-dom
npx shadcn@latest init -d
npx shadcn@latest add button card dialog alert-dialog input textarea scroll-area sonner skeleton dropdown-menu avatar badge tooltip separator
```

- [ ] **Step 2: `lib/supabase/client.ts`** — `createBrowserClient(URL, ANON_KEY)` from `@supabase/ssr`; export a singleton `supabase`.
- [ ] **Step 3: `lib/api.ts`** — typed wrappers returning the §6.1 types, throwing `ApiError` on non-2xx:

```ts
import type { Me, Thread, ChatMessage, PendingAction, ConfirmResponse, GateOutcome, OrderMode, Surface } from "@/lib/contract/types";
async function j<T>(r: Response): Promise<T> { if (!r.ok) throw await r.json(); return r.json(); }
export const api = {
  me: () => fetch("/api/me").then(j<Me>),
  setMode: (mode: OrderMode) => fetch("/api/mode", { method: "POST", body: JSON.stringify({ mode }) }).then(j<{mode:OrderMode;effectiveMode:OrderMode;realOrdersAvailable:boolean}>),
  connectStart: (surface?: Surface) => fetch("/api/swiggy/connect/start", { method: "POST", body: JSON.stringify({ surface }) }).then(j<{authorizeUrl:string}>),
  threads: () => fetch("/api/threads").then(j<Thread[]>),
  newThread: (b: {title?:string;model:string;surface?:Surface|null}) => fetch("/api/threads", { method:"POST", body: JSON.stringify(b) }).then(j<Thread>),
  thread: (id: string) => fetch(`/api/threads/${id}`).then(j<{thread:Thread;messages:ChatMessage[]}>),
  renameThread: (id: string, b:{title?:string;model?:string}) => fetch(`/api/threads/${id}`, { method:"PATCH", body: JSON.stringify(b) }).then(j<Thread>),
  deleteThread: (id: string) => fetch(`/api/threads/${id}`, { method:"DELETE" }).then(j<{ok:true}>),
  pending: () => fetch("/api/actions/pending").then(j<PendingAction[]>),
  confirm: (id: string, decision: "yes"|"stop") => fetch(`/api/actions/${id}/confirm`, { method:"POST", body: JSON.stringify({ decision }) }).then(j<ConfirmResponse>),
  commit: (id: string) => fetch(`/api/actions/${id}/commit`, { method:"POST" }).then(j<GateOutcome>),
};
```

- [ ] **Step 4: Commit** `git commit -m "feat(F0): FE deps + supabase client + typed api"`.

**Acceptance:** `npm run build` passes; `api` typechecks against `lib/contract/types`.

---

### Task F1: MSW mocks of the API contract (parallelization enabler)

**Files:**
- Create: `mocks/fixtures.ts`, `mocks/handlers.ts`, `mocks/browser.ts`, `mocks/server.ts`
- Modify: `app/(app)/layout.tsx` later to start the worker in dev

- [ ] **Step 1: `mocks/fixtures.ts`** — sample `Me` (connected:true, mode:"demo", models: 3 ModelOptions, one toolReliable), two `Thread`s, a `messages` list, a `CartSummary`.
- [ ] **Step 2: `mocks/handlers.ts`** — implement every §6.2 route. The important ones:

```ts
import { http, HttpResponse } from "msw";
import { me, threads, messagesByThread, sampleCart } from "./fixtures";
let pending: Record<string, { graceCancelled: boolean }> = {};
export const handlers = [
  http.get("/api/me", () => HttpResponse.json(me)),
  http.post("/api/mode", async ({ request }) => { const { mode } = await request.json() as any; return HttpResponse.json({ mode, effectiveMode: me.realOrdersAvailable ? mode : "demo", realOrdersAvailable: me.realOrdersAvailable }); }),
  http.post("/api/swiggy/connect/start", () => HttpResponse.json({ authorizeUrl: "/connect/success?mock=1" })),
  http.get("/api/threads", () => HttpResponse.json(threads)),
  http.post("/api/threads", async ({ request }) => { const b = await request.json() as any; const t = { id: crypto.randomUUID(), title: b.title ?? "New chat", model: b.model, surface: b.surface ?? null, updatedAt: new Date().toISOString() }; threads.unshift(t); return HttpResponse.json(t); }),
  http.get("/api/threads/:id", ({ params }) => HttpResponse.json({ thread: threads.find(t=>t.id===params.id) ?? threads[0], messages: messagesByThread[params.id as string] ?? [] })),
  http.patch("/api/threads/:id", async ({ params, request }) => { const b = await request.json() as any; const t = threads.find(x=>x.id===params.id)!; Object.assign(t, b); return HttpResponse.json(t); }),
  http.delete("/api/threads/:id", ({ params }) => { const i = threads.findIndex(t=>t.id===params.id); if(i>=0) threads.splice(i,1); return HttpResponse.json({ ok:true }); }),
  // Chat: stream a UI message that ends in a data-gate part when the user message implies an order.
  http.post("/api/chat", async ({ request }) => {
    const { message } = await request.json() as any;
    const ordering = /order|place|biryani|checkout|book/i.test(message);
    const actionId = crypto.randomUUID();
    if (ordering) pending[actionId] = { graceCancelled: false };
    const stream = mockUiStream(ordering ? { gate: { actionId, surface: "food", tool: "place_food_order", cart: sampleCart, expiresAt: new Date(Date.now()+30*60000).toISOString(), origin: "chat" } } : { text: "Here's what I found…" });
    return new HttpResponse(stream, { headers: { "content-type": "text/event-stream" } });
  }),
  http.get("/api/actions/pending", () => HttpResponse.json(Object.keys(pending).map(id => ({ id, surface:"food", tool:"place_food_order", cart: sampleCart, expiresAt: new Date(Date.now()+1800000).toISOString(), origin:"chat" })))),
  http.post("/api/actions/:id/confirm", async ({ params, request }) => { const { decision } = await request.json() as any; const id = params.id as string; if (decision === "stop") { if (pending[id]) pending[id].graceCancelled = true; return HttpResponse.json({ status: "cancelled" }); } return HttpResponse.json({ status: "grace", graceSeconds: 30, actionId: id }); }),
  http.post("/api/actions/:id/commit", ({ params }) => { const id = params.id as string; if (pending[id]?.graceCancelled) return HttpResponse.json({ status: "cancelled" }); delete pending[id]; return HttpResponse.json({ status: "placed", orderId: "demo_"+Math.random().toString(36).slice(2,8) }); }),
];
```

- [ ] **Step 3: `mockUiStream(...)`** helper — produce an AI SDK UI-message-stream-compatible SSE body. For text: emit text-delta parts. For gate: emit a `data-gate` part `{ type:"data-gate", data:{ actionId, pending } }` then finish. (Encode per the AI SDK UI stream protocol; verify with a one-off `useChat` render in dev.)
- [ ] **Step 4: `mocks/browser.ts`** (`setupWorker`) + `mocks/server.ts` (`setupServer`). Start the worker in dev only (guard on `NEXT_PUBLIC_API_MOCK==="1"`).
- [ ] **Step 5: Commit** `git commit -m "feat(F1): MSW mocks of the API contract"`.

**Acceptance:** with `NEXT_PUBLIC_API_MOCK=1`, the app runs with zero backend; `/api/chat` streams text and (for ordering messages) a `data-gate`.

---

### Task F2: Auth (login + route guard)

**Files:**
- Create: `app/(auth)/login/page.tsx`, `middleware.ts`
- Test: `app/(auth)/login/login.test.tsx`

- [ ] **Step 1: `app/(auth)/login/page.tsx`** — two actions: "Continue with Google" (`supabase.auth.signInWithOAuth({provider:"google"})`) and an email field → "Send magic link" (`supabase.auth.signInWithOtp({email})`) with a sent-confirmation state.
- [ ] **Step 2: `middleware.ts`** — use `@supabase/ssr` middleware to refresh the session; redirect unauthenticated requests for `/(app)` and `/connect` to `/login`. Allow `/login`, `/privacy`, `/api/*`.
- [ ] **Step 3: Test `login.test.tsx`** — renders both options; clicking "Send magic link" with a valid email calls `signInWithOtp` (mock supabase) and shows "check your email".
- [ ] **Step 4: Commit** `git commit -m "feat(F2): auth login + route guard"`.

**Acceptance:** unauth → redirected to /login; magic-link + Google actions wired.

---

# PHASE P2 — Chat shell + multi-model (on MSW)

### Task F3: App shell + thread rail + model picker

**Files:**
- Create: `app/(app)/layout.tsx`, `components/threads/ThreadRail.tsx`, `components/ModelPicker.tsx`, `hooks/useThreads.ts`, `hooks/useMe.ts`, `app/(app)/chat/new/page.tsx`, `components/PoweredBySwiggy.tsx`
- Test: `components/threads/ThreadRail.test.tsx`

- [ ] **Step 1: `hooks/useMe.ts` + `hooks/useThreads.ts`** — fetch `api.me()` / `api.threads()`; expose data + mutate (new/rename/delete).
- [ ] **Step 2: `ThreadRail.tsx`** — list threads (title + updatedAt), "New chat" button (→ `/chat/new`), per-row rename + delete (AlertDialog confirm on delete). Active thread highlighted.
- [ ] **Step 3: `ModelPicker.tsx`** — dropdown from `me.models` grouped by provider; models with `toolReliable:false` show a "chat-only" badge and are disabled when the active thread has a `surface`. Selecting updates the thread (`api.renameThread(id,{model})`).
- [ ] **Step 4: `app/(app)/layout.tsx`** — shell: ThreadRail (left) + header (ModeBanner placeholder + ModelPicker + sign-out) + `<PoweredBySwiggy/>` footer. Start MSW worker if `NEXT_PUBLIC_API_MOCK==="1"`.
- [ ] **Step 5: `chat/new/page.tsx`** — create a thread (default model = `me.defaultAgenticModel`, surface "food") → redirect to `/chat/[id]`.
- [ ] **Step 6: `PoweredBySwiggy.tsx`** — required attribution; inline + footer variants; never hidden.
- [ ] **Step 7: Test `ThreadRail.test.tsx`** — renders threads from MSW; "New chat" calls create; delete asks confirm then removes.
- [ ] **Step 8: Commit** `git commit -m "feat(F3): app shell + thread rail + model picker"`.

**Acceptance:** thread list/create/rename/delete work on MSW; model picker enforces tool-reliable for agentic threads.

---

### Task F4: Connect Swiggy + mode toggle + status banner

**Files:**
- Create: `app/connect/page.tsx`, `app/connect/success/page.tsx`, `components/ConnectSwiggyButton.tsx`, `components/ModeToggle.tsx`, `components/ModeBanner.tsx`
- Test: `components/ModeToggle.test.tsx`

- [ ] **Step 1: `ConnectSwiggyButton.tsx`** — calls `api.connectStart()` → `window.location.assign(authorizeUrl)`. On MSW this lands on `/connect/success`.
- [ ] **Step 2: `app/connect/page.tsx`** — explains native OAuth ("you'll sign in on Swiggy; we never see your OTP"), renders the button. No Claude-Desktop / token-paste copy (removed in v2).
- [ ] **Step 3: `ModeBanner.tsx` + `ModeToggle.tsx`** — banner shows current effective mode; toggle demo↔live. Switching to **live** opens an `AlertDialog` ("orders cannot be cancelled after they fire"); if `!realOrdersAvailable`, live is disabled with "host hasn't enabled real orders yet." Calls `api.setMode`.
- [ ] **Step 4: Test `ModeToggle.test.tsx`** — toggling to live shows the AlertDialog; confirming calls `api.setMode("live")`; with `realOrdersAvailable:false`, live is disabled.
- [ ] **Step 5: Commit** `git commit -m "feat(F4): connect swiggy + mode toggle"`.

**Acceptance:** connect flow redirects; live toggle gated by AlertDialog + realOrdersAvailable.

---

### Task F5: Chat surface (useChat streaming + tool cards)

**Files:**
- Create: `app/(app)/chat/[threadId]/page.tsx`, `components/chat/Composer.tsx`, `components/chat/MessageList.tsx`, `components/chat/MessageBubble.tsx`, `components/chat/ToolCallCard.tsx`
- Test: `components/chat/chat.test.tsx`

- [ ] **Step 1: chat page** — load `api.thread(id)` for history; init `useChat` with a `DefaultChatTransport` whose `prepareSendMessagesRequest` posts `{ threadId, model, message: lastUserText }` to `/api/chat`. Seed `messages` from history.
- [ ] **Step 2: `MessageList` + `MessageBubble`** — render `message.parts`: text parts stream; tool parts → `ToolCallCard` (tool name + compact args/results, e.g. a restaurant list or cart preview). User vs assistant styling; auto-scroll.
- [ ] **Step 3: `ToolCallCard.tsx`** — friendly rendering for `search_restaurants` (list), `get_food_cart`/`update_food_cart` (cart preview), `track_food_order` (status). Unknown tools → compact JSON.
- [ ] **Step 4: `Composer.tsx`** — textarea + send; disabled while streaming; Cmd/Ctrl+Enter to send.
- [ ] **Step 5: Test `chat.test.tsx`** — sending "show biryani" (non-order) streams assistant text; a tool part renders a ToolCallCard. (Gate path tested in F6.)
- [ ] **Step 6: Commit** `git commit -m "feat(F5): chat surface with streaming + tool cards"`.

**Acceptance:** multi-turn streaming chat renders text + tool cards from MSW; history loads.

---

# PHASE P3 — The gate card (★ fixes v1 F1)

### Task F6: GateCard — confirm → visible grace countdown → commit

**Files:**
- Create: `components/chat/GateCard.tsx`, `hooks/usePendingActions.ts`
- Modify: `components/chat/MessageList.tsx` (render `data-gate` parts), `app/(app)/chat/[threadId]/page.tsx` (resume pending on load)
- Test: `components/chat/GateCard.test.tsx`

- [ ] **Step 1: Write failing test `GateCard.test.tsx`** (the safety-visible behavior):

```tsx
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { GateCard } from "./GateCard";
import { server } from "@/mocks/server";

const pending = { id: "a1", surface: "food", tool: "place_food_order",
  cart: { lines:[{name:"Biryani",qty:1,priceRupees:449}], subtotalRupees:449, deliveryRupees:40, totalRupees:489 },
  expiresAt: new Date(Date.now()+1800000).toISOString(), origin: "chat" } as const;

it("YES opens a countdown; STOP during it cancels and never commits", async () => {
  const onResolved = vi.fn();
  render(<GateCard pending={pending} onResolved={onResolved} />);
  fireEvent.click(screen.getByRole("button", { name: /yes/i }));
  await screen.findByText(/30s/i);                       // countdown visible (fixes F1)
  fireEvent.click(screen.getByRole("button", { name: /stop/i }));
  await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ status: "cancelled" }));
});

it("YES + countdown elapses commits to placed", async () => {
  vi.useFakeTimers();
  const onResolved = vi.fn();
  render(<GateCard pending={pending} onResolved={onResolved} graceOverrideSeconds={1} />);
  fireEvent.click(screen.getByRole("button", { name: /yes/i }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  await waitFor(() => expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: "placed" })));
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run** `npx vitest run components/chat/GateCard.test.tsx` → FAIL.
- [ ] **Step 3: Implement `GateCard.tsx`:**

```tsx
"use client";
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { PendingAction, GateOutcome } from "@/lib/contract/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "grace" | "committing" | "done";

export function GateCard({ pending, onResolved, graceOverrideSeconds }:
  { pending: PendingAction; onResolved: (o: GateOutcome | { status: "cancelled" }) => void; graceOverrideSeconds?: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);
  const c = pending.cart;

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function onYes() {
    const res = await api.confirm(pending.id, "yes");
    if (res.status !== "grace") { onResolved({ status: "cancelled" }); return; }
    const secs = graceOverrideSeconds ?? res.graceSeconds;
    cancelled.current = false;
    setPhase("grace"); setRemaining(secs);
    timer.current = setInterval(() => {
      setRemaining((r) => {
        if (cancelled.current) return r;
        if (r <= 1) { if (timer.current) clearInterval(timer.current); void commit(); return 0; }
        return r - 1;
      });
    }, 1000);
  }
  async function commit() {
    setPhase("committing");
    const outcome = await api.commit(pending.id);
    setPhase("done"); onResolved(outcome);
  }
  async function onStop() {
    cancelled.current = true;
    if (timer.current) clearInterval(timer.current);
    const res = await api.confirm(pending.id, "stop");
    setPhase("done"); onResolved(res);
  }

  return (
    <Card className="p-4 border-amber-600/40">
      <div className="font-medium">{c.restaurantName ?? "Your cart"}</div>
      <ul className="text-sm text-muted-foreground my-2">
        {c.lines.map((l, i) => <li key={i}>{l.qty}× {l.name} — ₹{l.priceRupees}</li>)}
      </ul>
      <div className="text-sm">Total <b>₹{c.totalRupees}</b>{c.etaMin ? ` · ETA ${c.etaMin}m` : ""}{c.estimateKcal ? ` · ~${c.estimateKcal} kcal` : ""}</div>
      {phase === "idle" && (
        <div className="flex gap-2 mt-3">
          <Button onClick={onYes}>YES, place it</Button>
          <Button variant="ghost" onClick={() => onResolved({ status: "cancelled" })}>Not now</Button>
        </div>
      )}
      {phase === "grace" && (
        <div className="flex items-center gap-3 mt-3">
          <span className="font-mono tabular-nums">{remaining}s</span>
          <span className="text-sm text-muted-foreground">Placing in {remaining}s…</span>
          <Button variant="destructive" onClick={onStop}>STOP</Button>
        </div>
      )}
      {phase === "committing" && <div className="mt-3 text-sm">Placing your order…</div>}
      <div className="mt-3 text-xs text-muted-foreground">Powered by Swiggy</div>
    </Card>
  );
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Wire into `MessageList`** — for each assistant message part of type `data-gate`, render `<GateCard pending={part.data.pending} onResolved={appendOutcomeMessage}/>`. `appendOutcomeMessage` pushes an assistant bubble: placed → "Order placed ✓ #<id>. Powered by Swiggy."; cancelled → "Cancelled. No order placed."; duplicate/expired/failed → matching copy.
- [ ] **Step 6: Resume on load** — `usePendingActions()` (GET `/api/actions/pending`); if any exist for this user, render their GateCards at the top of the thread so a reload doesn't strand an in-flight confirm.
- [ ] **Step 7: Commit** `git commit -m "feat(F6): gate card with cancellable grace countdown (fixes v1 F1)"`.

**Acceptance:** YES shows a live countdown; STOP cancels with no commit; elapse commits to placed; pending actions resume after reload.

---

### Task F7: Polish — states, errors, reconnect, demo/live cues

**Files:**
- Modify: chat page, layout, `app/connect/page.tsx`; Create: `app/privacy/page.tsx`, `components/EmptyState.tsx`
- Test: `components/chat/reconnect.test.tsx`

- [ ] **Step 1: Stale-token reconnect** — when any `api.*` throws `ApiError{code:"swiggy_stale"|"unauthenticated"}`, route to `/connect` (stale) or `/login` (unauth) with a toast.
- [ ] **Step 2: Demo/live cues** — demo: a persistent "Demo — no real order placed" chip on GateCard + receipts; live: amber styling.
- [ ] **Step 3: Empty/loading/error states** — thread rail skeletons, empty thread placeholder, chat error toast.
- [ ] **Step 4: `app/privacy/page.tsx`** — DPDP page (consent, 30-day TTL, export/delete, minimal PII). `PoweredBySwiggy` in footer site-wide.
- [ ] **Step 5: Test `reconnect.test.tsx`** — a `swiggy_stale` error triggers redirect to `/connect`.
- [ ] **Step 6: Commit** `git commit -m "feat(F7): states, reconnect, demo/live cues, privacy"`.

**Acceptance:** graceful errors; stale token self-heals to /connect; demo/live visually unambiguous.

---

### Task F-INT: Integration with the real backend

- [ ] **Step 1:** Set `NEXT_PUBLIC_API_MOCK=0`; run alongside the backend (`npm run dev`). Log in (real Supabase), connect Swiggy on localhost, browse food, reach a real `data-gate`, run YES→countdown→commit in **demo** → "Order placed demo_…".
- [ ] **Step 2:** Reconcile any drift against `lib/contract/types` (backend owns the contract; report mismatches to Session 1 rather than diverging).
- [ ] **Step 3:** Verify the AI SDK UI stream parsing matches the real backend `toUIMessageStreamResponse()` (the MSW `mockUiStream` is an approximation — the real stream is authoritative).
- [ ] **Step 4: Commit** `git commit -m "chore(F-INT): frontend on real API end-to-end"`.

**Acceptance:** full happy path on the real backend in demo mode, no contract drift.

---

# PHASE P4–P5 — outline (detail after P1–P3 + backend P4–P5)

- **P4 Workflow builder UI:** `app/(app)/workflows/*` — list + create form (name, natural-language prompt,
  surface, trigger picker [manual / cron with a friendly schedule builder / keyword], confirm=async, window).
  "Run now" button. A run-history view reading `workflow_runs`. Async-confirm arrives as a notification + a
  GateCard reachable from a deep link / the pending-actions list (reuses Task F6). **Blocked-by** spec §13
  (confirm-channel priority, email provider) + backend P4.
- **P5 WhatsApp + notifications UI:** number-link flow (enter phone → verify), web-push opt-in (service worker +
  `PushManager`), notification preferences. Reuses the GateCard confirm contract over a deep link. **Blocked-by**
  backend P5 (Gupshup) + template approval.

---

## Self-review (run before handing off)

1. **Spec coverage:** §6 contract → F0/F1 (+ every screen); auth (D6) → F2; chat/threads/memory (§7) → F3/F5;
   connect (D3) + mode (D7) → F4; gate + **2-phase confirm/countdown** (§6.3/§7, fixes F1) → F6; DPDP (§11) → F7.
   P4–P5 (§9/§10) outlined. ✅
2. **Placeholder scan:** none — outlined P4/P5 explicitly deferred with reasons.
3. **Type consistency:** `api.*` returns match `lib/contract/types` (`Me`, `Thread`, `ChatMessage`,
   `PendingAction`, `ConfirmResponse`, `GateOutcome`); `GateCard` consumes `PendingAction` + `confirm`(→grace)/
   `commit`(→`GateOutcome`) exactly as backend B11 implements.

## Cross-session contract rule
`lib/contract/types.ts` is **owned by the backend session**. If the frontend needs a shape change, request it from
Session 1 and let them update the contract — never fork the types. MSW handlers must mirror whatever the contract says.
```
