# Runbook

Operational reference for "the site is broken / what do I do." Each scenario lists a symptom, the most likely cause, a one-shot diagnostic, and the fix.

The architecture this references is in [ARCHITECTURE.md](./ARCHITECTURE.md). The full log signature catalog is at the bottom.

---

## Scenario: "Nothing is working — every order says 'Couldn't understand'"

**Most likely:** Groq intent parser is down or `GROQ_API_KEY` was rotated/cleared.

**Diagnose.** Open Vercel logs and grep for `agent.searcher.intent-failed`. The new log line includes `kind`:

```
agent.searcher.intent-failed { kind: "config", message: "Invalid API key" }
agent.searcher.intent-failed { kind: "rate-limit", message: "429: Too many requests" }
agent.searcher.intent-failed { kind: "timeout", message: "Aborted after 15000ms" }
agent.searcher.intent-failed { kind: "schema", message: "response did not match schema" }
```

**Fix by kind.**
- `config` → `npx vercel env rm GROQ_API_KEY production --yes && echo -n "<new key>" | npx vercel env add GROQ_API_KEY production && npx vercel deploy --prod --yes`. Test directly: `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer <key>"` → expect 200.
- `rate-limit` → check daily Groq quota at console.groq.com. The free tier has a soft cap; if hit, switch `LASTBITE_INTENT_MODEL` to a different supported model (see [ARCHITECTURE.md](./ARCHITECTURE.md#performance--cost-shape)).
- `timeout` → Groq slow / Vercel cold start. Usually transient. If sustained, increase `LASTBITE_INTENT_MODEL` to a faster shape (or `AbortSignal.timeout` in `lib/agent/intent.ts`).
- `schema` → the model is returning JSON that fails Zod. Check if the Zod schema in `lib/agent/intent.ts` was changed recently; consider adding `strictJsonSchema: false` (already on) or relaxing the schema.

If you don't see any `agent.searcher.intent-failed` lines but users still report "couldn't understand", the issue isn't Groq — check `agent.searcher.addresses-error` next.

---

## Scenario: "I (or a user) am stuck at 'Your Swiggy connection expired'"

**Most likely:** Swiggy invalidated the token (24h Swiggy lifespan, or revocation). The chat detected an upstream auth failure and wiped it.

**Diagnose.** Vercel logs:

```
chat.token-expired { userId: "+91…2869" }
```

This is the success case — the new expired-token UX is working as designed.

**Fix.** Re-paste a fresh token at `/connect`. To get a fresh token:
1. Open Claude Desktop
2. Run any Swiggy MCP tool call (e.g. `/mcp` to confirm connection, then ask Claude to search restaurants)
3. Claude Desktop refreshes the OAuth token under the hood
4. Pull the new `access_token` from `~/Library/Application Support/Claude/`'s OAuth blob
5. Paste at `/connect`

If users without expired tokens are getting redirected, look for `swiggy.validate-failed` in logs — distinguishes "Swiggy outage" from "bad token".

---

## Scenario: "All users were force-reconnected this morning"

**Most likely:** `BYOC_ENCRYPTION_KEY` was accidentally rotated.

**Diagnose.** Vercel logs:

```
byoc.decrypt-failed { phone: "+91…2869", message: "Unsupported state or unable to authenticate data" }
session.decrypt-failed { message: "Unsupported state or unable to authenticate data" }
```

A flood of these = key rotation. Single one = corrupted ciphertext for that user (rare).

**Fix.** Either:
- Restore the previous `BYOC_ENCRYPTION_KEY` value if you have it (rolls everyone back transparently).
- Or accept the rotation: every user has to re-paste at `/connect`. Send them a heads-up.

To prevent this, treat `BYOC_ENCRYPTION_KEY` as "never change unless intentional rotation". Per-purpose subkeys (scrypt-derived) mean rotating BYOC also rotates session cookies, OAuth state, etc. — there's no partial rotation.

---

## Scenario: "An order was placed but the user says they didn't confirm"

**Highest priority. Money on the line. The previous incident lost ₹321 to this class.**

**Diagnose.** Find the order in logs by `userId` or `orderId`:

```
agent.placer.demo-mode { userId: ... }              ← demo, no real order, false alarm
agent.placer.result { userId: ... }                  ← real order placed
agent.placer.error { userId: ..., message: ... }     ← MCP threw
agent.placer.idem-release-failed { ... }             ← release error (rare)
agent.placer.final-gate-cancelled { ... }            ← STOP at final, did NOT place
```

If you see `agent.placer.result`, the order was placed by the agent. Check the chain:
- Did `agent.searcher.start`, `agent.searcher.intent`, gate prompts, and `agent.placer.result` all share the same `requestId`? If yes, the user did go through gates and grace.
- If the gate prompts have different `requestId`s and the placer fired without a corresponding fresh user gate trail → race condition. **This is the ₹321 bug class.** Check Layer 6 (mutex) — confirm `acquireUserLock` TTL is still 180s and the placer trail doesn't span multiple lambda invocations.

**Mitigation post-incident.**
1. The user is already on the hook for the COD. There's no programmatic refund path.
2. Identify the cart and reach out apologetically. CLAUDE.md tone: "We owe you. Let me know how to make this right."
3. Add a regression test to `scripts/smoke.ts` for the specific failure mode.
4. Open a CHANGELOG entry under "Fixed" and link the incident.

---

## Scenario: "WhatsApp webhook returns 403 in production"

**Most likely:** `GUPSHUP_WEBHOOK_SECRET` is unset on prod.

**Diagnose.**

```
whatsapp.webhook.secret-missing { rejected: true }
```

This is the **expected** behaviour after the May 2026 audit — fail-CLOSED in production when the secret is unset.

**Fix.** Set the env:

```bash
echo -n "<secret>" | npx vercel env add GUPSHUP_WEBHOOK_SECRET production
```

Then configure Gupshup to send the same secret as `x-webhook-secret` header (or `?secret=` query param). Redeploy.

---

## Scenario: "Site loads but the chat returns 500"

**Diagnose.** `chat.error` log line includes the message. Common cases:

- `redis.io ENOTFOUND` → Upstash unreachable. Check status.upstash.com.
- `pg.connection terminated unexpectedly` → Neon Postgres flapped. The `PostgresSaver.setup()` race fix means the next request will retry instead of awaiting a poisoned promise. Wait 30s, retry. If sustained, check Neon dashboard.
- `swiggy.connect` followed by silence → Swiggy MCP server is slow or refusing. Check `swiggy.close-failed` for socket leaks.
- Anything else → grep `chat.error` and triage based on message.

---

## Scenario: "Users get 'No saved Swiggy address found' but they have addresses"

**Most likely:** Swiggy MCP `get_addresses` is failing or returned an unexpected shape.

**Diagnose.** Look for either:

```
agent.searcher.addresses-error { message: "..." }       ← MCP threw
agent.parse.addresses.shape { kind: "string" }          ← unexpected payload type
agent.parse.addresses.no-list { topKeys: [...] }        ← envelope shape changed
```

If you see `addresses-error`, the user is now correctly told *"Couldn't reach Swiggy to load your saved addresses. Try again in a minute."* — not the misleading "add an address in the Swiggy app" message.

If you see `agent.parse.addresses.no-list`, **Swiggy changed their response envelope.** Open `lib/agent/graph.ts:parseAddresses`, inspect the `topKeys` from the log, and add the new key path.

---

## Scenario: "OAuth /api/oauth/start succeeds but callback bounces back"

(Note: legacy OAuth route, not currently wired in `/connect`. Reserved for the day Swiggy whitelists us.)

**Diagnose.** `oauth.callback.*` log signatures:

```
oauth.callback.state-bad { message: "..." }              ← cookie tampered / expired
oauth.callback.register-failed { message: "..." }        ← Swiggy DCR refused us
oauth.callback.exchange-failed { status: 400, body: ... } ← Swiggy refused the auth code
```

For `register-failed` — likely Swiggy's whitelist check kicking in. If [issue #53](https://github.com/Swiggy/swiggy-mcp-server-manifest/issues/53) is still open, this is expected; the user should be using the BYOC path at `/connect` instead.

---

## Scenario: "Orders are mysteriously taking 60s+ to commit"

**Most likely:** Swiggy MCP `place_food_order` is slow.

**Diagnose.** Check `agent.placer.result` timestamps relative to `agent.placer.demo-mode` (or grace start). The 30s grace timer + a 30s+ MCP call = a 60s window where the user's screen says "working on it". Grace polling logs `grace.poll.redis-failed` with `consecutiveFailures` count if Redis is also struggling.

If the placer call exceeds 60s, Vercel kills the function but the lock has a 180s TTL — so concurrent inbound is still rejected as `UserBusyError`. The order may or may not have landed Swiggy-side; the user should NOT be told "try again" until they confirm with Swiggy directly.

---

## Log signature catalog

Grep these in Vercel logs for fast triage. All emitted via `safeLog` in `lib/redact.ts` (which strips `Bearer ey…` automatically).

### Agent

| Signature | Where | Meaning |
|---|---|---|
| `agent.searcher.start` | searcher | One turn started |
| `agent.searcher.intent` | searcher | Parsed Zod intent (full JSON) |
| `agent.searcher.intent-failed` | searcher | Intent parser threw — see `kind` |
| `agent.searcher.addresses-error` | searcher | `get_addresses` MCP threw |
| `agent.searcher.address-tag-fuzzy` | searcher | User's `addressTag` matched approximately |
| `agent.searcher.address-refreshed` | searcher | Stale-address self-heal succeeded |
| `agent.searcher.address-retry-failed` | searcher | Stale-address self-heal failed (both errors logged) |
| `agent.parse.restaurants.shape` | parser | Unexpected response envelope (kind logged) |
| `agent.parse.restaurants.no-list` | parser | `restaurants` key missing (topKeys logged) |
| `agent.parse.addresses.shape` | parser | Unexpected response envelope |
| `agent.parse.addresses.no-list` | parser | Empty list — user truly has no saved addresses |
| `agent.parse.address.no-list` | parser | `addresses` key missing in single-address parser |
| `agent.placer.demo-mode` | placer | Demo placeholder fired (no Swiggy call) |
| `agent.placer.result` | placer | **Real order placed.** |
| `agent.placer.error` | placer | Placer MCP call threw |
| `agent.placer.idem-release-failed` | placer | Idempotency release threw on the catch path |
| `agent.placer.final-gate-cancelled` | placer | STOP at final gate |
| `agent.persona.fallback` | persona | Anthropic call failed → boilerplate gate copy |
| `agent.runner.abandoned-cleared` | runner | 30-min abandoned thread auto-cleared |

### BYOC + session

| Signature | Where | Meaning |
|---|---|---|
| `byoc.connect.ok` | byoc route | Token validated + persisted |
| `byoc.validate.error` | byoc route | Validation threw (Swiggy unreachable) |
| `byoc.persist.error` | byoc route | Redis SET threw |
| `byoc.json-parse-failed` | byoc route | Inbound body wasn't JSON |
| `byoc.decrypt-failed` | `lib/byoc.ts` | Stored ciphertext won't decrypt — likely key rotation |
| `session.decrypt-failed` | `lib/session.ts` | Session cookie won't decrypt — likely key rotation |
| `chat.json-parse-failed` | chat route | Inbound body wasn't JSON |
| `chat.token-expired` | chat route | Auth-failure detected, token wiped, redirected |
| `chat.clear-byoc-failed` | chat route | Redis DEL threw during expired-token wipe |
| `chat.error` | chat route | Generic 500 — see message |

### Swiggy MCP

| Signature | Where | Meaning |
|---|---|---|
| `swiggy.connect` | client | New MCP session opened |
| `swiggy.close-failed` | client | Close threw — possible socket leak |
| `swiggy.validate-failed` | client | Token probe failed — see message |
| `swiggy.validate.close-failed` | client | Probe's close threw |
| `swiggy.fixture` | client | Fixture mode (`USE_FIXTURES=1`) returned canned response |

### WhatsApp

| Signature | Where | Meaning |
|---|---|---|
| `whatsapp.inbound` | route | Inbound parsed, about to process |
| `whatsapp.json-parse-failed` | route | Inbound body wasn't JSON |
| `whatsapp.webhook.secret-missing` | route | **403 fail-closed in prod** — set `GUPSHUP_WEBHOOK_SECRET` |
| `whatsapp.webhook.secret-missing-dev` | route | Allowed in dev / preview, log only |
| `whatsapp.forget.grace-cancel-failed` | route | FORGET_ME path's grace cancel threw |
| `whatsapp.forget.send-failed` | route | FORGET_ME path's confirmation send threw |
| `whatsapp.error` | route | Generic 500 — see message |

### OAuth (legacy / dormant)

| Signature | Where | Meaning |
|---|---|---|
| `oauth.start` | start | Redirect URL built, sent to client |
| `oauth.start.register-failed` | start | DCR threw before authorize |
| `oauth.start.json-parse-failed` | start | Inbound body wasn't JSON |
| `oauth.callback.state-bad` | callback | Cookie state failed AES-GCM open |
| `oauth.callback.register-failed` | callback | Swiggy DCR refused us in callback |
| `oauth.callback.exchange-failed` | callback | Swiggy `/auth/token` refused |

### Redis primitives

| Signature | Where | Meaning |
|---|---|---|
| `grace.poll.redis-failed` | `lib/redis.ts` | One Redis read failed inside `awaitGrace` |
| `grace.poll.giving-up` | `lib/redis.ts` | 5 consecutive failures → returning `cancelled` (safe default) |
