# Last Bite v2 — Design Spec

> Source of truth for the v2 rebuild. The visual HLD is `architecture-hld.html`; the v1 analysis is
> `deepanalysis.html`. This spec is what the implementation plans
> (`docs/superpowers/plans/2026-06-03-lastbite-v2-backend.md` and `…-frontend.md`) are built from.
> The **API Contract (§6)** is the boundary the frontend and backend sessions code against independently.

**Status:** approved design, pre-implementation. **Date:** 2026-06-03.

---

## 1. Goal & wedge

A cloud-first, multi-tenant, **multi-model** AI chat web app that connects to Swiggy's three MCP surfaces
(Food, Instamart, Dineout) over native OAuth per user, persists conversations, and lets users save
**prompt-workflows that fire on a trigger** — all wrapped in a **non-bypassable spending gate** for the
three irreversible commit tools.

Wedge vs. using Swiggy MCP inside Claude/ChatGPT directly: **persistent threads + choice of model +
self-triggering workflows + a safety layer for irreversible COD spend** that generic assistants don't provide.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | Model gateway | **Vercel AI Gateway** (`creator/model` strings, operator-held keys, fallback + spend telemetry) |
| D2 | Scheduled-order safety | **Async-confirm**: a trigger builds the cart + notifies; places only on explicit human YES inside a window |
| D3 | Accounts + token vault | **Supabase Auth** + Swiggy tokens **AES-256-GCM at rest in Postgres, RLS-isolated** |
| D4 | WhatsApp | **Gupshup BSP**, notify + trigger only (24h window + approved templates) |
| D5 | Repo strategy | **Greenfield** Next.js + Supabase; port v1 safety/OAuth/redaction logic |
| D6 | Sign-in | **Google + Email magic-link** (Supabase Auth); phone collected only at WhatsApp-link time |
| D7 | Live orders | **Self-serve per-user demo→live toggle** (default demo) **under a global `LB_REAL_ORDERS` operator master kill-switch** |
| D8 | Model catalog | **Full OpenClaw-style** (Anthropic, Google, xAI, DeepSeek, OpenAI, Mistral, Groq + OpenRouter meta-provider). Agentic threads pinned to a tool-reliable model |

**D7 reconciliation (safety):** any user may toggle their connection to `live`, but a real order also requires
`LB_REAL_ORDERS=1` on the deployment. Public deploys keep the master **off** until Swiggy grants prod
credentials, so pre-approval everyone is effectively demo even after toggling. The toggle becomes real once
the operator flips the master (or on localhost for the developer's own account).

---

## 3. Swiggy MCP constraints (design drivers — not changeable by us)

- **OAuth 2.1 + PKCE** per user; bearer token = identity; auth auto-handled by the server.
- **COD only · orders cannot be cancelled.** Food cart **< ₹1000** (beta). Dineout = **free bookings only**.
- **No webhooks · no idempotency guarantee · no documented rate limits.** Tracking is **poll-only**.
- "**Keep the Swiggy app closed**" — concurrent app session can conflict.
- Production for a 3rd-party webapp is **approval-gated** (Builders Club): localhost dev needs no approval;
  prod requires an application + demo video and a whitelisted redirect URI.
- Commit tools (the only ones that spend/commit): **`place_food_order`** (food), **`checkout`** (instamart),
  **`book_table`** (dineout). Everything else is read/cart/track → passes the gate untouched.

### 3.1 Empirical spikes (verify in P1 — do NOT assume)
- **S1** Many end-users under one registered `client_id` (multi-tenant OAuth). Expectation: works like Claude/ChatGPT.
- **S2** Token lifetime + `refresh_token` rotation against `mcp.swiggy.com/auth/token` (v1 saw ~24h).
- **S3** Per-model MCP tool-calling reliability (research flagged Gemini dropping tool-call blocks on some gateways).
- **S4** "Keep app closed" conflict impact on our MCP calls.

Each spike has a task in the backend plan and a written outcome note before dependent work proceeds.

---

## 4. Architecture

Five layers (full diagram in `architecture-hld.html`):

1. **Surfaces** — web chat (primary), WhatsApp (Gupshup, notify+trigger), scheduler (QStash cron).
2. **Application** (Next.js App Router on Vercel, region `bom1`, Fluid Compute) — Supabase Auth, chat
   orchestrator (streaming tool-calling loop), workflow engine, notifier.
3. **Model layer** — Vercel AI Gateway; agentic threads pinned to a tool-reliable model; per-model tool-call verification.
4. **Guarded MCP layer** — per-user `SwiggyClient` (token from vault) + **Spending Gate interceptor** wrapping the 3 commit tools.
5. **Data** — Supabase Postgres (system of record, RLS) + Upstash Redis (ephemeral safety primitives) + QStash (time-based).

**Key structural rule:** the spending gate lives in the MCP proxy, **below the model and independent of channel** —
so no model, prompt, or surface can place an order without passing it.

### 4.1 Agent loop
Chat = a streaming **tool-calling loop** (Vercel AI SDK `streamText`, no LangGraph). The model is given the
read/cart/track Swiggy tools as normal callable tools. The 3 commit tools are registered as
**confirmation-required** tools: the server intercepts the call, does **not** execute, creates a
`pending_action`, and emits a gate event. The turn pauses. Resolution (sync via chat card, or async via
notifier) calls the confirm endpoint, which runs grace → idempotency → execute.

---

## 5. Data model

### 5.1 Supabase Postgres (every user-owned table has RLS: `user_id = auth.uid()`)

```
profiles            (id uuid pk = auth.users.id, email text, created_at timestamptz)
swiggy_connections  (id uuid pk, user_id uuid fk, surface text check in (food,instamart,dineout),
                     ciphertext text, iv text, salt text, scopes text, expires_at timestamptz,
                     mode text default 'demo' check in (demo,live), status text default 'active'
                       check in (active,stale), created_at, updated_at,
                     unique(user_id, surface))
threads             (id uuid pk, user_id uuid fk, title text, model text, surface text null,
                     created_at, updated_at)
messages            (id uuid pk, thread_id uuid fk, user_id uuid fk,
                     role text check in (user,assistant,tool,system), content jsonb, created_at)
workflows           (id uuid pk, user_id uuid fk, name text, prompt text, surface text,
                     trigger jsonb, confirm text default 'async', window_minutes int default 30,
                     enabled bool default true, qstash_schedule_id text null, created_at, updated_at)
workflow_runs       (id uuid pk, workflow_id uuid fk, user_id uuid fk,
                     status text check in (queued,building,awaiting_confirm,placed,cancelled,expired,failed),
                     cart jsonb, pending_action_id uuid null, error text null, started_at, finished_at)
pending_actions     (id uuid pk, user_id uuid fk, thread_id uuid null, workflow_run_id uuid null,
                     surface text, tool text, args jsonb, cart jsonb,
                     status text default 'pending' check in (pending,confirmed,cancelled,expired),
                     channel text, expires_at timestamptz, created_at)
audit_log           (id bigserial pk, user_id uuid, request_id text, event text, surface text,
                     tool text, decision text, amount_rupees int null, order_id text null,
                     meta jsonb, created_at)        -- append-only; no update/delete grant
wa_links            (id uuid pk, user_id uuid fk, phone text, verified bool default false, created_at,
                     unique(phone))
```

RLS: `profiles, swiggy_connections, threads, messages, workflows, workflow_runs, pending_actions, wa_links`
→ owner-only (`user_id = auth.uid()`). `audit_log` → insert-only via service role; no client read.
Server-side privileged paths (cron, gate execution) use the **service-role key** and pass `user_id` explicitly.

### 5.2 Upstash Redis (ephemeral)

| Key | TTL | Purpose |
|---|---|---|
| `lock:user:<userId>` | 180s | per-user mutex (random token, compare-and-delete release) |
| `grace:<actionId>` | grace+5s | 30s STOP window (`pending`/`cancelled`) |
| `idem:<sha256(userId·cartHash·dayUTC)>` | 24h | dedup the commit |
| `msg:<waMessageId>` | 24h | WhatsApp inbound dedup |
| `rl:<scope>:<key>` | sliding | rate limits |

### 5.3 QStash
Per-workflow cron schedule; delayed message = async-confirm expiry; recurring tracking poll (adaptive
backoff, stop on terminal). All cron callbacks verify the QStash signature.

---

## 6. API Contract (the FE ↔ BE boundary)

All routes are Next.js Route Handlers under `/api`. Auth: Supabase session cookie (verified server-side via
`@supabase/ssr`); unauthenticated → `401 {error, code:"unauthenticated"}`. All bodies are JSON. All errors use
the **ApiError** shape. The frontend develops against a **mock** of exactly these contracts (MSW) so it never
blocks on the backend.

### 6.1 Shared types (canonical — both sides implement `lib/contract/types.ts` to match)

```ts
export type Surface = "food" | "instamart" | "dineout";
export type OrderMode = "demo" | "live";

export interface ApiError { error: string; code: string; details?: unknown; }

export interface ModelOption { id: string; label: string; provider: string; toolReliable: boolean; }

export interface Me {
  user: { id: string; email: string };
  swiggy: { connected: boolean; surfaces: Surface[]; mode: OrderMode; status: "active" | "stale" | "none" };
  realOrdersAvailable: boolean;          // global LB_REAL_ORDERS
  models: ModelOption[];
  defaultAgenticModel: string;           // pinned tool-reliable model id
}

export interface Thread { id: string; title: string; model: string; surface: Surface | null; updatedAt: string; }
export interface ChatMessage {
  id: string; role: "user" | "assistant" | "tool" | "system";
  content: unknown;                      // AI SDK UIMessage parts; text + tool parts
  createdAt: string;
}

export interface CartLine { name: string; qty: number; priceRupees: number; }
export interface CartSummary {
  restaurantName?: string; lines: CartLine[];
  subtotalRupees: number; deliveryRupees: number; totalRupees: number;
  etaMin?: number; estimateKcal?: number;
}

export interface PendingAction {
  id: string; surface: Surface; tool: "place_food_order" | "checkout" | "book_table";
  cart: CartSummary; expiresAt: string; origin: "chat" | "workflow";
}

export type GateOutcome =
  | { status: "placed"; orderId: string }
  | { status: "cancelled" }
  | { status: "duplicate" }
  | { status: "expired" }
  | { status: "failed"; reason: string };

// 2-phase confirm (fixes v1 F1: web grace is now cancellable).
export type ConfirmResponse =
  | { status: "grace"; graceSeconds: number; actionId: string }   // YES accepted; cooling window open
  | { status: "cancelled" };                                       // STOP

export interface Workflow {
  id: string; name: string; prompt: string; surface: Surface;
  trigger: { type: "manual" } | { type: "cron"; expr: string; tz: string } | { type: "keyword"; on: string };
  confirm: "async"; windowMinutes: number; enabled: boolean;
}
```

### 6.2 Endpoints

| Method · Path | Auth | Body / Query | Returns |
|---|---|---|---|
| `GET /api/me` | session | — | `Me` |
| `POST /api/mode` | session | `{mode: OrderMode}` | `{mode, effectiveMode, realOrdersAvailable}` |
| `POST /api/swiggy/connect/start` | session | `{surface?: Surface}` | `{authorizeUrl}` (sets PKCE state cookie) |
| `GET /api/swiggy/callback` | session | `?code&state` | 303 redirect to `/connect/success` or `/connect?error=` |
| `POST /api/swiggy/disconnect` | session | `{surface?}` | `{ok:true}` |
| `GET /api/threads` | session | — | `Thread[]` |
| `POST /api/threads` | session | `{title?, model, surface?}` | `Thread` |
| `GET /api/threads/:id` | session | — | `{thread: Thread, messages: ChatMessage[]}` |
| `PATCH /api/threads/:id` | session | `{title?, model?}` | `Thread` |
| `DELETE /api/threads/:id` | session | — | `{ok:true}` |
| `POST /api/chat` | session | `{threadId, message: string, model: string}` | **AI SDK UI message stream** (see §6.3) |
| `GET /api/actions/pending` | session | — | `PendingAction[]` |
| `POST /api/actions/:id/confirm` | session | `{decision: "yes"\|"stop"}` | `ConfirmResponse` — yes→opens grace (non-blocking); stop→cancelled |
| `POST /api/actions/:id/commit` | session | — | `GateOutcome` — finalize after the grace window (idempotency + execute) |
| `GET /api/workflows` | session | — | `Workflow[]` |
| `POST /api/workflows` | session | `Workflow`(no id) | `Workflow` |
| `PATCH /api/workflows/:id` | session | `Partial<Workflow>` | `Workflow` |
| `DELETE /api/workflows/:id` | session | — | `{ok:true}` |
| `POST /api/workflows/:id/run` | session | — | `{runId}` |
| `POST /api/whatsapp` | Gupshup secret | Gupshup payload | `{ok:true}` |
| `POST /api/cron/workflow-fire` | QStash sig | `{workflowId}` | `{ok:true}` |
| `POST /api/cron/action-expire` | QStash sig | `{actionId}` | `{ok:true}` |
| `POST /api/cron/track-poll` | QStash sig | `{orderRef}` | `{ok:true}` |

### 6.3 Chat streaming format
`POST /api/chat` returns a Vercel **AI SDK UI message stream** (`toUIMessageStreamResponse()`), consumed by
`useChat` (`@ai-sdk/react`). Read/cart/track tool calls stream as normal tool parts. When the model calls a
**commit tool**, the server emits a custom data part:

```
data-gate: { actionId: string, pending: PendingAction }
```

…and ends the assistant turn (no execution yet). The client renders a gate card from `pending`, then calls
`POST /api/actions/:id/confirm {yes}` → the server opens the grace window and returns
`{status:"grace", graceSeconds}` **immediately (non-blocking)**. The client renders a **visible countdown with a
STOP button** (this fixes v1's F1 — STOP during grace was web-uncancellable). STOP → `confirm {stop}` → cancelled.
When the countdown elapses, the client calls `POST /api/actions/:id/commit` → the server runs idempotency +
execute and returns a `GateOutcome`; the client appends an assistant/system message (ending "Powered by Swiggy.").

---

## 7. The Spending Gate (generalized 7-layer model)

Implemented as `GuardedMcpProxy.call(tool, args, ctx)` in the backend. Read tools pass through. The 3 commit
tools run the gate:

1. **L1 kill-switch** — `LB_REAL_ORDERS=1` else return a demo result (`demo_<ts>` id), audit `demo`.
2. **L2 user mode** — `swiggy_connections.mode == "live"` else demo. (D7.)
3. **L3 guardrails** — food cart `< ₹1000`; COD only; dineout = free; surface-specific caps. Fail → blocked + reason.
4. **L4 confirm (2-phase, non-blocking)** — create `pending_action`; **do not execute**. Sync: emit `data-gate`
   to the chat stream. Async (workflow/WhatsApp): notify via §10 + schedule `action-expire` at `expiresAt`.
   On YES → `startGrace`: open `grace:<actionId>` for `LASTBITE_GRACE_SECONDS` (default 30) and return immediately.
   The cooling window lives **at the human interface**: a visible client countdown for web, the reply window for async.
5. **L5 grace + commit** — STOP during the window → `cancelGrace` + mark cancelled (cheap, no lock contention —
   **fixes v1 F1**). On window elapse → `commit`: acquire the per-user lock, re-check `grace` is not cancelled
   (Redis read error → **abort, do not commit** — safer default), then L6/L7. This replaces v1's in-request
   blocking `awaitGrace`, so a web STOP is a normal second request, never a lock-busy 429.
6. **L6 idempotency** — `SETNX idem:sha256(userId·cartHash·dayUTC)` 24h; second identical → `duplicate`, no execute;
   released on transient execute failure so a retry is safe.
7. **L7 mutex + audit** — per-user lock around the execute; append an immutable `audit_log` row for every
   evaluation + outcome, joinable by `request_id`.

**Async-confirm invariant (D2):** there is no code path that executes a commit tool without a human `yes`
resolving its `pending_action`. No reply within the window → `expired`, nothing placed.

---

## 8. Model layer (D1, D8)

- **Vercel AI Gateway**, model ids as `creator/model` strings. Operator keys in env / gateway config; never client-side.
- **Catalog** assembled from a curated default list per provider + optional dynamic fetch; grouped in the picker.
  Providers: Anthropic, Google, xAI, DeepSeek, OpenAI, Mistral, Groq, plus OpenRouter (`openrouter/…`) for the long tail.
- **Agentic pinning:** a thread with a `surface` (i.e. may call Swiggy tools) uses `defaultAgenticModel`
  (a verified tool-reliable model) unless the user overrides with another tool-reliable one. Plain chat threads
  (no surface) may use any catalog model.
- **Tool-call verification (S3):** a CI check exercises each catalog model against a trivial MCP tool call;
  models that fail are marked `toolReliable:false` and shown "chat-only" in the picker.
- **Failover:** per call, a primary + fallback model; retry only on 429/quota, never on tool errors.

---

## 9. Workflow engine (P4)

`workflow = { name, prompt, surface, trigger, confirm:"async", windowMinutes }`.
- **Triggers:** `manual` (run-now), `cron` (QStash schedule, IST default), `keyword` (phrase in chat/WhatsApp).
- **Run lifecycle:** QStash fires `/api/cron/workflow-fire` → `workflow_runs(queued→building)` → agent runs the
  saved prompt through the same loop + gate → gate L4 (async) creates `pending_action` + notifies →
  `awaiting_confirm` → user YES → `placed` / STOP → `cancelled` / timeout → `expired`.
- **"Restock when low":** Swiggy exposes no inventory signal → modeled as scheduled cadence or a user-declared
  keyword. Predictive depletion is a later, opt-in, clearly-labeled estimate (out of v1).

---

## 10. Notifications & WhatsApp (P5, D4)

- **Notifier** abstraction with channels: web push, email, WhatsApp. Async-confirm + receipts go through it.
  Channel priority + "require ≥1 channel before a schedule can arm" — **OPEN ITEM (see §13)**.
- **WhatsApp = Gupshup BSP.** Outbound async-confirm/receipt use **pre-approved utility templates**; free-form
  only inside the **24h** customer-service window. Inbound `YES`/`STOP`/keyword routes into the gate/workflow.
  Number linked to account via `wa_links` (verified). Webhook secret verified, **fail-closed in production**.
  Inbound dedup by message id. **No Baileys/unofficial bridges.**

---

## 11. Security & DPDP

- **Token vault:** AES-256-GCM, app key from env/secret manager, per-row `iv`+`salt`, scrypt-derived per-purpose
  subkeys (token / session / oauth-state labels). Decrypt only inside `SwiggyClient`. RLS owner-only read.
- **Tenant isolation:** Postgres RLS on every user table; privileged server paths use service-role + explicit `user_id`.
- **Spend authority:** gate is the only path to commit tools; non-bypassable by model/prompt/channel; D7 master switch.
- **Transport:** OAuth 2.1 + PKCE; bearer only in Authorization header; one `SwiggyClient` per user; never shared.
- **Logs:** redaction middleware strips `Bearer ey…`/JWT; request-id + user-id correlation via AsyncLocalStorage.
- **Webapp auth:** Supabase sessions (HttpOnly/Secure/SameSite); server authorization on every route.
- **Prompt-injection:** tool results are untrusted; a malicious restaurant name can't force spend — gate's human-YES
  (L4) + master switch (L1) + caps (L3) bound the blast radius.
- **DPDP:** explicit consent on connect; 30-day TTLs; data export + "forget me" delete; `/privacy`; minimal PII
  (email + tokens; phone only on WhatsApp link).

---

## 12. Non-functional

- **Perf:** chat first-token < 1.5s p50 (gateway dependent); gate confirm round-trip < 1s excl. the 30s grace.
- **Cost:** operator-funded; default to efficient model tiers; gateway spend telemetry surfaced in audit/ops.
- **Observability:** structured logs (redacted, request-id), `audit_log` as the forensic record, gateway spend report.
- **Testing:** unit (gate, crypto, parsers), contract (zod-validated request/response), RLS policy tests,
  an offline end-to-end **smoke** of the gate state machine (ported + generalized from v1), FE component +
  MSW-contract tests, per-model tool-call CI check (S3).

---

## 13. Open items (P4+, non-blocking for P1–P3)

- Households (shared workflows + member roles) — scope into P4 or later.
- Email provider (e.g. Resend) — decide before P4.
- Confirm-channel priority + "require ≥1 channel before arming a schedule."
- Product name (keep "Last Bite" vs. rename for 3-surface scope).

---

## 14. Phasing

| Phase | Scope | Exit |
|---|---|---|
| **P1** Foundation | greenfield scaffold; Supabase Auth (Google + magic-link) + schema + RLS; native Swiggy OAuth + encrypted vault; spikes S1–S2 | login → connect Swiggy on localhost → token sealed + RLS-isolated |
| **P2** Chat + models | Vercel AI Gateway + picker; threads/memory; streaming tool-calling loop over **food** read/cart tools; spike S3 | multi-turn, multi-model chat; food browse/cart works; history persists |
| **P3** Spending gate | GuardedMcpProxy + gate L1–L7 (sync); generalize to instamart `checkout` + dineout `book_table`; smoke green | STOP-at-gate + idempotency pass across all 3 commit tools |
| **P4** Workflows | workflow CRUD; QStash cron; runs; **async-confirm** + `pending_actions`; notifier (push/email) | "Friday 8pm" prepares + asks; places only on YES; expires cleanly |
| **P5** WhatsApp | Gupshup outbound templates + inbound YES/STOP/keyword; number linking; tracking polls | async-confirm + receipts over WhatsApp, 24h-compliant |
| **P6** Prod gate | Builders Club application + video; security review; ops dashboards | Swiggy prod creds; real orders behind D7 master |

The two implementation plans cover **P1–P3 in full task detail** (the dev-ready core) and outline **P4–P5** as the
next increment (detailed after P1–P3 lands and S1–S4 resolve, to avoid encoding guesses about spike outcomes).
```
