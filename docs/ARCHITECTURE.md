# Architecture

Last Bite is a single-tenant Next.js 16 web agent on Vercel that places Swiggy COD orders via Swiggy's official MCP server. Two surfaces: a landing page that explains the product, and an authenticated chat at `/order/new` where the actual ordering happens.

The interesting parts are the agent (LangGraph 1.3 supervisor with three `interrupt()`-gated nodes), the BYOC token bridge, and the safety model. Everything else is conventional shadcn-on-Next.js.

For the safety contract this architecture implements, see [SAFETY.md](./SAFETY.md).
For the deploy / env story, see [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Request flow — the happy path

```
┌────────┐   visit /             ┌──────────────────────┐
│ user   │ ────────────────────▶│ landing (Next RSC)    │
└────────┘                      └──────────────────────┘
     │
     │ click "Get started"
     ▼
┌──────────────────────┐  POST /api/oauth/byoc          ┌──────────────────────┐
│ /connect             │ ──────────────────────────────▶│ Swiggy MCP /tools    │  validate
│ (paste phone+token)  │                                │ /list                │  the token
└──────────────────────┘ ◀────── 200 + Set-Cookie ───── └──────────────────────┘
     │
     │ redirect /connect/success → /order/new
     ▼
┌──────────────────────┐                                ┌──────────────────────┐
│ /order/new           │ ─── POST /api/chat ───────────▶│ /api/chat            │
│ (chat UI, dark mode) │                                │  – read session      │
└──────────────────────┘ ◀────── { reply, status,       │  – getByocToken      │
     ▲                            paused, orderId }     │  – new SwiggyClient  │
     │                                                  │  – processTurn(…)    │
     │                                                  └──────────┬───────────┘
     │                                                             │
     │                                                             ▼
     │                                                  ┌──────────────────────┐
     │                                                  │ LangGraph supervisor │
     │                                                  │  ┌─ Searcher          │
     │                                                  │  ├─ Recommender       │
     │                                                  │  ├─ Confirmer (gates) │
     │                                                  │  └─ Placer            │
     │                                                  └──────────┬───────────┘
     │                                                             │
     │              calls: get_addresses, search_restaurants,      │
     │              search_menu, update_food_cart, get_food_cart,  │
     │              place_food_order, track_food_order             │
     │                                                             ▼
     │                                                  ┌──────────────────────┐
     └─── streamed bot text ◀───────────────────────────│ Swiggy MCP server    │
                                                        │ mcp.swiggy.com/food  │
                                                        └──────────────────────┘
```

---

## Directory map

```
app/
  page.tsx                       landing (RSC) — composes /components/landing/*
  layout.tsx                     ThemeProvider + TooltipProvider + Sonner
  globals.css                    @theme inline + brand tokens + animations
  connect/page.tsx               BYOC token-paste form (client component)
  connect/success/page.tsx       post-paste landing
  order/new/page.tsx             chat UI (client; calls /api/me + /api/chat)
  order/[id]/page.tsx            shareable receipt
  privacy/page.tsx               DPDP-aligned policy
  opengraph-image.tsx            dynamic 1200×630 social card
  api/
    me/route.ts                  whoami + mode for the chat header
    me/mode/route.ts             POST: flip per-user mode (demo|live)
    chat/route.ts                POST: one agent turn → reply
    oauth/byoc/route.ts          POST: validate + store the BYOC token
    oauth/start/route.ts         POST: legacy OAuth init (kept; not wired in /connect today)
    oauth/callback/route.ts      GET:  legacy OAuth return (kept; not wired)
    whatsapp/route.ts            POST: Gupshup inbound (wired, not provisioned in prod)
    cron/cleanup-checkpoints/    GET:  daily LangGraph checkpoint sweep
    admin/run-turn/route.ts      POST: server-side test endpoint (LB_ADMIN_SECRET)
    admin/list-orders/route.ts   GET:  admin order listing

components/
  ui/*                           shadcn primitives (alert-dialog, dialog, sheet, ...)
  landing/                       hero, how-it-works, trust-band, faq
  site-chrome.tsx                header + footer + ThemeToggle
  theme-provider.tsx             next-themes wrapper
  theme-toggle.tsx               sun/moon button
  powered-by-swiggy.tsx          attribution (per CLAUDE.md every-screen rule)

lib/
  agent/
    graph.ts                     LangGraph supervisor + Searcher / Recommender / Confirmer / Placer
    runner.ts                    one-turn driver: lock, idle-thread guard, interrupt resume
    intent.ts                    Groq parseIntent + IntentParseError.kind
    persona.ts                   Anthropic gatePrompt + heuristic kcal estimator
    schemas.ts                   Zod: Cart, Recommendation, InterruptPayload discriminated union
    checkpointer.ts              Postgres / Memory saver wiring (with set-once race fix)
  mcp/
    swiggy-client.ts             SwiggyClient + SwiggyMcpError.kind classifier
  byoc.ts                        Redis token store (encrypted) + normalisePhone
  session.ts                     30-day AES-GCM session cookie
  crypto.ts                      AES-256-GCM helpers; scrypt-derived per-purpose keys
  redis.ts                       Upstash client + locks + grace timer + idem helpers
  swiggy-oauth.ts                OAuth + PKCE helpers (legacy — kept for the day whitelist clears)
  user-prefs.ts                  per-user mode (demo|live) + effectiveMode kill-switch
  ratelimit.ts                   Upstash Ratelimit (connect endpoint)
  whatsapp/gupshup.ts            inbound parse + outbound send (when provisioned)
  redact.ts                      log redactor (strips Bearer tokens, normalises shapes)
  log-context.ts                 AsyncLocalStorage for request-id correlation

hooks/
  use-streamed-text.ts           word-by-word reveal of bot text
  use-mounted.ts                 SSR-safe mount flag (motion gating)

scripts/
  smoke.ts                       8-scenario regression harness (no network)
  capture-real-fixtures.ts       saves real MCP responses to /fixtures/swiggy/food/
  snapshot-cart.ts               dev helper
  live-e2e.ts                    drives /api/admin/run-turn through gates
  real-mcp-probe.ts              one-off MCP probe
```

---

## The agent (LangGraph supervisor)

```
                       ┌─────────────────────────┐
                       │  state: LastBiteStateT  │
                       │  – userId, query        │
                       │  – addressId, cart      │
                       │  – gatesPassed{}        │
                       │  – status, orderId      │
                       │  – recommendations      │
                       │  – intent (Zod)         │
                       └────────────┬────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │       Searcher          │
                       │  parseIntent (Groq)     │
                       │  get_addresses          │
                       │  search_restaurants     │
                       │  applyHardFilters       │
                       │  pick best, build cart  │
                       └────────────┬────────────┘
                                    │
            ┌───── cart ─────┐      │      ┌─── recs only ────┐
            ▼                │      │      │                  ▼
  ┌─────────────────────┐    │      │      │       ┌─────────────────────┐
  │     Confirmer       │    │      │      │       │    Recommender      │
  │  Gate 1: calorie    │◀─── interrupt() ───┘       │  numbered list +    │
  │  Gate 2: ETA        │                            │  reasons "why not   │
  │  Gate 3: final-gate │◀─── interrupt() ───────────│  exact"             │
  └──────────┬──────────┘                            │  user picks a #     │
             │                                       └──────────┬──────────┘
             │ all gates pass                                   │
             ▼                                                  │ buildCartAt()
  ┌─────────────────────┐                                       │
  │       Placer        │◀──────────────────────────────────────┘
  │  startGraceTimer    │
  │  awaitGrace 30s     │
  │  consumeIdempotency │
  │  effectiveMode      │
  │   ─ demo: fake      │  ◀── two-layer kill switch
  │   ─ live: place_food_order
  └─────────────────────┘
```

**Why this shape.**
- Searcher is deterministic (Zod-validated intent → TypeScript filter → top-3 candidates → menu probe). The only LLM call is `parseIntent`. Everything else is plain TypeScript on Swiggy's response.
- Recommender exists because "no exact match" used to fail silently. Now we present near-misses with annotated reasons and let the user pick.
- Confirmer uses LangGraph `interrupt()` — the agent pauses, the frontend re-prompts on YES/STOP, the agent resumes.
- Placer enforces the **two-layer demo guard** (`LB_REAL_ORDERS=1` env + per-user `mode:<phone>` Redis key) plus the **30-second grace timer** before any real `place_food_order`.

---

## Data model

### Redis keys (Upstash)

| Key | Type | TTL | Set by | Notes |
|---|---|---|---|---|
| `byoc:<phone>` | string (AES-256-GCM ciphertext) | 30d | `setByocToken` | Bearer token at rest. Decrypted only inside `SwiggyClient` construction. Never logged. |
| `mode:<phone>` | string (`"demo"` \| `"live"`) | 30d | `setUserMode` | Per-user mode preference. `effectiveMode()` ANDs this with `LB_REAL_ORDERS` env. |
| `lock:user:<phone>` | string (random token) | **180s** | `acquireUserLock` | Per-user mutex. Compare-and-delete release. TTL must outlive longest possible turn (30s grace + 30s MCP + buffer); see CHANGELOG for the bump from 90s. |
| `last:<phone>` | int (epoch ms) | 30d | `bumpLastActiveAt` | Drives the 30-min abandoned-thread auto-clear in `runner.ts`. |
| `idem:<sha256(user, cart, day)>` | int (1) | 24h | `consumeIdempotency` | Server-side dedup so a retry within 24h can't re-place. |
| `grace:<orderRef>` | string (`"pending"` \| `"cancelled"`) | grace+5s | `startGraceTimer` / `cancelGrace` | The 30s STOP window. `awaitGrace` polls every 750ms with a 5-failure circuit breaker. |
| `msg:<gupshup_message_id>` | int (1) | 24h | `claimMessageId` | Inbound WhatsApp dedup. |

### Postgres (Neon)

LangGraph `PostgresSaver` checkpoints under tables it manages itself. Connection string must be `DATABASE_URL_UNPOOLED` (or any non-PgBouncer variant) — the transaction pooler breaks LangGraph's prepared statements.

Pool capped at `LASTBITE_PG_POOL_MAX` (default 2) so each Vercel lambda doesn't burn through the upstream connection budget under Fluid Compute concurrency.

### Session cookie (`lb_session`)

`{ phone, expiresAt }` sealed with AES-256-GCM, scrypt-derived per-purpose key (`"lastbite-session-v1"`). 30-day TTL. `HttpOnly; Secure; SameSite=Lax`.

### Local conversation state

Held in LangGraph state (`LastBiteStateT`), checkpointed per `thread_id = userId`. Reset on each fresh init in `runner.ts` so stale derived fields don't leak between runs (this caught a real bug after token-refresh invalidated address IDs).

---

## Encryption

All AES-256-GCM. Single env `BYOC_ENCRYPTION_KEY` (≥32 chars, dev tip: `openssl rand -hex 32`). Per-purpose subkeys derived via scrypt with a label — so the BYOC token key is `scrypt(BYOC_ENCRYPTION_KEY, "lastbite-byoc-v1")`, the session cookie key is `scrypt(…, "lastbite-session-v1")`, the OAuth state key is `scrypt(…, "lastbite-oauth-state-v1")`. Rotating the env rotates everything in lockstep.

`safeLog` (in `lib/redact.ts`) strips any `Bearer ey…` substring before emitting, so a stray exception that includes a token in its message can't leak to logs.

---

## Why "BYOC" is a bridge, not a feature

Swiggy's MCP auth server (`mcp.swiggy.com/auth/*`) added a client whitelist around 2026-05-07 that rejects our Vercel-hosted redirect URI. Until [issue #53](https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53) clears, the user has to:

1. Install Claude Desktop.
2. Configure `~/Library/Application Support/Claude/claude_desktop_config.json` with the Swiggy Food MCP URL.
3. Sign into Swiggy via OTP inside Claude Desktop.
4. Find the `access_token` in Claude's local data.
5. Paste it into our `/connect` page.

This is non-tech-friendly. We're honest about it in the copy now (see [AUDIT_2026-05.md](./AUDIT_2026-05.md) §A1#1). The `lib/swiggy-oauth.ts` PKCE / DCR machinery is kept intact so flipping back to native OAuth on the day Swiggy whitelists us is a one-line UI change.

---

## Performance / cost shape

- **Intent parsing**: Groq `openai/gpt-oss-20b` — ~700ms p50, free tier.
- **Persona** (gate copy): Anthropic `claude-haiku-4-5` if `ANTHROPIC_API_KEY` set, else heuristic fallback. Only on the gate moments, not per-message.
- **Search / cart**: 2–5 Swiggy MCP calls per turn, 200–800ms each.
- **Total p50 per turn (excluding the 30s grace timer)**: ~3–5s. The streaming-bubble UX hides most of it.

Vercel Functions on Fluid Compute. Default `maxDuration` 60s on `/api/chat`; the user mutex TTL (180s) outlives that with margin.

---

## Things this doc deliberately omits

- Project 2–5 (Trail, ChaiCal, Bharat Pantry, Saans). Last Bite is the only one shipped. The other four are roadmap in [CLAUDE.md](../CLAUDE.md).
- The Builders Club submission packet (in `docs/BUILDERS_CLUB_SUBMISSION.md`).
- The demo video script (in `docs/DEMO_VIDEO_SCRIPT.md`).
