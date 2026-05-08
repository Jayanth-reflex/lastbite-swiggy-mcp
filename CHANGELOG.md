# Changelog

All notable changes to Last Bite. Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) but groups entries by ship session rather than semver — pre-1.0 the audience for these notes is the developer (and recruiters reading the repo), not external consumers.

The current state of the system is summarised in [README.md](./README.md). The audits and remediations referenced below are documented in [docs/AUDIT_2026-05.md](./docs/AUDIT_2026-05.md). The safety contract that the codebase tries to honour is in [docs/SAFETY.md](./docs/SAFETY.md).

---

## [unreleased] — 2026-05-09

### Fixed (silent failures, round 2)

The PR-review pass surfaced 18 silent-failure paths beyond the critical 4 already fixed. Round 2 closes the remaining 8 highest-impact ones:

- **`SwiggyMcpError.kind`** — typed classification (`"auth" | "rate-limit" | "not-found" | "address-stale" | "other"`) replaces stringly-typed substring matching at every call site. Word-boundary regex (`\b401\b`, not `401` anywhere) prevents body content like `"received 4015 bytes"` from triggering token wipes. (`lib/mcp/swiggy-client.ts`, `app/api/chat/route.ts:looksLikeAuthFailure`, `lib/agent/graph.ts:searcher`)
- **`IntentParseError.kind`** — `parseIntent` now wraps Groq failures in a typed error carrying `"timeout" | "rate-limit" | "config" | "schema" | "other"`. The searcher branches user-facing copy on the kind so a Groq outage no longer shows the user "couldn't understand that order"; operators see the actual misconfiguration in logs. (`lib/agent/intent.ts`, `lib/agent/graph.ts`)
- **PostgresSaver setup race** — `setupPromise` is cleared on rejection so a transient cold-start failure can't poison the lambda for the rest of its life. (`lib/agent/checkpointer.ts`)
- **Stale-address self-heal** — preserves the original error in both the operator log and the user-facing message even when the retry also fails; uses the typed `kind === "address-stale"` for detection with substring fallback. (`lib/agent/graph.ts`)
- **Schema-drift visibility** — `parseRestaurants`, `parseAddresses`, `extractFirstAddressId` log when the expected envelope shape is missing (kind + top-level keys), so a Swiggy response shape change shows up in operator logs instead of silently saying "no restaurants found" forever. (`lib/agent/graph.ts`)
- **WhatsApp webhook fail-CLOSED in production** — `verifyWebhookSecret` now returns `false` in `VERCEL_ENV === "production"` when `GUPSHUP_WEBHOOK_SECRET` is unset (was: returned `true`, accepting any payload). Dev / preview still fail-open with a log line. Verified live: `POST /api/whatsapp` without secret → **403**. (`app/api/whatsapp/route.ts`)
- **`req.json().catch(() => null)`** across `/api/chat`, `/api/oauth/byoc`, `/api/oauth/start`, `/api/whatsapp` now log parse failures.
- **Misc swallow → log** — `swiggy-client.close()`/`validate()` close, `validate()` failure classification, OAuth callback `registerClient` catch, FORGET_ME `cancelGrace` + `sendWhatsApp`, `awaitGrace` Redis polling (with 5-failure circuit-breaker that bails out as `"cancelled"` — safer default than committing on a Redis blip).

### Added — `docs/`

CHANGELOG, AUDIT, ARCHITECTURE, SAFETY, RUNBOOK, DEPLOYMENT (this commit).

**Commits:** [`d1b52da`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/d1b52da)

---

## 2026-05-08 (PM)

### Fixed (silent failures, round 1)

The `/pr-review-toolkit:review-pr` audit caught 4 critical silent failures in hot paths and 8 user-facing copy lies. This commit fixes the bleeding edge:

- **Placer idempotency release race** — on a Swiggy MCP failure, `await releaseIdempotency(idemKey)` could itself throw and replace the original error in the user-facing message. Wrapped in its own try/catch + log. The original Swiggy error always propagates. (`lib/agent/graph.ts`)
- **User mutex TTL** — bumped 90s → 180s. Old TTL could expire before a slow placer finished, allowing a concurrent inbound to enter mid-flight to Swiggy MCP. This is the class of race that lost ₹321 once. The idempotency key still prevents true double-place upstream, but defense-in-depth. (`lib/redis.ts`)
- **`byoc.getByocToken` decrypt swallow** — silent failure on `BYOC_ENCRYPTION_KEY` rotation would force-reconnect every user without any operator signal. Now logs `byoc.decrypt-failed`. (`lib/byoc.ts`)
- **`session.openSession` decrypt swallow** — same key-rotation visibility fix; now logs `session.decrypt-failed`. (`lib/session.ts`)
- **`agent.persona.gatePrompt` Anthropic swallow** — a misconfigured `ANTHROPIC_API_KEY` would silently fall through to boilerplate copy for every gate. Now logs `agent.persona.fallback`. (`lib/agent/persona.ts`)
- **`/api/chat` `clearByocToken` bare catch** — Redis outages during token wipe were invisible. Replaced with `safeLog("chat.clear-byoc-failed")`. (`app/api/chat/route.ts`)

### Changed (honest copy)

The site's first concrete instruction read: *"Authorize Swiggy MCP once in Claude Desktop, paste the bearer token here. We seal it AES-256 and never see your OTP."* — assuming Claude Desktop is universal. CLAUDE.md's stated audience is "non-tech friends, no manual setups", so the copy excluded the intended audience. Multiple surfaces over-claimed:

- **Hero**: amber `"Developer beta · requires Claude Desktop"` badge + an explicit "Honest beta caveat" paragraph. AES-256 marketing pill removed (security theater on a consumer landing).
- **`how-it-works` step 1**: reframed from "Authorize…" to BYOC reality with timing.
- **FAQ**: dropped "~3 minute setup" lie (closer to 10–15 min); explained *why* the BYOC step exists rather than presenting it as a feature.
- **Trust-band**: dropped AES-256 pill; honest data-deletion path (email, since WhatsApp inbound isn't provisioned in prod).
- **Connect page**: amber requirement banner + first sentence is "Be honest about the friction:".
- **`FORGET ME on WhatsApp`**: was promised on 4 surfaces but no `GUPSHUP_*` env on prod. All references now lead with `email privacy@lastbite.fun` and honestly note WhatsApp wipe is "wired but not provisioned in prod yet".
- **`/order/[id]`**: dropped the "Live tracking lands when Trail (Project 2) ships" codename.
- **README**: WhatsApp status row corrected from "stub" to "wired-but-not-provisioned".

**Commits:** [`287650c`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/287650c)

---

## 2026-05-08 (motion polish)

### Added — motion + user-psychology pass

- `motion` (Framer Motion v12) installed for spring animations.
- `lib/motion.ts` — shared `spring.{snappy, gentle, cushion}` presets so every surface feels related.
- `hooks/use-streamed-text.ts` — word-by-word reveal of bot replies. Pure cosmetic, but reads as "thinking out loud" instead of "loading".
- Time-aware greeting on `/order/new` ("Late night?" / "Good morning." etc.).
- iOS-style segmented mode toggle with `LayoutGroup` + `layoutId` sliding indicator.
- Composer shimmer while pending.
- Tabular numerals on currency / IDs / timers.
- Custom slim scrollbar.
- CSS-only `orb-drift` brand-glow on the hero.

### Fixed

- **Landing entrance animations reverted to plain HTML** — motion v12 + Next 16 turbopack production builds left server-rendered motion elements stuck at `opacity:0` after hydration. Three workarounds attempted (`useMounted` gate, plain-div fallback, `whileInView`). Cleanest fix: revert landing to plain HTML server components and keep motion only on the chat page where elements mount client-only after the `/api/me` fetch.
- **CommandDialog crashing the React tree** — shadcn-generated `CommandDialog` was missing its `<Command>` root wrapper. Clicking the Cmd+K button crashed Chrome's renderer process. Patched: `<DialogContent><Command>{children}</Command></DialogContent>`.

**Commits:** [`918a296`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/918a296), [`d25d97c`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/d25d97c), [`c8b0ee0`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/c8b0ee0), [`d0a31c2`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/d0a31c2)

---

## 2026-05-08 (10/10 UI pass)

### Added — real shadcn primitives + dark mode default

- `next-themes` with `defaultTheme="dark"` (per shadcn/Vercel guidance for AI apps); `ThemeToggle` in header.
- `TooltipProvider` + Sonner `Toaster` at the root layout.
- shadcn primitives installed: `alert-dialog`, `dialog`, `sheet`, `tooltip`, `tabs`, `command`, `sonner`, `skeleton`, `dropdown-menu`, `scroll-area`, `label`, `input`, `textarea`, `avatar`.
- `AlertDialog` (not `Dialog`) for the live-mode switch confirmation, with rose accent + "orders cannot be cancelled after they fire" warning.
- Sonner toasts for mode switches and errors.
- Cmd+K Command palette with example queries + YES/STOP gate replies.
- Bot avatar on assistant + pending bubbles.
- Pulsing emerald connected-status indicator.

### Fixed

- **`@theme inline` font-sans circular reference** — `--font-sans: var(--font-sans)` was self-referential, making display headings fall back to browser-default Times serif. Fixed to point to `--font-geist-sans`.

**Commits:** [`839af66`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/839af66)

---

## 2026-05-08 (intent fix)

### Fixed — production chat was broken end-to-end

Chat was returning the generic "Couldn't understand that order" for every query because `parseIntent()` was throwing silently. AI SDK v6's `generateObject` defaults to `response_format: { type: "json_schema" }`, which neither `llama-3.1-8b-instant` nor `llama-3.3-70b-versatile` accept on Groq. Switched intent model to `openai/gpt-oss-20b` (Groq, free tier, supports json_schema) with `providerOptions: { groq: { structuredOutputs: true, strictJsonSchema: false } }` — the strict mode rejects schemas with `.default()` properties, which our Zod `qty` field has.

**Commits:** [`1ce5371`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/1ce5371), [`112d340`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/112d340)

---

## 2026-05-08 (BYOC bridge)

### Added

- `POST /api/oauth/byoc` — accepts `{phone, token}`, validates the token via `SwiggyClient.validate()` (probes Swiggy's `/tools/list`), encrypts AES-256-GCM, sets the session cookie. Mirrors the post-OAuth-callback storage path exactly.
- `/connect` rewritten as a token-paste form with show/hide eye toggle and an expandable "How do I get the token from Claude Desktop?" walkthrough.
- Filed [Swiggy/swiggy-mcp-server-manifest#53](https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53) to request whitelist of `swiggy-mcp.vercel.app/api/oauth/callback`.

### Removed (functionally — code kept)

OAuth start/callback routes still in the codebase but `/connect` no longer points to them. Reason: Swiggy added a client whitelist on their MCP auth server (~2026-05-07) that blocks our Vercel-hosted redirect URI. Whitelist queue is months-deep based on issue history; only Poke has been approved through the GitHub-issue path. The day Swiggy whitelists us, switching back is a one-line UI swap.

**Commits:** [`9655aa1`](https://github.com/Jayanth-reflex/lastbite-swiggy-mcp/commit/9655aa1)

---

## Earlier

The repository's pre-changelog history — `git log --oneline` — covers the original scaffold, the per-user mode toggle, the AI-driven intent + recommendations refactor, and the foundational LangGraph supervisor with three gates and the 30s grace timer. Some highlights worth knowing:

- **2026-05-07 evening:** ₹321 lost to a placer race. Regression test added. Two-layer demo guard introduced (env kill switch + per-user mode preference).
- **2026-05-07 (earlier):** Full OAuth 2.0 + PKCE + RFC 7591 dynamic client registration against `mcp.swiggy.com/auth/*`, confirmed working. Worked for ~24h before Swiggy added the whitelist gate.
- **Initial ship:** Next.js 16 App Router, Tailwind v4, shadcn primitives, LangGraph 1.3 with `interrupt()` gates, Upstash Redis (token storage, idempotency, mode prefs, rate limit, message dedup), Neon Postgres (LangGraph checkpoints), `@ai-sdk/mcp` Swiggy client, AsyncLocalStorage for request-id correlation, Zod schemas for structured AI output.
