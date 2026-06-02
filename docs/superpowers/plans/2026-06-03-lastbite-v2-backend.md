# Last Bite v2 — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-tenant Next.js backend — Supabase auth/DB, native Swiggy OAuth + encrypted token vault, a model-agnostic streaming chat loop, and the non-bypassable spending gate across all three Swiggy surfaces.

**Architecture:** Next.js 16 App Router Route Handlers on Vercel (`bom1`). Supabase Postgres is the system of record (RLS per user); Upstash Redis holds ephemeral safety primitives; QStash drives time-based work. Chat is a Vercel AI SDK `streamText` tool-calling loop; the three commit tools (`place_food_order`, `checkout`, `book_table`) are intercepted by `GuardedMcpProxy` which runs the 7-layer spending gate.

**Tech Stack:** Next.js 16, TypeScript, `@supabase/ssr` + `@supabase/supabase-js`, `ai` (Vercel AI SDK 6) + Vercel AI Gateway, `@ai-sdk/mcp`, `@upstash/redis` + `@upstash/qstash`, `zod`, `pg` (migrations via `supabase` CLI), `vitest` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-06-03-lastbite-v2-design.md`. The **API Contract is §6**; the **gate is §7**.

---

## Parallelization & ownership (READ FIRST)

This plan runs in **Session 1 (backend)**, parallel to **Session 2 (frontend)**.

- **Backend owns:** repo scaffold, `lib/contract/*` (shared types + zod), `supabase/migrations/*`, everything under `app/api/*`, `lib/*` (mcp, gate, crypto, redis, gateway, swiggy-oauth, redact, log-context, notifier), `scripts/*`.
- **Frontend owns:** `app/(routes)` pages, `components/*`, `hooks/*`, `lib/supabase/client.ts`, `mocks/*`. It develops against MSW mocks of §6 and **does not import backend internals** — only `lib/contract`.
- **Handoff:** complete **Task B0** (scaffold + contract + env) and push to the shared branch first. The frontend session branches from that commit. After that, both run in parallel; integration happens in **Task B-INT** / **Task F-INT**.
- **Calibration note (honest):** safety-critical and contract code (crypto, gate, MCP proxy, OAuth, migrations/RLS, chat + confirm routes, model gateway) is given as **complete code**. Standard scaffolding (Next/Supabase/shadcn init, simple CRUD route bodies) is given as **exact files + signatures + test cases + commands + acceptance**, not line-by-line, because the steps are mechanical and the contract pins the shapes. No step is left as "TODO".

---

## File structure (backend-owned)

```
lib/contract/types.ts          shared TS types (spec §6.1) — FE imports these
lib/contract/schemas.ts        zod request/response validators per endpoint
lib/env.ts                     typed env access + required-var assertions
lib/log-context.ts             AsyncLocalStorage request-id/user-id (port from v1)
lib/redact.ts                  Bearer/JWT redaction (port from v1)
lib/crypto.ts                  AES-256-GCM + scrypt per-purpose keys (port from v1)
lib/redis.ts                   Upstash client + lock/grace/idem/dedup (port + extend v1)
lib/supabase/server.ts         server client (anon, cookie-bound) via @supabase/ssr
lib/supabase/admin.ts          service-role client (privileged server paths)
lib/swiggy/oauth.ts            OAuth 2.1 + PKCE + DCR + sealed state (port v1 swiggy-oauth.ts)
lib/swiggy/client.ts           per-user SwiggyClient (token from vault) (port + extend v1)
lib/swiggy/vault.ts            get/set/clear encrypted token in Supabase
lib/mcp/guarded-proxy.ts       GuardedMcpProxy — read passthrough + gate on commit tools
lib/gate/gate.ts               7-layer spending gate (L1–L7)
lib/gate/cart.ts               permissive cart → CartSummary (port v1 tryParseCart)
lib/models/gateway.ts          Vercel AI Gateway model resolution + failover
lib/models/catalog.ts          provider/model catalog + toolReliable flags
lib/agent/loop.ts              streamText tool-calling loop wiring tools + proxy
lib/agent/tools.ts             read/cart/track tools + confirmation-required commit tools
lib/notify/notifier.ts         channel-agnostic notify (push/email/whatsapp) — P4/P5
app/api/me/route.ts
app/api/mode/route.ts
app/api/swiggy/connect/start/route.ts
app/api/swiggy/callback/route.ts
app/api/swiggy/disconnect/route.ts
app/api/threads/route.ts
app/api/threads/[id]/route.ts
app/api/chat/route.ts
app/api/actions/pending/route.ts
app/api/actions/[id]/confirm/route.ts     yes→startGrace / stop→cancel
app/api/actions/[id]/commit/route.ts      finalize after grace window
app/api/workflows/route.ts            (P4)
app/api/workflows/[id]/route.ts       (P4)
app/api/workflows/[id]/run/route.ts   (P4)
app/api/cron/workflow-fire/route.ts   (P4)
app/api/cron/action-expire/route.ts   (P4)
app/api/cron/track-poll/route.ts      (P5)
app/api/whatsapp/route.ts             (P5)
supabase/migrations/0001_init.sql     tables + RLS (spec §5.1)
scripts/smoke.ts                       offline gate state-machine smoke (port + generalize v1)
scripts/spike-oauth.ts                 S1/S2 verification
scripts/verify-tool-calling.ts         S3 per-model tool-call CI check
```

---

# PHASE P1 — Foundation

### Task B0: Greenfield scaffold + contract + env (HANDOFF GATE)

**Files:**
- Create: repo root (Next.js), `lib/contract/types.ts`, `lib/contract/schemas.ts`, `lib/env.ts`, `.env.example`, `vitest.config.ts`

- [ ] **Step 1: Scaffold Next.js + deps**

```bash
npx create-next-app@latest . --typescript --app --tailwind --eslint --src-dir=false --import-alias "@/*"
npm i @supabase/ssr @supabase/supabase-js ai @ai-sdk/react @ai-sdk/mcp @upstash/redis @upstash/qstash zod
npm i -D vitest @vitest/coverage-v8 tsx @types/node
```

- [ ] **Step 2: Add `lib/contract/types.ts`** — paste spec §6.1 verbatim (the canonical types). This file is imported by both sessions.

- [ ] **Step 3: Add `lib/contract/schemas.ts`** — zod validators for every request/response in §6.2.

```ts
import { z } from "zod";
export const Surface = z.enum(["food", "instamart", "dineout"]);
export const OrderMode = z.enum(["demo", "live"]);
export const ModeBody = z.object({ mode: OrderMode });
export const ConnectStartBody = z.object({ surface: Surface.optional() });
export const NewThreadBody = z.object({ title: z.string().max(120).optional(), model: z.string(), surface: Surface.nullable().optional() });
export const PatchThreadBody = z.object({ title: z.string().max(120).optional(), model: z.string().optional() });
export const ChatBody = z.object({ threadId: z.string().uuid(), message: z.string().min(1).max(4000), model: z.string() });
export const ConfirmBody = z.object({ decision: z.enum(["yes", "stop"]) });
export const WorkflowTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("cron"), expr: z.string(), tz: z.string() }),
  z.object({ type: z.literal("keyword"), on: z.string().min(1) }),
]);
export const WorkflowBody = z.object({
  name: z.string().min(1).max(80), prompt: z.string().min(1).max(2000),
  surface: Surface, trigger: WorkflowTrigger, confirm: z.literal("async").default("async"),
  windowMinutes: z.number().int().min(5).max(180).default(30), enabled: z.boolean().default(true),
});
```

- [ ] **Step 4: Add `lib/env.ts`** — typed accessors + a `requireEnv(name)` that throws a clear message. Cover: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BYOC_ENCRYPTION_KEY`, `AI_GATEWAY_API_KEY`, `UPSTASH_REDIS_REST_URL/TOKEN`, `QSTASH_TOKEN/CURRENT_SIGNING_KEY/NEXT_SIGNING_KEY`, `LB_REAL_ORDERS`, `SWIGGY_*_MCP_URL`, `LASTBITE_GRACE_SECONDS`, `GUPSHUP_*`, `NEXT_PUBLIC_SITE_URL`.

- [ ] **Step 5: Write `.env.example`** with every var above, grouped + commented. No real values.

- [ ] **Step 6: Commit + push (handoff gate)**

```bash
git add -A && git commit -m "feat(B0): scaffold + shared contract + env"
git push    # frontend session branches from here
```

**Acceptance:** `npm run build` passes; `lib/contract/types.ts` exports every §6.1 type; FE session can import `@/lib/contract/types`.

---

### Task B1: Supabase migration — tables + RLS

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Test: `scripts/rls-test.ts`

- [ ] **Step 1: Write `0001_init.sql`** — all tables from spec §5.1 with constraints, plus RLS:

```sql
-- profiles mirror auth.users
create table profiles ( id uuid primary key references auth.users(id) on delete cascade,
  email text, created_at timestamptz default now() );
alter table profiles enable row level security;
create policy "own profile" on profiles for all using (id = auth.uid()) with check (id = auth.uid());

create table swiggy_connections ( id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null check (surface in ('food','instamart','dineout')),
  ciphertext text, iv text, salt text, scopes text, expires_at timestamptz,
  mode text not null default 'demo' check (mode in ('demo','live')),
  status text not null default 'active' check (status in ('active','stale')),
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(user_id, surface) );
alter table swiggy_connections enable row level security;
create policy "own conn" on swiggy_connections for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- (repeat the same owner-only policy for threads, messages, workflows, workflow_runs, pending_actions, wa_links)
-- audit_log: no client policy → only service role can write/read
create table audit_log ( id bigserial primary key, user_id uuid, request_id text, event text,
  surface text, tool text, decision text, amount_rupees int, order_id text, meta jsonb, created_at timestamptz default now());
alter table audit_log enable row level security;  -- deny-all to anon/auth by omitting policies
```

(Write the remaining tables — `threads, messages, workflows, workflow_runs, pending_actions, wa_links` — exactly per §5.1 with the owner-only policy pattern shown above.)

- [ ] **Step 2: Apply locally**: `supabase db reset` (or `supabase migration up`). Expected: all tables created, no errors.

- [ ] **Step 3: Write `scripts/rls-test.ts`** — using two anon JWTs (user A, user B): A inserts a thread; assert B's client cannot select it; assert service-role can. Run `tsx scripts/rls-test.ts`. Expected: "RLS OK".

- [ ] **Step 4: Commit** `git commit -m "feat(B1): supabase schema + RLS"`.

**Acceptance:** RLS test passes — a row is invisible across users at the DB layer.

---

### Task B2: Port crypto + redact + log-context (TDD)

**Files:**
- Create: `lib/crypto.ts`, `lib/redact.ts`, `lib/log-context.ts`
- Test: `lib/crypto.test.ts`, `lib/redact.test.ts`

- [ ] **Step 1: Write failing test `lib/crypto.test.ts`**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "./crypto";
beforeAll(() => { process.env.BYOC_ENCRYPTION_KEY = "x".repeat(48); });
describe("crypto", () => {
  it("roundtrips", () => { const c = encrypt("eyJsecret"); expect(c).not.toContain("eyJsecret"); expect(decrypt(c)).toBe("eyJsecret"); });
  it("rejects tamper", () => { const c = encrypt("a"); const bad = c.slice(0, -2) + "zz"; expect(() => decrypt(bad)).toThrow(); });
});
```

- [ ] **Step 2: Run** `npx vitest run lib/crypto.test.ts` → FAIL (no module).
- [ ] **Step 3: Implement `lib/crypto.ts`** — port v1 `lib/crypto.ts` verbatim (AES-256-GCM, scrypt label `lastbite-byoc-v1`, envelope `base64(salt·iv·tag·ct)`). Add an exported `deriveKey(label)` so session/oauth-state reuse it.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Port `lib/redact.ts` + `lib/log-context.ts`** verbatim from v1; add `lib/redact.test.ts` asserting `Bearer ey…` and a JWT triple are stripped.
- [ ] **Step 6: Commit** `git commit -m "feat(B2): crypto + redact + log-context (ported, tested)"`.

**Acceptance:** crypto roundtrip + tamper-reject pass; redact strips tokens.

---

### Task B3: Supabase server/admin clients + `/api/me`

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `app/api/me/route.ts`, `lib/http.ts`
- Test: `app/api/me/route.test.ts`

- [ ] **Step 1: `lib/supabase/server.ts`** — `createServerClient` from `@supabase/ssr` bound to Next cookies; export `getUser()` returning `{id,email}` or null.
- [ ] **Step 2: `lib/supabase/admin.ts`** — service-role client (no cookies); used only by privileged paths.
- [ ] **Step 3: `lib/http.ts`** — `json(data, init?)`, `apiError(code, message, status)`, and `withAuth(handler)` wrapping a route to inject `user` or return `401 {code:"unauthenticated"}`. Also `withLogContext` (request-id).
- [ ] **Step 4: Write failing test** `app/api/me/route.test.ts` — mock no session → expect 401; mock session → expect `Me` shape (connected:false, models non-empty).
- [ ] **Step 5: Implement `app/api/me/route.ts`** — read user; read `swiggy_connections`; build `Me` (spec §6.1) with `realOrdersAvailable = env.LB_REAL_ORDERS==="1"`, `models = catalog()` (Task B7 may stub initially), `defaultAgenticModel`.
- [ ] **Step 6: Run tests → PASS. Commit** `git commit -m "feat(B3): supabase clients + /api/me"`.

**Acceptance:** unauth → 401; auth → valid `Me`.

---

### Task B4: Swiggy OAuth connect + callback + vault (S1/S2 spike inside)

**Files:**
- Create: `lib/swiggy/oauth.ts`, `lib/swiggy/vault.ts`, `app/api/swiggy/connect/start/route.ts`, `app/api/swiggy/callback/route.ts`, `app/api/swiggy/disconnect/route.ts`, `scripts/spike-oauth.ts`
- Test: `lib/swiggy/oauth.test.ts`, `lib/swiggy/vault.test.ts`

- [ ] **Step 1: Port `lib/swiggy/oauth.ts`** from v1 `lib/swiggy-oauth.ts` (PKCE `makePkce`, `registerClient` DCR, `buildAuthorizationUrl`, `exchangeAuthorizationCode`, sealed-cookie state via `crypto.deriveKey("lastbite-oauth-state-v1")`). Keep `siteUrl()`/`callbackUri()`.
- [ ] **Step 2: TDD `lib/swiggy/vault.ts`** — write `lib/swiggy/vault.test.ts` first: `setToken(userId, surface, tokens)` then `getToken(userId, surface)` returns plaintext; ciphertext column never equals plaintext. Implement using `admin` client + `crypto.encrypt/decrypt`; store `iv/salt`; set `mode` default demo. Run → PASS.
- [ ] **Step 3: `connect/start/route.ts`** — `withAuth`; build PKCE+state, set state cookie, return `{authorizeUrl}` (spec §6.2). Test: returns a URL containing `code_challenge` + `state`.
- [ ] **Step 4: `callback/route.ts`** — verify state nonce, exchange code+verifier, `vault.setToken`, 303 redirect to `/connect/success`. On any failure `bounce(reason)` with `safeLog`. (Port v1 callback structure.)
- [ ] **Step 5: `disconnect/route.ts`** — delete the connection row.
- [ ] **Step 6: Spike S1/S2** — `scripts/spike-oauth.ts`: run two separate OAuth flows (two Swiggy logins) under the same registered `client_id`; assert both tokens work for `get_addresses`; force a near-expiry refresh and confirm rotation. **Write the outcome into a comment block at the top of the script** and into the spec's §3.1. If multi-tenant fails, STOP and escalate (architecture impact).
- [ ] **Step 7: Commit** `git commit -m "feat(B4): native Swiggy OAuth + encrypted vault + S1/S2 spike"`.

**Acceptance:** OAuth connect→callback stores an encrypted token; spike note recorded; multi-tenant confirmed (or escalated).

---

# PHASE P2 — Chat + models

### Task B5: Per-user SwiggyClient + cart parser (TDD)

**Files:**
- Create: `lib/swiggy/client.ts`, `lib/gate/cart.ts`
- Test: `lib/gate/cart.test.ts`, `lib/swiggy/client.test.ts`

- [ ] **Step 1: Port `lib/swiggy/client.ts`** from v1 `lib/mcp/swiggy-client.ts` — `createMCPClient` HTTP transport with `Authorization: Bearer <token>`; `callTool` with `unwrapMcpResult`; `SwiggyMcpError.kind` classifier (auth/rate-limit/not-found/address-stale/other); constructor takes `{token, surface, url}`; `surface→url` from env. Token comes from `vault.getToken` at construction in the route, never logged.
- [ ] **Step 2: TDD `lib/gate/cart.ts`** — port v1 `tryParseCart` as `parseCart(raw, hints): CartSummary | null`. Test against the captured fixture `fixtures/swiggy/food/get_food_cart.json` (copy from v1) → returns lines + totals; empty → null. Run → PASS.
- [ ] **Step 3: `client.test.ts`** — feed a synthetic `isError:true` envelope → throws `SwiggyMcpError` with `kind:"auth"` on a `401` body; `\b401\b` word-boundary so "4015 bytes" is not auth.
- [ ] **Step 4: Commit** `git commit -m "feat(B5): per-user SwiggyClient + cart parser"`.

**Acceptance:** cart parser handles real fixture; error classifier word-boundary-correct.

---

### Task B6: Model gateway + catalog + tool-call verification (S3)

**Files:**
- Create: `lib/models/catalog.ts`, `lib/models/gateway.ts`, `scripts/verify-tool-calling.ts`
- Test: `lib/models/catalog.test.ts`

- [ ] **Step 1: `lib/models/catalog.ts`** — export `catalog(): ModelOption[]` — curated `creator/model` ids grouped by provider (Anthropic, Google, xAI, DeepSeek, OpenAI, Mistral, Groq, OpenRouter long-tail). Each has `toolReliable` (default true; set false for any flagged by S3). Export `defaultAgenticModel` (a verified tool-reliable id) and `isToolReliable(id)`.
- [ ] **Step 2: `lib/models/gateway.ts`** — `resolveModel(id)` returns the AI SDK model via Vercel AI Gateway (`gateway(id)` / `"creator/model"` string form). `withFailover(primaryId)` returns `{ model, fallback }`; retry only on 429/quota.
- [ ] **Step 3: Test `catalog.test.ts`** — every model id matches `^[a-z0-9-]+\/[a-z0-9.\-:]+$`; `defaultAgenticModel` is `toolReliable`.
- [ ] **Step 4: `scripts/verify-tool-calling.ts` (S3)** — for each catalog model, run a trivial `generateText` with one dummy tool and assert a well-formed tool call. Print a table; models that fail get `toolReliable:false` in the catalog. Wire as `npm run verify:models`.
- [ ] **Step 5: Commit** `git commit -m "feat(B6): model gateway + catalog + S3 tool-call verifier"`.

**Acceptance:** catalog validates; verifier marks unreliable models chat-only.

---

### Task B7: Threads + messages CRUD

**Files:**
- Create: `app/api/threads/route.ts`, `app/api/threads/[id]/route.ts`
- Test: `app/api/threads/route.test.ts`

- [ ] **Step 1: Failing tests** — create thread → returns `Thread`; list returns it; get includes messages; rename patches title; delete removes; cross-user get → 404 (RLS).
- [ ] **Step 2: Implement** both route files using `supabase/server` (RLS enforces ownership). Validate bodies with `contract/schemas`. Pin model: if `surface` set and model not `isToolReliable`, override to `defaultAgenticModel` (spec §8).
- [ ] **Step 3: Run → PASS. Commit** `git commit -m "feat(B7): threads + messages CRUD"`.

**Acceptance:** CRUD works; agentic-model pinning enforced; RLS blocks cross-user.

---

### Task B8: Chat streaming loop (food read/cart tools, no commit yet)

**Files:**
- Create: `lib/agent/tools.ts`, `lib/agent/loop.ts`, `app/api/chat/route.ts`
- Test: `lib/agent/loop.test.ts`

- [ ] **Step 1: `lib/agent/tools.ts`** — build the AI SDK `ToolSet` from a `SwiggyClient`: read/cart/track tools (`get_addresses`, `search_restaurants`, `search_menu`, `get_restaurant_menu`, `get_food_cart`, `update_food_cart`, `track_food_order`, coupons) each with a zod `inputSchema` and `execute` → `client.callTool`. Commit tools added in Task B9 (confirmation-required).
- [ ] **Step 2: `lib/agent/loop.ts`** — `runChat({ user, thread, message, modelId })`: load thread message history from Supabase (rolling window), resolve model via gateway, `streamText({ model, tools, messages, stopWhen: stepCountIs(8) })`, persist the user message + assistant result to `messages`. Return the stream.
- [ ] **Step 3: `app/api/chat/route.ts`** — `withAuth`; validate `ChatBody`; construct `SwiggyClient` from `vault.getToken`; `runChat(...)`; return `result.toUIMessageStreamResponse()`. On Swiggy `auth` error → mark connection `stale` + surface `needsReconnect`.
- [ ] **Step 4: Test `loop.test.ts`** — with a mock model that emits a `search_restaurants` tool call and a mock `SwiggyClient`, assert the tool executes and the assistant message persists.
- [ ] **Step 5: Commit** `git commit -m "feat(B8): streaming chat loop over food read/cart tools"`.

**Acceptance:** multi-turn chat browses restaurants/menu/cart for a connected user; history persists.

---

# PHASE P3 — The Spending Gate

### Task B9: Redis safety primitives (TDD, port + extend v1)

**Files:**
- Create: `lib/redis.ts`
- Test: `lib/redis.test.ts` (uses the in-memory shim)

- [ ] **Step 1: Port v1 `lib/redis.ts`** — `redis()` (Upstash + in-memory shim when `LASTBITE_OFFLINE=1`), `acquireUserLock/releaseUserLock` (180s, compare-and-delete), `startGraceTimer/cancelGrace/isGraceActive`, **`isGraceCancelled(ref)` = `get === "cancelled"`** (used by the 2-phase commit; Redis read error must propagate so the caller can abort), `consumeIdempotency/releaseIdempotency`, `makeIdempotencyKey`, `hashCart`, `todayUTC`, `claimMessageId`. (v1's blocking `awaitGrace` is dropped — grace is now 2-phase.)
- [ ] **Step 2: Tests** — lock excludes a second acquirer; `awaitGrace` returns `cancelled` after `cancelGrace`; `consumeIdempotency` true then false for same key; 5 consecutive get-failures → `cancelled`.
- [ ] **Step 3: Commit** `git commit -m "feat(B9): redis safety primitives (ported, tested)"`.

**Acceptance:** all safety-primitive tests pass.

---

### Task B10: The Spending Gate (TDD — core safety)

**Files:**
- Create: `lib/gate/gate.ts`
- Test: `lib/gate/gate.test.ts`

- [ ] **Step 1: Write failing tests** covering L1–L7 (these are the safety contract):

```ts
// pseudocode of assertions — implement against the real signature below
// 1 L1: LB_REAL_ORDERS unset → evaluateGate returns {status:"demo"} and NEVER calls execute
// 2 L2: mode="demo" → demo result, no execute
// 3 L3: food cart >= 1000 → {status:"blocked", reason:/below ₹1000/}
// 4 L4: evaluateGate returns {status:"pending", actionId} + writes a pending_action; no execute
// 5 startGrace(actionId) → {status:"grace", graceSeconds}; execute NOT called
// 6 commitGate after startGrace (not cancelled) → idempotency consume → execute → {status:"placed", orderId}
// 7 cancelGate then commitGate → {status:"cancelled"}, execute NOT called
// 8 L6: commitGate twice same cart/day → 2nd {status:"duplicate"}, execute called once
// 9 commit-time isGraceCancelled throws (redis down) → {status:"failed","grace-state-unavailable"}, no execute
// 10 L7: audit_log rows written for evaluate + commit outcome
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `lib/gate/gate.ts`:**

```ts
import { admin } from "@/lib/supabase/admin";
import { acquireUserLock, releaseUserLock, startGraceTimer, cancelGrace, isGraceCancelled,
  consumeIdempotency, releaseIdempotency, makeIdempotencyKey, hashCart, todayUTC } from "@/lib/redis";
import { env } from "@/lib/env";
import { safeLog } from "@/lib/redact";
import type { CartSummary, Surface } from "@/lib/contract/types";

const COMMIT = { food: "place_food_order", instamart: "checkout", dineout: "book_table" } as const;
const FOOD_CAP = 1000;

export interface GateCtx { userId: string; requestId: string; mode: "demo" | "live"; surface: Surface;
  cart: CartSummary; execute: () => Promise<unknown>; threadId?: string; workflowRunId?: string; channel?: string; }

async function audit(ctx: GateCtx, event: string, decision: string, extra: Record<string, unknown> = {}) {
  await admin().from("audit_log").insert({ user_id: ctx.userId, request_id: ctx.requestId, event,
    surface: ctx.surface, tool: COMMIT[ctx.surface], decision, amount_rupees: ctx.cart.totalRupees, meta: extra });
}

/** L1–L4: evaluate up to the confirmation boundary. Returns a demo/blocked outcome, or a pending action id. */
export async function evaluateGate(ctx: GateCtx) {
  if (env.LB_REAL_ORDERS !== "1") { await audit(ctx, "evaluate", "demo:env"); return { status: "demo" as const, orderId: `demo_${Date.now().toString(36)}` }; }
  if (ctx.mode !== "live") { await audit(ctx, "evaluate", "demo:mode"); return { status: "demo" as const, orderId: `demo_${Date.now().toString(36)}` }; }
  if (ctx.surface === "food" && ctx.cart.totalRupees >= FOOD_CAP) {
    await audit(ctx, "evaluate", "blocked:cap");
    return { status: "blocked" as const, reason: `Cart ₹${ctx.cart.totalRupees}; Swiggy caps beta food orders below ₹${FOOD_CAP}.` };
  }
  const { data, error } = await admin().from("pending_actions").insert({
    user_id: ctx.userId, thread_id: ctx.threadId ?? null, workflow_run_id: ctx.workflowRunId ?? null,
    surface: ctx.surface, tool: COMMIT[ctx.surface], cart: ctx.cart, args: {}, channel: ctx.channel ?? "chat",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  }).select("id").single();
  if (error) throw error;
  await audit(ctx, "evaluate", "pending", { actionId: data.id });
  return { status: "pending" as const, actionId: data.id };
}

/** L5 phase A — YES accepted: open the cooling window, return immediately (non-blocking). No lock held. */
export async function startGrace(actionId: string) {
  const seconds = Number(process.env.LASTBITE_GRACE_SECONDS) || 30;
  await startGraceTimer(actionId, seconds);
  return { status: "grace" as const, graceSeconds: seconds, actionId };
}

/** L5 STOP — cancel during the cooling window. Cheap; no lock contention (fixes v1 F1). */
export async function cancelGate(ctx: GateCtx, actionId: string) {
  await cancelGrace(actionId); await markAction(actionId, "cancelled"); await audit(ctx, "confirm", "stop");
  return { status: "cancelled" as const };
}

/** L5 phase B + L6/L7 — finalize after the window: lock → grace-not-cancelled → idempotency → execute. */
export async function commitGate(ctx: GateCtx, actionId: string) {
  const lock = await acquireUserLock(ctx.userId);
  if (!lock) return { status: "failed" as const, reason: "busy" };
  try {
    let cancelled: boolean;
    try { cancelled = await isGraceCancelled(actionId); }
    catch { await audit(ctx, "commit", "grace-state-unavailable"); return { status: "failed" as const, reason: "grace-state-unavailable" }; } // Redis error → do NOT commit
    if (cancelled) { await markAction(actionId, "cancelled"); await audit(ctx, "commit", "grace-stop"); return { status: "cancelled" as const }; }
    const idem = makeIdempotencyKey(ctx.userId, hashCart(ctx.cart), todayUTC());
    if (!(await consumeIdempotency(idem))) { await markAction(actionId, "confirmed"); await audit(ctx, "commit", "duplicate"); return { status: "duplicate" as const }; }
    try {
      const result = await ctx.execute();
      await markAction(actionId, "confirmed");
      const orderId = extractOrderId(result);
      await audit(ctx, "commit", "placed", { orderId });
      return { status: "placed" as const, orderId };
    } catch (err) {
      await releaseIdempotency(idem);
      await audit(ctx, "commit", "failed", { message: (err as Error).message });
      return { status: "failed" as const, reason: (err as Error).message.split("\n")[0] };
    }
  } finally { await releaseUserLock(ctx.userId, lock); }
}

async function markAction(id: string, status: string) { await admin().from("pending_actions").update({ status }).eq("id", id); }
export function extractOrderId(r: unknown): string { /* port v1 extractOrderId */ return "unknown"; }
```

- [ ] **Step 4: Implement `extractOrderId`** by porting v1 `graph.ts:extractOrderId` (plain-text `Order \d{10,20}` + JSON `order_id/orderId/id/data.order_id`).
- [ ] **Step 5: Run → PASS** (use the offline redis shim + a stub `execute`/admin).
- [ ] **Step 6: Commit** `git commit -m "feat(B10): spending gate L1–L7 (TDD)"`.

**Acceptance:** all gate assertions pass; `execute` is called exactly once on a committed non-duplicate, never on demo / blocked / stop / grace-cancelled / grace-state-unavailable.

---

### Task B11: GuardedMcpProxy + confirmation-required commit tools + confirm route

**Files:**
- Create: `lib/mcp/guarded-proxy.ts`, `app/api/actions/pending/route.ts`, `app/api/actions/[id]/confirm/route.ts`, `app/api/actions/[id]/commit/route.ts`
- Modify: `lib/agent/tools.ts` (add commit tools), `app/api/chat/route.ts` (emit `data-gate`)
- Test: `lib/mcp/guarded-proxy.test.ts`

- [ ] **Step 1: `lib/mcp/guarded-proxy.ts`** — `GuardedMcpProxy` wraps a `SwiggyClient`. `call(tool, args, ctx)`: if `tool` ∉ commit set → passthrough `client.callTool`. If commit → build `CartSummary` (read cart first), call `evaluateGate({... execute: () => client.callTool(tool, args)})`, return the gate result.
- [ ] **Step 2: Add commit tools to `lib/agent/tools.ts`** as **confirmation-required** (server execute returns the gate result; when `pending`, the loop emits a `data-gate` part with the `PendingAction` and stops the turn).
- [ ] **Step 3: `app/api/chat/route.ts`** — on a `pending` gate result inside the stream, write `data-gate {actionId, pending}` and end the assistant turn.
- [ ] **Step 4: confirm + commit routes** — `actions/[id]/confirm/route.ts`: `withAuth`; load `pending_action` (RLS owner-only); `yes` → `startGrace(actionId)` → `ConfirmResponse {grace}`; `stop` → `cancelGate(ctx, actionId)` → `{cancelled}`. `actions/[id]/commit/route.ts`: `withAuth`; rebuild `GateCtx` (`SwiggyClient` + `execute`); call `commitGate(ctx, actionId)` → `GateOutcome`. `actions/pending/route.ts`: list the user's `pending` actions (for resume-on-load).
- [ ] **Step 5: Test** — (live env+mode, stubbed execute) model calls `place_food_order` → stream contains `data-gate {actionId}`; `confirm {yes}` → `{status:"grace", graceSeconds}`; `commit` → `{status:"placed", orderId}`; `confirm {stop}` then `commit` → `{status:"cancelled"}`. Demo mode → no gate card; `evaluateGate` returns `{status:"demo"}` inline.
- [ ] **Step 6: Commit** `git commit -m "feat(B11): guarded MCP proxy + commit tools + confirm route"`.

**Acceptance:** a commit tool never executes inline; it always routes through a `pending_action` + explicit confirm.

---

### Task B12: Mode toggle + generalize to instamart/dineout + smoke

**Files:**
- Create: `app/api/mode/route.ts`, `scripts/smoke.ts`
- Modify: `lib/agent/tools.ts`, `lib/mcp/guarded-proxy.ts` (instamart `checkout`, dineout `book_table`)
- Test: `scripts/smoke.ts` (8 scenarios)

- [ ] **Step 1: `app/api/mode/route.ts`** — `withAuth`; set `swiggy_connections.mode`; return effective mode (ANDed with `LB_REAL_ORDERS`). (Spec D7.)
- [ ] **Step 2: Add instamart cart/checkout + dineout slots/book tools** to `tools.ts`; register `checkout`/`book_table` as commit tools in the proxy with surface-appropriate guardrails (dineout = free booking, no ₹ cap; instamart = COD).
- [ ] **Step 3: Port + generalize `scripts/smoke.ts`** from v1 — offline (`LASTBITE_OFFLINE=1`), fixtures, no LLM. 8 scenarios: happy path (demo) for **each surface**, STOP-at-gate, idempotency duplicate, grace-cancel, mutex concurrency, async pending→expire.
- [ ] **Step 4: Run** `npm run smoke` → PASS (exit 0).
- [ ] **Step 5: Commit** `git commit -m "feat(B12): mode toggle + 3-surface gate + smoke green"`.

**Acceptance:** smoke green across all three commit tools incl. STOP + idempotency.

---

### Task B-INT: Integration with frontend

- [ ] **Step 1:** Run the FE against the real API (not MSW): `npm run dev`, log in, connect Swiggy (localhost), browse, reach a gate card, confirm in demo → `placed demo_…`.
- [ ] **Step 2:** Fix any contract drift; if a shape changes, update `lib/contract/*` **and** notify the FE session (the contract is the single source of truth).
- [ ] **Step 3: Commit** `git commit -m "chore(B-INT): backend↔frontend contract verified end-to-end"`.

---

# PHASE P4–P5 — outline (detail after P1–P3 + spikes)

Detailed TDD tasks are written **after** P1–P3 lands and S1–S4 are resolved, so we don't encode guesses about
spike outcomes or the open items in spec §13.

- **P4 Workflows:** `workflows` CRUD routes; `lib/notify/notifier.ts` (push + email); QStash schedule create/delete
  on workflow save; `cron/workflow-fire` (run saved prompt → gate async → `pending_action` + notify);
  `cron/action-expire` (expire + notify). Tests: a fired workflow reaches `awaiting_confirm` and never places
  without YES; expiry path. **Blocked-by open items:** email provider, confirm-channel priority (spec §13).
- **P5 WhatsApp:** port + adapt v1 `lib/whatsapp/gupshup.ts` + `app/api/whatsapp/route.ts`; outbound utility
  templates; inbound YES/STOP/keyword → confirm/workflow; `wa_links` verification; `cron/track-poll` adaptive
  polling. Compliance: 24h window + approved templates; webhook fail-closed in prod; inbound dedup.

---

## Self-review (run before handing off)

1. **Spec coverage:** §5 schema → B1; §6 contract → B3/B7/B8/B11/B12; §7 gate → B10/B11; §8 models → B6; §11 security → B2/B4/B10; §3.1 spikes → B4(S1/S2)/B6(S3). P4–P5 (§9/§10) outlined. ✅
2. **Placeholder scan:** none — outlined P4/P5 are explicitly deferred with reasons, not hidden TODOs.
3. **Type consistency:** `evaluateGate`/`confirmGate`/`GateCtx`, `GateOutcome`, `PendingAction`, catalog `ModelOption` match spec §6.1 names.
```
