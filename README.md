# Last Bite

> Order Swiggy in plain English. Confirm before you regret.

A web agent that takes natural-language Swiggy orders, walks them through a three-stage human-in-the-loop confirmation, then waits 30 seconds before committing. COD-only by design — so a sleepy ₹500 biryani never goes through without intent.

**Live:** [swiggy-mcp.vercel.app](https://swiggy-mcp.vercel.app)
**Whitelist request:** [Swiggy/swiggy-mcp-server-manifest#53](https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53)

![Last Bite hero](https://swiggy-mcp.vercel.app/opengraph-image)

---

## What it does

You type something like:

> *"chocolate ice cream within 7km of MyHome, best rated, under ₹300"*

Last Bite parses your intent (dish, budget, distance, rating, address tag, veg-only, quantity), filters Swiggy's restaurant list, picks the best match, builds a cart, then walks you through three gates:

1. **Calorie check** — *"~1,100 kcal. Still go?"*
2. **ETA check** — *"42 min ETA. OK?"*
3. **Final confirm** — visible 30-second countdown after your YES

If no exact match exists, it shows a numbered list of near-misses with the reasons they didn't qualify (*"4.0★ vs 4.5★ asked, 8km away vs 5km cap"*) and lets you pick one.

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│  /order/new chat                                                  │
│   └─► /api/chat ─► LangGraph agent                                │
│            ├── Searcher (Groq Llama 3.1 8B intent → Swiggy MCP)   │
│            ├── Confirmer (3 gates, interrupt() pattern)           │
│            ├── Recommender (when no exact match)                  │
│            └── Placer (gated by env + per-user mode toggle)       │
└──────────────────────────────────────────────────────────────────┘
```

- **Intent extraction:** Groq `llama-3.1-8b-instant` with a Zod schema for structured output (no regex).
- **Filtering & sorting:** deterministic TypeScript on Swiggy's response (rating, distance, budget caps, veg flag).
- **Gates:** LangGraph `interrupt()` — agent pauses, frontend re-prompts on YES/STOP.
- **Idempotency:** `sha256(user_id, cart_hash, day)` key prevents double-orders.
- **Token storage:** AES-256-GCM at rest in Upstash Redis with a 30-day TTL, scrypt-derived per-purpose key.

## BYOC setup (until Swiggy whitelists us)

Swiggy's MCP auth server runs a client whitelist. Until [issue #53](https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53) clears, every user supplies their own bearer token captured from a Claude Desktop session that's already authorized:

1. Install [Claude Desktop](https://claude.ai/download).
2. Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "swiggy-food": { "url": "https://mcp.swiggy.com/food" }
     }
   }
   ```
3. Restart Claude Desktop. It pops up Swiggy's OTP login — sign in.
4. Type `/mcp` in any chat — confirm `swiggy-food` shows as *connected*.
5. Open Claude's data folder (`~/Library/Application Support/Claude/`), find the `access_token` value (a long `eyJ…` string) in the OAuth blob.
6. Paste it into [/connect](https://swiggy-mcp.vercel.app/connect).

Tokens last ~24h. When yours expires, the chat detects Swiggy's 401, wipes the stale token, and redirects you back to /connect for a fresh paste.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router (TypeScript) |
| UI | Tailwind v4 + shadcn/ui |
| Agent | LangGraph 1.3 (StateGraph + `interrupt()`, MemorySaver / PostgresSaver) |
| MCP client | `@ai-sdk/mcp` |
| Intent LLM | Groq `llama-3.1-8b-instant` (free tier) |
| Persona LLM | Anthropic `claude-haiku-4-5` (only when tone matters) |
| Redis | Upstash (token storage, idempotency, mode prefs, rate limit) |
| Postgres | Neon (LangGraph checkpoints) |
| Hosting | Vercel |

## Safety model

| Layer | Control |
|---|---|
| Env kill switch | `LB_REAL_ORDERS=1` required for any live order to fire |
| Per-user mode | Demo / Live toggle stored in Redis, defaults to demo |
| Three gates | Calorie + ETA + final, each `interrupt()`'d |
| Grace timer | 30s after final YES, STOP cancels |
| Idempotency | `sha256(user, cart, day)` key |
| Token redaction | Middleware strips `Bearer ey…` from logs / Sentry |
| DPDP posture | Anonymous-by-default, 30-day TTL, `/privacy` live |

## Local dev

```bash
git clone https://github.com/Jayanth-reflex/swiggy-mcp
cd swiggy-mcp
npm install
cp .env.example .env.local   # fill in Upstash + Neon + Groq + Anthropic
npm run dev
```

Required env vars:
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Upstash via Vercel Marketplace)
- `DATABASE_URL_UNPOOLED` (Neon, must bypass PgBouncer for LangGraph)
- `BYOC_ENCRYPTION_KEY` (any 32+ char string)
- `GROQ_API_KEY`
- `ANTHROPIC_API_KEY` (optional, for persona)
- `LB_REAL_ORDERS=1` to enable live mode
- `USE_FIXTURES=1` to run against captured fixtures (no real Swiggy calls)

Smoke tests: `npm run smoke`.

## Project status

- ✅ Web chat at `/order/new` (demo + live modes)
- ✅ BYOC token-paste flow at `/connect`
- ✅ Three gates + 30s grace timer
- ✅ AI intent + filtered match + recommendations on no-match
- ✅ Modern minimalist UI redesign
- ✅ Expired-token self-heal (Swiggy 401 → wipe + redirect to /connect)
- ⏳ Swiggy whitelist for native OAuth (issue #53)
- ⏳ WhatsApp integration (Gupshup webhook stub at `/api/whatsapp`)

## Roadmap (per [CLAUDE.md](./CLAUDE.md))

Last Bite is Project 1 of 5 in a Swiggy MCP portfolio:

1. **Last Bite** — this repo
2. **Trail** — vernacular WhatsApp + Apple Watch order tracking
3. **ChaiCal** — group Dineout coordinator on Slack/WhatsApp
4. **Bharat Pantry** — Instamart auto-restock from household consumption patterns
5. **Saans** — voice ordering in Hindi/Telugu/Tamil/Bengali via Twilio

## License

MIT.

---

Built with [Claude Code](https://claude.com/claude-code). Not affiliated with or endorsed by Swiggy.
