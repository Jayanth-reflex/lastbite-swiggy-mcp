# Deployment

Vercel-hosted Next.js 16. Linked project under `jayanth-reflexs-projects/swiggy-mcp`. Production URL: [swiggy-mcp.vercel.app](https://swiggy-mcp.vercel.app). Auto-deploy on push to `main`; manual deploy via `npx vercel deploy --prod --yes`.

This doc covers env vars, the deploy flow, and the post-deploy verification checklist. For incident response after a deploy, see [RUNBOOK.md](./RUNBOOK.md).

---

## Required env vars (production)

Group by what they serve. All set via `npx vercel env add <name> production`. Secrets get the `Sensitive` flag automatically — `vercel env pull` returns them empty for security; the actual value is still injected at runtime.

### Crypto

| Var | Purpose | Notes |
|---|---|---|
| `BYOC_ENCRYPTION_KEY` | Master key for all AES-256-GCM encryption (BYOC tokens, session cookies, OAuth state) | ≥32 chars. Generate with `openssl rand -hex 32`. **Rotating this rotates everything; every user is force-reconnected.** Per-purpose subkeys derived via scrypt. |

### LLM providers

| Var | Purpose | Notes |
|---|---|---|
| `GROQ_API_KEY` | Intent parsing via `openai/gpt-oss-20b` (free tier on Groq) | Required. Without it, every chat returns "AI parser misconfigured (server-side)". Get from console.groq.com/keys. |
| `ANTHROPIC_API_KEY` | Optional; gate copy via `claude-haiku-4-5` | If unset, falls back to heuristic boilerplate gates. Logs `agent.persona.fallback` so you know when this is happening. |
| `LASTBITE_INTENT_MODEL` | Override for the Groq intent model | Default `openai/gpt-oss-20b`. Must support `json_schema` response format. |
| `LASTBITE_PERSONA_MODEL` | Override for the persona model | Default `claude-haiku-4-5`. |
| `LASTBITE_AGENT_MODEL` | Reserved for any future agentic LLM tool-loop (currently unused — agent is deterministic) | Optional. |

### Storage

| Var | Purpose | Notes |
|---|---|---|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Upstash Redis (token storage, idempotency, mutex, mode prefs, dedup) | Use the Marketplace integration to provision. The `KV_*` names are Vercel's defaults; `lib/redis.ts` also accepts `UPSTASH_REDIS_REST_*` aliases. |
| `DATABASE_URL_UNPOOLED` | Neon Postgres for LangGraph checkpointer | **Must be the unpooled / non-pooling URL.** PgBouncer's transaction pooler breaks LangGraph's prepared statements. The `lib/agent/checkpointer.ts` env precedence falls back to `POSTGRES_URL_NON_POOLING`, `DATABASE_URL`, etc. |
| `LASTBITE_PG_URL` | Optional explicit override for the checkpointer connection string | Takes precedence over the auto-injected Neon ones. |
| `LASTBITE_PG_POOL_MAX` | Cap on the pg.Pool size per lambda | Default `2`. Raise carefully — Fluid Compute concurrency multiplies this across instances. |

### Safety / mode

| Var | Purpose | Notes |
|---|---|---|
| `LB_REAL_ORDERS` | **Master kill switch.** Set to `1` to allow any real Swiggy order to fire. | Without this, every confirmed order is a demo. Defense layer 1; see [SAFETY.md](./SAFETY.md). |
| `LB_ADMIN_SECRET` | Bearer for `/api/admin/*` endpoints (server-side test, list orders) | Pick a long random string. Required only if you use the admin endpoints. |
| `BYOC_DEV_TOKEN` | If set, `getByocToken` returns this for every user (dev only) | **Do NOT set on prod.** |
| `USE_FIXTURES` | If `1`, `SwiggyClient` reads `/fixtures/swiggy/<surface>/<tool>.json` instead of calling Swiggy MCP | Dev / smoke test only. Off on prod. |
| `LASTBITE_OFFLINE` | If `1`, the searcher node short-circuits to a smoke cart (no MCP calls) | Smoke tests only. |

### Site / WhatsApp / misc

| Var | Purpose | Notes |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Public origin for the site | Used in metadata, OAuth redirect URI, WhatsApp callback link. Default falls back to `swiggy-mcp.vercel.app`. |
| `GUPSHUP_WEBHOOK_SECRET` | Shared secret on `/api/whatsapp` | **Required in production** — the webhook now fail-CLOSED returns `403` if unset. Set the same value as the `x-webhook-secret` header (or `?secret=` param) Gupshup is configured to send. |
| `GUPSHUP_SOURCE_PHONE` | The bot's WhatsApp number (used to build deep-links from `/connect/success`) | Optional but recommended once Gupshup is provisioned. |
| `CONNECT_INVITE_CODE` | If set, `/connect` requires this invite code in the form | Use to gate beta access. Off by default. |

### Currently NOT set on prod (deliberately)

- `GUPSHUP_WEBHOOK_SECRET`, `GUPSHUP_SOURCE_PHONE` — WhatsApp wiring exists in code but isn't provisioned. The webhook returns `403` accordingly. The `FORGET ME` channel-of-record is `email privacy@lastbite.fun` until this is set.

---

## Deploy flow

### Standard push-to-deploy

```bash
git push origin main
# Vercel auto-deploys. Takes ~45s.
```

### Manual deploy (faster path when you want to skip the GitHub round-trip)

```bash
npx vercel deploy --prod --yes
# Usually ~45-50s end-to-end.
```

### Pre-deploy checks (do these before anything risky)

```bash
npx tsc --noEmit          # type-check; should be silent
npm run smoke             # 8-scenario regression harness; should pass
rm -rf .next/types && npx next build   # production build; should report 17 routes
```

If any of those fail, do not push.

### Post-deploy verification

```bash
# Fast probe: every public route should be 200
for path in / /connect /privacy /opengraph-image /order/new; do
  printf "%s  " "$path"
  curl -s -o /dev/null -w "%{http_code}\n" "https://swiggy-mcp.vercel.app$path"
done

# BYOC endpoint should reject a fake token (it actually probes Swiggy MCP)
curl -s -X POST "https://swiggy-mcp.vercel.app/api/oauth/byoc" \
  -H "content-type: application/json" \
  -d '{"phone":"+919999999999","token":"fake-but-long-enough-to-pass-zod-min-validation"}'
# Expect: {"error":"That token didn't work against Swiggy MCP. ..."}

# Webhook should fail-closed in prod when GUPSHUP_WEBHOOK_SECRET is unset
curl -s -i -X POST "https://swiggy-mcp.vercel.app/api/whatsapp" \
  -H "content-type: application/json" -d '{}' | head -1
# Expect: HTTP/2 403
```

If any check fails, see [RUNBOOK.md](./RUNBOOK.md) for the matching scenario.

---

## Common deploy gotchas

### "Sensitive" env vars look empty in `vercel env pull`

This is by design — Vercel marks LLM keys / secrets as Sensitive and strips their values from `pull` output. The variable IS set at runtime; the local `.env.local` just shows `KEY=""`. To verify a value is set, check the dashboard or use `vercel env ls`.

(There's a confusing historical gotcha: in the May 2026 audit I initially misdiagnosed an empty pull as "key is unset" before the diagnostic deploy showed the actual error was "model doesn't support json_schema". See CHANGELOG entry for `1ce5371`.)

### Postgres pool exhaustion under Fluid Compute

If you see `connection limit exceeded` from Neon, raise `LASTBITE_PG_POOL_MAX` cautiously — but remember each Vercel instance has its own pool, so under high concurrency this multiplies. The `lib/agent/checkpointer.ts:setupPromise` race fix means a transient cold-start failure no longer poisons the lambda; it'll retry on the next request.

### Turbopack production hydration on motion entrance animations

Motion v12 + Next.js 16 turbopack: server-rendered `<motion.div initial=...>` elements occasionally stay stuck at `opacity:0` after hydration in production builds. We hit this on the landing hero and reverted the entrance motion to plain HTML; the chat page's motion is unaffected because those elements mount client-only after the `/api/me` fetch. If you add new motion entrance animations on a server component path, test the production build (`next build && next start`) before assuming dev fidelity.

### LangGraph + PgBouncer

Don't point the checkpointer at a pooled connection string. Use `DATABASE_URL_UNPOOLED` (or any non-pooling Neon variant). The transaction pooler shares connections across queries, which breaks LangGraph's prepared statements.

---

## What to do before the next major change

1. Read [SAFETY.md](./SAFETY.md). Confirm the change doesn't bypass any of layers 1–7.
2. Read the relevant section of [ARCHITECTURE.md](./ARCHITECTURE.md). Confirm you understand the data model.
3. Add a smoke scenario to `scripts/smoke.ts` that exercises the new path.
4. Run `npm run smoke && npx tsc --noEmit && rm -rf .next/types && npx next build`. All three must be green.
5. Push. Verify on prod with the post-deploy checks above.
6. Update [CHANGELOG.md](../CHANGELOG.md) with what shipped + commit hash.
