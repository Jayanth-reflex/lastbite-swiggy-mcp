# Safety model

Swiggy MCP orders are **COD-only and non-cancellable** — once `place_food_order` returns success, the food is on its way and the cash obligation is real. Last Bite's safety model is built on the assumption that any path which can fire that call must require deliberate human intent at multiple moments and survive the failure of any single layer. This document is the explicit contract.

The architecture that implements this contract is in [ARCHITECTURE.md](./ARCHITECTURE.md). The audit that hardened it is in [AUDIT_2026-05.md](./AUDIT_2026-05.md).

---

## Layer 1 — Server kill switch

`LB_REAL_ORDERS=1` env var. **No real Swiggy order can ever fire unless this is set on the deployment.** Demo mode is the default and is enforced inside the placer node before the `place_food_order` MCP call.

Where: `lib/agent/graph.ts` Placer node, via `effectiveMode()` in `lib/user-prefs.ts`.

If you accidentally promote a deploy without this env, the worst case is "site exists, but every confirmed order is a demo". No money lost.

## Layer 2 — Per-user mode preference

Even if the kill switch is on, each user must individually toggle to live via the chat UI's segmented Demo/Live toggle. The default for a fresh user is demo. The toggle persists in Redis under `mode:<phone>` for 30 days.

Switching to live triggers an `AlertDialog` (rose-accented, `<Dialog>` would be the wrong primitive — `AlertDialog` requires explicit confirmation) with the warning *"orders cannot be cancelled after they fire"*.

Where: `app/order/new/page.tsx:LiveModeDialog`, `app/api/me/mode/route.ts`, `lib/user-prefs.ts`.

## Layer 3 — Three confirmation gates

Every cart that gets to the placer has already passed three explicit gates:

1. **Calorie gate** — *"~1,100 kcal incoming for ₹489. Still go?"* — calorie estimate from `persona.estimateCalories` (real values from Swiggy when available, heuristic otherwise).
2. **ETA gate** — *"ETA 42 min, total ₹489. OK?"*.
3. **Final gate** — names the restaurant + total + announces the 30s grace timer.

Each gate uses LangGraph's `interrupt()` — the agent pauses, the chat re-prompts the user, the agent only resumes on an explicit `YES`. Anything that isn't classifiable as YES (per `classifyReply` in `lib/agent/schemas.ts`) re-prompts; anything classifiable as STOP cancels.

Where: `lib/agent/graph.ts` Confirmer node.

## Layer 4 — 30-second grace timer

After the final YES, a 30-second STOP window opens. The chat shows the timer. If the user types `STOP` (or any STOP-class reply) during that window, `cancelGrace` is called and the placer never fires. If they don't, the placer commits.

Where: `startGraceTimer` / `awaitGrace` / `cancelGrace` in `lib/redis.ts`. The `awaitGrace` poller has a 5-failure circuit breaker — five consecutive Redis read failures default to `"cancelled"` (we'd rather waste your time than your ₹500).

## Layer 5 — Idempotency

Per-day per-user-per-cart idempotency key:

```
sha256(userId + cart_hash + day_utc)
```

Set in Redis under `idem:<key>` with a 24h TTL. `consumeIdempotency` returns `false` on the second call within 24h, in which case the placer returns `status: "duplicate"` without firing. On a transient placer failure, the key is released so the user can retry.

Where: `consumeIdempotency` / `releaseIdempotency` in `lib/redis.ts`. The release path on the throw branch is wrapped in its own try/catch so a Redis hiccup during release doesn't replace the original Swiggy error in the user-facing message ([AUDIT §B1#1](./AUDIT_2026-05.md)).

## Layer 6 — Per-user mutex

Every inbound message acquires a per-user lock in Redis (`SETNX` with random token, 180s TTL). Concurrent inbounds for the same user fail fast with `UserBusyError`. Compare-and-delete on release prevents a stale delayed release from wiping a fresh acquirer's lock.

The TTL must outlive the longest possible turn (30s grace + ~30s MCP call + buffer); it was bumped from 90s → 180s in [AUDIT §B1#2](./AUDIT_2026-05.md) — the exact race that lost ₹321 the first time around.

Where: `acquireUserLock` / `releaseUserLock` in `lib/redis.ts`; `processTurn` in `lib/agent/runner.ts`.

## Layer 7 — Abandoned-thread auto-clear

If a user has a paused gate from > 30 minutes ago and sends a new message, the runner force-resumes the prior LangGraph thread with `STOP` (closes it cleanly) and treats the new message as a fresh query. Stops the user from waking up to find a "yes" reply finishing yesterday's order.

Where: `runner.ts` ABANDON_THRESHOLD_MS check, `getLastActiveAt` / `bumpLastActiveAt` in `lib/redis.ts`.

---

## Token handling

**At rest.** AES-256-GCM. Single env `BYOC_ENCRYPTION_KEY` (≥32 chars). Per-purpose subkeys derived via scrypt with a label, so rotating the env rotates all subkeys atomically. Stored in Redis under `byoc:<phone>` with a 30-day TTL.

**In transit (to Swiggy).** Bearer in the `Authorization` header on every MCP call inside `SwiggyClient`. Never echoed in responses. Never displayed back to the user.

**In logs.** `lib/redact.ts` strips any `Bearer ey…` substring before any `safeLog` emission. If a stray exception message contains a token (rare; the Swiggy MCP wrapper doesn't echo them, but defense-in-depth) it gets stripped automatically.

**Visibility on rotation.** `byoc.getByocToken` and `session.openSession` both `safeLog` on decrypt failure ([AUDIT §B1#3](./AUDIT_2026-05.md), §B2#13), so an accidental key rotation surfaces as a flood of `byoc.decrypt-failed` / `session.decrypt-failed` log lines instead of silently logging every user out.

---

## Webhook security

`/api/whatsapp` requires `GUPSHUP_WEBHOOK_SECRET` to be present and to match a header / query param. **Fail-CLOSED in production** (`VERCEL_ENV === "production"`) when the secret env is unset — returns `403`. Dev / preview fail-open with a log line so local testing isn't a config nightmare.

Verified live: `POST https://swiggy-mcp.vercel.app/api/whatsapp` without the secret returns `403`.

Where: `verifyWebhookSecret` in `app/api/whatsapp/route.ts`.

---

## Inbound message dedup

Gupshup occasionally retries inbound message delivery. `claimMessageId` uses `SETNX` on `msg:<gupshup_message_id>` with a 24h TTL — the second attempt within 24h is silently dropped. Stops the same `place this order` message from triggering two agent turns (which would race on the per-user mutex).

Where: `claimMessageId` in `lib/redis.ts`; consumed in `app/api/whatsapp/route.ts`.

---

## Money-not-lost invariants

Listed by the failure path they protect against:

| Invariant | Protected by |
|---|---|
| A demo build can never place a real order | Layer 1 (env kill switch) checked inside the placer |
| A confirmed user can never accidentally place a real order without a deliberate Live opt-in | Layer 2 (per-user mode) + Layer 3 (gates) + Layer 4 (grace) |
| A user typing fast can't queue two orders in parallel | Layer 6 (per-user mutex) + Layer 5 (idempotency) |
| A retry within 24h can't re-place a successful order | Layer 5 (idempotency, 24h TTL) |
| A Vercel function timeout mid-MCP-call can't allow a concurrent inbound to re-place | Layer 6 (TTL > maxDuration) + Layer 5 (idempotency upstream is also Swiggy-side) |
| A Redis blip during the grace timer can't accidentally commit | `awaitGrace` 5-failure circuit-breaker → `"cancelled"` |
| A `BYOC_ENCRYPTION_KEY` rotation can't silently force-reconnect everyone | `byoc.decrypt-failed` log signature surfaces it |
| A misclassified upstream error can't silently wipe a good token | Typed `SwiggyMcpError.kind === "auth"` is the primary check; word-boundary regex fallback only |
| A WhatsApp webhook with no secret on prod can't accept arbitrary payloads | Fail-CLOSED in production (`403`) |

---

## What is *not* protected

Honest about the gaps:

- **Network attacker on the Swiggy MCP side.** If Swiggy itself is compromised or someone MITMs `mcp.swiggy.com`, our model has no answer. Out of scope for a third-party agent.
- **Local clipboard stealing the BYOC token between Claude Desktop and `/connect`.** Standard browser/OS threat model; not something we can defend against from the server.
- **A user installing a malicious browser extension.** Same.
- **Server-side crypto-key compromise.** If `BYOC_ENCRYPTION_KEY` leaks, every stored token is decryptable. Mitigation: rotate the env, every user is force-reconnected (logged), and the ciphertexts become useless.
- **Swiggy decides to revoke a token mid-order.** The placer's catch + idempotency-release path handles this — the user gets "your token expired, please re-paste" and the cart is never charged.

---

## How to extend this safely

If you need to add a tool that can spend the user's money:

1. The call MUST be wrapped in the same two-layer kill switch (`LB_REAL_ORDERS` + per-user mode).
2. The call MUST be preceded by an `interrupt()`-gated explicit confirmation.
3. The call MUST be preceded by a grace timer with STOP.
4. The call MUST be wrapped in a `consumeIdempotency` / `releaseIdempotency` block, with the release wrapped in its own try/catch (per [AUDIT §B1#1](./AUDIT_2026-05.md)).
5. The call's catch path MUST NOT swallow — every error type the user could trigger needs a `safeLog` line.

If any of those five are skipped, the smoke tests in `scripts/smoke.ts` will not catch it. Add a new scenario for the new tool before merging.
