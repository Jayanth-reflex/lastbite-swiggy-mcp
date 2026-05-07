# CLAUDE.md

> **Mission.** Five projects on Swiggy MCP, ordered by speed-of-ship. Built entirely with **Claude Code** (terminal agentic coding), **Claude Desktop** (your personal Swiggy MCP host for BYOC testing), and **Cowork** (file/task automation during dev). No Cursor, no IDE plugins.

---

## 0. Operating Principles (read first)

- **Bring Your Own Claude (BYOC).** Until Builders Club approval lands, every project runs on the *user's* personal Swiggy MCP connection inside Claude Desktop. You write the agent + UI; the user holds the OAuth via their Claude Desktop config.
- **Powered by Swiggy** must appear on every screen surfacing Swiggy data. Never rebrand, never aggregate competitors, never benchmark.
- **COD only, non-cancellable.** Every `place_food_order` / `checkout` call must be preceded by an explicit human-in-the-loop confirmation gate. No exceptions.
- **Idempotency.** Every write tool call carries a deterministic `idempotency-key = sha256(user_id, cart_hash, day)`. Redis dedup window 24h.
- **Token redaction.** Never log `Bearer ey…` strings. Middleware redacts before any `console.log` / Sentry / Axiom emission.
- **DPDP posture.** Anonymous-by-default. Cookie-based session UUID. 30-day TTL on stored data. `/privacy` page live before launch.

---

## 1. Tooling Setup (one-time, ~30 min)

### Claude Desktop — your Swiggy MCP harness
Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent:

```json
{
  "mcpServers": {
    "swiggy-food": { "url": "https://mcp.swiggy.com/food" },
    "swiggy-instamart": { "url": "https://mcp.swiggy.com/im" },
    "swiggy-dineout": { "url": "https://mcp.swiggy.com/dineout" }
  }
}
```


Restart Claude Desktop → complete OTP login on each server. You now have a working Swiggy agent in Claude Desktop. Use this to:
- Capture real MCP responses for fixtures (`./fixtures/*.json`)
- Validate tool schemas before coding
- Demo your concept end-to-end before writing a line of app code
- Generate the demo video for your Builders Club application

### Claude Code — your build agent

```bash
npm install -g @anthropic-ai/claude-code
cd ~/projects && claude
```


Drop this `CLAUDE.md` at the repo root. Claude Code reads it as standing instructions for the project. All "Day-1 prompts" below go directly into Claude Code's terminal.

### Cowork — your background ops layer
Use Cowork (desktop) for non-code chores during the build:
- Organizing fixture JSON files into `/fixtures/swiggy/{food,instamart,dineout}/`
- Bulk-renaming demo screen recordings before uploading
- Drafting Builders Club application narrative + privacy policy from templates
- Scheduling the Monday submission to `builders@swiggy.in`

Keep Cowork on a second monitor; let it handle file/task automation while Claude Code writes the agent.

---

## 2. Default Tech Stack (use for all 5)


```
Framework        Next.js 14+ App Router (TypeScript, edge where possible)
UI               Tailwind v4 + shadcn/ui
Streaming        Vercel AI SDK 4.2+ (useChat, streamText, experimental_createMCPClient)
Default LLM      Groq → Llama 3.3 70B Versatile (free 14,400/day)
Vision LLM       Gemini 2.5 Flash (free 1,500/day)
Persona LLM      Claude Haiku 4.5 (paid; only when tone matters)
Voice STT/TTS    Sarvam AI (Indic) — only for Saans
DB               Upstash Redis (HTTP, edge-safe). Neon Postgres if relations needed.
Auth             None default; Clerk free tier if accounts required
Domain           Cloudflare Registrar
Analytics        PostHog free + Vercel Web Analytics
Payments         Razorpay Payment Links (₹49/₹99/₹149 tip jar)
Messaging        Twilio (Saans) / Gupshup WhatsApp Business (Last Bite, Trail, Bharat Pantry)
Cron             Upstash QStash (free 500/day)
Agent            LangGraph.js with PostgresSaver (or RedisSaver for sub-ms)
Observability    Langfuse self-hosted free tier
```



**MCP integration pattern (BYOC, default):**

```ts
// app/api/agent/route.ts
import { experimental_createMCPClient, streamText } from 'ai'
import { groq } from '@ai-sdk/groq'

const mcpClient = await experimental_createMCPClient({
  transport: { type: 'http', url: 'https://mcp.swiggy.com/food' },
  // user provides their own bearer token via header
  headers: { Authorization: `Bearer ${userToken}` }
})
const tools = await mcpClient.tools()
return streamText({ model: groq('llama-3.3-70b-versatile'), tools, ... })
```



**Repo structure (every project):**

```
/app
  /api/agent/route.ts        # main LangGraph stream
  /api/webhook/[provider]    # Twilio / WhatsApp inbound
  /(public)/page.tsx         # landing
  /[id]/page.tsx             # shareable result / order status
/lib
  /mcp/swiggy-client.ts      # SwiggyClient interface (BYOC + DelegatedClient)
  /agent/graph.ts            # LangGraph supervisor + workers
  /agent/tools.ts            # Zod-validated tool wrappers
  /redis.ts                  # Upstash client
  /redact.ts                 # token redaction middleware
/components/ui               # shadcn
/fixtures/swiggy             # captured MCP responses (Cowork-organized)
/public/brand/poweredby.svg  # required asset
CLAUDE.md                    # this file
```


### The two-track build loop
1. **Claude Desktop** — explore the real MCP, capture responses, validate UX assumptions
2. **Claude Code** — write the Next.js + LangGraph code that replicates that flow programmatically
3. **Cowork** — files, screenshots, application paperwork in parallel

---

# Project 1 — Last Bite

> **One-line.** WhatsApp agent that takes natural-language Swiggy orders, runs a 3-stage confirmation with a 30-second grace timer, then commits.

## PRD

**Problem.** Swiggy MCP orders are COD-only and non-cancellable per the official manifest warning. Users place orders they regret 10 seconds later.

**User.** 22–40 year-old Indian Swiggy regulars who chat on WhatsApp, order 3+ times a week, often distracted/late-night.

**Headline flow.**
1. User: *"Order chicken biryani from Paradise, ₹500 budget"*
2. Agent: searches → builds cart → returns: *"Cart ready: Paradise Special Biryani ₹449 + delivery ₹40 = ₹489. Confirm in 30s or reply STOP."*
3. **Stage 1 (calorie gate):** *"~1,100 kcal. Still go?"* → user taps ✅
4. **Stage 2 (ETA gate):** *"42 min ETA. OK?"* → ✅
5. **Stage 3 (final):** Visible 30s countdown → silent → `place_food_order` fires
6. Confirmation card with "Powered by Swiggy" + order ID

**Out of scope (v1).** Multi-restaurant orders. Refunds. Modification. Group orders.

**Success metrics.**
- ≥80% of orders pass all 3 gates
- <5% "I regret this" complaints in first 100 orders
- ≥30% week-2 retention

**Tech surface.**
- Frontend: Next.js dashboard for setup/history; primary UX is WhatsApp.
- Backend: Vercel serverless `/api/whatsapp` webhook from Gupshup → LangGraph agent.
- Agent: 1 supervisor + 3 workers (Searcher, Confirmer, Placer). PostgresSaver for state.
- Storage: Neon Postgres (orders, gates passed). Upstash Redis (30s grace timer key).
- LLM: Groq Llama 3.3 70B for routing + Confirmer; Haiku for the "are you sure?" persona.

**MCP tools used:** `search_restaurants`, `search_menu`, `get_restaurant_menu`, `update_food_cart`, `get_food_cart`, `place_food_order`, `track_food_order`.

**Critical agent rule.** Placer node has `interrupt_before=['place_food_order']`. Grace timer = `setTimeout` 30s; cancel-on-STOP via Redis pub/sub.

**Pre-build (Claude Desktop, 30 min):**
- Run the full happy path in Claude Desktop chatting to Swiggy Food MCP
- Save 5–6 raw MCP responses to `/fixtures/swiggy/food/` via Cowork file ops
- Screen-record one successful flow for your application demo

**Build checklist (2 weekends, ~24h):**
- [ ] Next.js + shadcn skeleton + `/api/whatsapp` webhook + Gupshup sandbox
- [ ] `SwiggyClient` interface with BYOC token in header
- [ ] LangGraph supervisor → Searcher → Confirmer → Placer
- [ ] 30s grace countdown w/ Redis cancel channel
- [ ] Idempotency key on `place_food_order`
- [ ] Powered by Swiggy footer in every WhatsApp template
- [ ] DPDP `/privacy` page live
- [ ] Deploy `lastbite.fun` on Cloudflare + Vercel
- [ ] 5-friend beta test with real COD orders

**Day-1 prompt (paste into Claude Code):**
> "Read CLAUDE.md. Scaffold a Next.js 14 App Router project with shadcn/ui. Add a Gupshup WhatsApp webhook at `/api/whatsapp`. Build a LangGraph.js supervisor with Searcher/Confirmer/Placer nodes calling Swiggy Food MCP via Vercel AI SDK `experimental_createMCPClient`. The Placer node uses `interrupt_before` for human-in-the-loop. Add a 30s grace timer using Upstash Redis pub/sub for STOP cancellation. Use Groq Llama 3.3 70B as default LLM and Claude Haiku 4.5 for the confirmation persona. Persist agent state in Neon Postgres via PostgresSaver. Deploy target: Vercel + Cloudflare domain `lastbite.fun`. Use the fixtures in `/fixtures/swiggy/food/` to mock MCP calls during dev."

---

# Project 2 — Trail

> **One-line.** A polling backend that turns `track_food_order` into vernacular WhatsApp + Apple Watch live updates.

## PRD

**Problem.** Swiggy MCP has no order webhooks. Users refresh the app every 90 seconds. Notification copy is sterile English.

**User.** Anyone who's ordered on Swiggy and feels mild anxiety until food arrives. Bonus: Apple Watch wearers, Hinglish-preferring Indians.

**Headline flow.**
1. User pastes their Swiggy order ID (or BYOC OAuth via Claude Desktop)
2. Trail spawns a per-order Cloudflare Worker polling `track_food_order` every 15s with adaptive backoff
3. State changes → WhatsApp messages in user's language: *"Bhai, biryani 4 min away. Partner just entered your lift."*
4. Apple Watch complication shows ETA + status emoji
5. Auto-cleanup once `delivered`

**Out of scope (v1).** Live GPS map. Multi-order tracking. Restaurant-side push.

**Success metrics.**
- p95 push latency vs Swiggy app: ≤30s
- ≥40% beta users opt for Hindi/Hinglish over English
- ≥3 messages received per order on average

**Tech surface.**
- Frontend: minimal Next.js settings page (language + watch pairing).
- Backend: Cloudflare Worker per active order. State in Workers KV.
- Agent: not strictly needed; one Groq call to phrase status changes with personality.
- Storage: Workers KV (order state) + Upstash Redis (user prefs).
- LLM: Groq Llama 3.3 70B in batch mode for vernacular phrasing.
- Watch: Apple Shortcut + REST endpoint returning `{ status, eta_min, emoji }`.

**MCP tools used:** `track_food_order`, `track_order` (Instamart).

**Critical engineering note.** Adaptive polling: 30s when stable, 10s within ETA-2min window, stop on terminal state. Per-order TTL in KV = ETA + 30 min.

**Pre-build (Claude Desktop, 20 min):**
- Place a real Swiggy order, watch `track_food_order` payload evolve every 30s
- Save 6–8 status-progression snapshots as fixtures via Cowork

**Build checklist (2–3 weekends, ~28h):**
- [ ] Next.js settings page with language dropdown
- [ ] Cloudflare Worker template (order ID + token + lang)
- [ ] Polling loop with adaptive backoff
- [ ] Gupshup WhatsApp template registry (English + Hindi + Hinglish + Tamil)
- [ ] Groq batch call for vernacular phrasing on status change
- [ ] Apple Shortcut + REST endpoint for watch
- [ ] Powered by Swiggy in every push
- [ ] Deploy `trail.lol`

**Day-1 prompt (Claude Code):**
> "Read CLAUDE.md. Build a Cloudflare Worker that polls Swiggy MCP `track_food_order` every 15s with adaptive backoff (30s stable, 10s near-ETA, stop on terminal). On status change, call Groq Llama 3.3 70B to phrase it in user's chosen language (English/Hindi/Hinglish/Tamil), send via Gupshup WhatsApp. Use Workers KV for order state with TTL = ETA + 30 min. Add a Next.js settings page on Vercel for language selection. Build a public REST endpoint `/api/watch/[orderId]` returning `{status, eta_min, emoji}` for Apple Shortcut consumption. Domain: `trail.lol`."

---

# Project 3 — ChaiCal

> **One-line.** Drop a bot in your Slack/WhatsApp group; it polls everyone, resolves consensus, books one Dineout table.

## PRD

**Problem.** "Where do we go Friday?" threads die. Indian friend groups want one decision, one booking, zero coordination.

**User.** Friend groups (4–10), startup teams doing offsites, college clusters. Group admin = buyer; everyone else respondent.

**Headline flow.**
1. Group admin invites `@chaical` to Slack channel or WhatsApp group
2. *"chaical Friday 8pm Bandra ₹800/head"* → bot DMs everyone for cuisine + dietary prefs
3. Constraint solver picks 3 candidate Dineout restaurants matching ≥80% prefs within budget
4. Group votes via emoji react → top pick wins
5. Bot calls `book_table` → posts confirmation card

**Out of scope (v1).** Paid deposits. Cross-platform restaurants (Swiggy-only per ToS R5). Bill splitting.

**Success metrics.**
- ≥70% polls resolve to booking
- p95 time-to-decision <4h
- ≥2 repeat bookings per group per quarter

**Tech surface.**
- Frontend: Next.js admin dashboard + group history.
- Backend: Slack Bolt SDK + Gupshup WhatsApp on Vercel serverless.
- Agent: LangGraph with 3 nodes — PreferenceCollector, Resolver (constraint solver, not LLM), Booker.
- Storage: Neon Postgres (groups, polls, votes, bookings).
- LLM: Groq Llama 3.3 70B for parsing free-text DM replies into structured (cuisine, max₹, veg/non-veg).

**MCP tools used:** `search_restaurants_dineout`, `get_restaurant_details`, `get_available_slots`, `book_table`, `get_booking_status`.

**Critical product rule.** Use Zod enums for cuisine/dietary categories — LLMs drift into 50-cuisine hallucinations. Constraint solver is plain TypeScript logic, not an LLM.

**Pre-build (Claude Desktop, 30 min):**
- Run `search_restaurants_dineout` + `get_available_slots` for a real Friday-night slot
- Capture how slots/availability are structured; save as fixtures
- Confirm `book_table` works on a free reservation (cancel via app after)

**Build checklist (3 weekends, ~36h):**
- [ ] Slack app manifest + OAuth + bot in workspace
- [ ] Gupshup WhatsApp Business sandbox
- [ ] Next.js dashboard with poll history
- [ ] PreferenceCollector node fanning out DMs
- [ ] Constraint solver picking 3 candidates from `search_restaurants_dineout`
- [ ] Emoji-react vote tally
- [ ] `book_table` with idempotency key
- [ ] Powered by Swiggy on confirmation card
- [ ] Deploy `chaical.in`

**Day-1 prompt (Claude Code):**
> "Read CLAUDE.md. Build a Slack + WhatsApp group coordinator bot using Slack Bolt SDK and Gupshup. Trigger: `chaical <day> <time> <area> <budget>`. Fan out DMs collecting cuisine + dietary preferences, parse with Groq Llama 3.3 70B into Zod-validated structured output (hard enums). Run a TypeScript constraint solver against Swiggy Dineout MCP `search_restaurants_dineout` results to pick top 3 candidates. Post candidates as emoji-vote message. On vote close, call `book_table` with idempotency key. Stack: Next.js, Neon Postgres, LangGraph.js. Domain: `chaical.in`."

---

# Project 4 — Bharat Pantry

> **One-line.** WhatsApp bot that learns each household's grocery rhythm and re-orders from Instamart before stocks run out.

## PRD

**Problem.** Quick commerce is reactive ("we're out of dahi") not predictive. Indian households have stable consumption cadences but apps don't model them.

**User.** Indian working-couple households (25–45) with toddlers/elderly parents. WhatsApp-native. ARPU ₹99–199/month.

**Headline flow.**
1. Onboarding: user texts a fridge photo + "we're 2 adults, 1 toddler" → Gemini Vision extracts inventory, agent seeds baseline
2. User texts "ran out of dahi" → agent logs consumption event with timestamp
3. Daily cron: agent predicts items depleting in next 48h → drafts Instamart cart → sends *"Bhabhi, dahi + atta + eggs khatam ho rahe hain. ₹340 cart ready, confirm?"*
4. User taps ✅ → 3-gate flow → COD Instamart order
5. Weekly digest: spending pattern + "you saved 12 minutes/week"

**Out of scope (v1).** Brand-loyalty optimization. Family-sharing. Subscriptions (Instamart MCP doesn't expose them).

**Success metrics.**
- ≥60% of predicted carts confirmed
- ≥1 order/week per active household after 30 days
- ≥40% activation: signup → first confirmed cart in week 1

**Tech surface.**
- Frontend: Next.js admin (household setup, consumption log review).
- Backend: FastAPI on Fly.io (Mumbai) for prediction model + cron — Vercel serverless not ideal for stateful prediction loops.
- Agent: LangGraph with 4 nodes — InventoryEstimator (Gemini Vision), ConsumptionLogger, Predictor (statistical), Orderer.
- Storage: Neon Postgres (household, consumption events, predictions, orders), pgvector for SKU substitutions.
- LLM: Gemini 2.5 Flash for fridge photos; Groq Llama 3.3 70B for chat; Haiku for warm "bhabhi" tone.

**MCP tools used:** `search_products`, `update_cart`, `get_cart`, `checkout`, `track_order`, `get_orders` (with known `DASH` bug — fall back to local order log).

**Critical engineering note.** The Predictor is a Poisson / exponential-decay model per SKU per household, not an LLM call. Prediction must be reproducible and auditable.

**Why Builders Club approval is near-certain.** Swiggy's developers page literally lists *"Auto-Restock — Instamart agent that learns household consumption patterns"* as a sample idea.

**Pre-build (Claude Desktop, 1h):**
- Run `search_products` for "dahi", "atta", "eggs" — capture brand variants + price ranges
- Run `update_cart` + `get_cart` end-to-end with 5 SKUs
- Save full Instamart fixture set via Cowork; this is your offline dev seed

**Build checklist (4–6 weekends, ~50h):**
- [ ] FastAPI + Fly.io Mumbai deploy
- [ ] Next.js admin on Vercel
- [ ] Gupshup WhatsApp inbound
- [ ] Gemini Vision fridge-photo extractor → Zod-validated inventory schema
- [ ] Postgres schema: households, sku_catalog, consumption_events, predictions, orders
- [ ] Poisson predictor with daily QStash cron
- [ ] Cart drafter using `search_products` with substitution fallback (pgvector)
- [ ] 3-gate confirmation (calorie gate → budget gate)
- [ ] DPDP-grade household consent flow
- [ ] Razorpay UPI Autopay for ₹99/month subscription
- [ ] Powered by Swiggy on every cart preview
- [ ] Deploy `bharatpantry.in`

**Day-1 prompt (Claude Code):**
> "Read CLAUDE.md. Scaffold a FastAPI backend deployed to Fly.io Mumbai + Next.js admin on Vercel. Build a LangGraph agent with 4 nodes: InventoryEstimator (Gemini 2.5 Flash vision on WhatsApp-uploaded fridge photos), ConsumptionLogger (Groq parsing 'ran out of X' messages), Predictor (TypeScript Poisson model per SKU per household — NOT an LLM), Orderer (Swiggy Instamart MCP). Postgres schema: households, sku_catalog, consumption_events, predictions, orders. Use pgvector for SKU substitution lookups. Daily QStash cron triggers prediction → WhatsApp draft. 3-gate confirmation before `checkout`. Razorpay subscription at ₹99/mo. Domain: `bharatpantry.in`. Use fixtures in `/fixtures/swiggy/instamart/` for offline dev."

---

# Project 5 — Saans

> **One-line.** A phone number you call and speak Hindi/Telugu/Tamil/Bengali to — biryani arrives.

## PRD

**Problem.** 600M Indians don't fluently use English LLMs. Voice + regional languages is the only inclusive commerce surface. ChatGPT and Claude structurally cannot become a phone number.

**User.** Tier 2/3 city Indians, elderly users in metros, anyone whose primary language isn't English. Strong PMF signal: any Indian's parents.

**Headline flow.**
1. User dials a Twilio number
2. *"Namaste, kya order karna hai?"* (or Tamil/Telugu/Bengali variant)
3. User: *"Paradise se chicken biryani, ek plate"*
4. Sarvam STT → LangGraph → `search_restaurants` + `search_menu` → cart built
5. TTS: *"Paradise Special Biryani, ₹449. Total ₹489. Confirm?"*
6. User: *"Haan"* → 3-gate voice confirmation → `place_food_order`
7. SMS receipt with order ID + Powered by Swiggy

**Out of scope (v1).** Voice authentication / payments (COD-only is a feature here). Mid-call language switching. Group orders.

**Success metrics.**
- ≥70% intent recognition on first turn
- ≥50% call → completed order rate
- p95 turn latency ≤2.5s
- ≥2 user languages supported in v1 beta

**Tech surface.**
- Frontend: Next.js minimal landing + admin (call logs, transcripts).
- Backend: FastAPI on Fly.io Mumbai for the agent loop; Twilio Programmable Voice for telephony.
- Agent: LangGraph with 2 nodes — Listener (STT + intent parse) and Speaker (action + TTS).
- Storage: Neon Postgres (call logs, transcripts), Upstash Redis (turn state).
- LLM: Sarvam-1/Sarvam-2 for ASR + TTS (Indic-tuned, only realistic choice); Groq Llama 3.3 70B for intent + tool calling; Haiku for natural conversational repair.
- Telephony: Twilio inbound → media stream → FastAPI WebSocket → Sarvam → LangGraph → Sarvam TTS → back to Twilio.

**MCP tools used:** `search_restaurants`, `search_menu`, `update_food_cart`, `get_food_cart`, `place_food_order`, `track_food_order`. Optionally Instamart for "kirana on call" extension.

**Critical engineering note.** Latency budget is brutal. Per turn: 200ms ASR + 300ms intent + 600ms MCP search + 400ms TTS + 200ms network = 1.7s. Use streaming everywhere. Pre-warm agent state cache on call connect.

**Why this is the portfolio bomb.** Multilingual + voice + agentic + commerce = exact JD bullets at Sarvam, Krutrim, Anthropic India, Razorpay, Bhashini. Open-source the LangGraph + Sarvam + MCP adapter and inbound interview offers land within two weeks.

**Pre-build (Claude Desktop, 1.5h):**
- Run a complete Hindi-language order flow inside Claude Desktop chatting with Swiggy Food MCP — type Hindi/Hinglish queries, see how the agent handles them
- This validates that LLM tool-calling works on Hinglish before you commit to building voice infra
- Capture transcripts via Cowork for use as eval dataset

**Build checklist (6–8 weekends, ~80h):**
- [ ] Twilio number purchased + Programmable Voice configured
- [ ] FastAPI WebSocket endpoint for Twilio Media Streams
- [ ] Sarvam ASR + TTS integration (Hindi first, then Tamil/Telugu/Bengali)
- [ ] LangGraph Listener + Speaker nodes
- [ ] Streaming Groq tool-calling against Swiggy MCP
- [ ] Conversational repair flows ("kya bola?", "ek baar phir bolo")
- [ ] 3-gate voice confirmation
- [ ] SMS receipt via Twilio
- [ ] Call recording with consent disclosure (DPDP)
- [ ] Powered by Swiggy verbal disclosure in greeting
- [ ] Deploy `saans.in`
- [ ] HN Show HN + LinkedIn launch + Sarvam team DM

**Day-1 prompt (Claude Code):**
> "Read CLAUDE.md. Set up a FastAPI WebSocket server on Fly.io Mumbai for Twilio Programmable Voice Media Streams. Wire: Sarvam ASR streaming → LangGraph agent (Groq Llama 3.3 70B with Swiggy Food MCP tools) → Sarvam TTS → back to Twilio. Hindi first; architecture must support Tamil/Telugu/Bengali via config. Implement 3-gate voice confirmation before `place_food_order`. Add conversational repair (clarify, confirm, repeat). Postgres for call logs + transcripts. Strict latency budget per turn: 2.5s — use streaming everywhere, pre-warm state on call connect. Greet with: 'Namaste, Powered by Swiggy. Kya order karna hai?' Domain: `saans.in`."

---

## Today's Move

1. **Set up Claude Desktop** with the three Swiggy MCP servers (15 min). Run one real order. Validate the platform works for you.
2. **Open Claude Code** in a fresh repo. Drop this `CLAUDE.md` at root. Paste the **Last Bite Day-1 prompt** verbatim.
3. **Open Cowork** on a second monitor. Have it organize captured fixtures into `/fixtures/swiggy/food/`, draft your Builders Club application narrative from the templates, and queue the Monday submission email.
4. Ship Last Bite by Sunday night. Demo video Monday. Builders Club application Monday afternoon.
5. While waiting for approval, start Bharat Pantry next weekend on personal MCP. Trail and ChaiCal slot in opportunistically. Saans waits for production OAuth.

**Compounding principle:** each project reuses ~60% of the previous one's `SwiggyClient`, LangGraph supervisor pattern, 3-gate confirmation flow, fixtures, and DPDP boilerplate. Build the first one slowly and well in Claude Code. The next four are remixes.
