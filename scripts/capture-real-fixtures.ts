/**
 * Capture real Swiggy MCP responses for /fixtures/swiggy/food/.
 *
 * Walks the standard OAuth 2.0 + PKCE + RFC 7591 dynamic client
 * registration dance, opens your browser at the consent URL, catches the
 * callback on http://localhost:53682, exchanges the code for an access
 * token, then exercises every read-only Food MCP tool. Skips
 * `place_food_order` and `track_food_order` to avoid charging you and
 * because we don't have an order id yet.
 *
 * Usage: `npm run capture`. Complete the Swiggy OTP in your browser when
 * prompted; the script proceeds automatically once the redirect lands.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createMCPClient } from "@ai-sdk/mcp";

const SURFACE = "food" as const;
const BASE = `https://mcp.swiggy.com/${SURFACE}`;
const REDIRECT_PORT = 53682;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "swiggy", SURFACE);
const ENV_LOCAL = path.join(process.cwd(), ".env.local");
const CLIENT_CACHE = path.join(process.cwd(), ".swiggy-oauth-client.json");

interface AuthorizationServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

interface ClientInfo {
  client_id: string;
  client_secret?: string;
  registered_at: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makePkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function fetchAuthorizationServer(): Promise<AuthorizationServerMetadata> {
  const res = await fetch("https://mcp.swiggy.com/.well-known/oauth-authorization-server");
  if (!res.ok) throw new Error(`AS metadata: HTTP ${res.status}`);
  return (await res.json()) as AuthorizationServerMetadata;
}

async function loadOrRegisterClient(as: AuthorizationServerMetadata): Promise<ClientInfo> {
  try {
    const cached = JSON.parse(await fs.readFile(CLIENT_CACHE, "utf8")) as ClientInfo;
    if (cached.client_id) {
      console.log(`✓ Reusing cached client_id=${cached.client_id}`);
      return cached;
    }
  } catch {
    /* fall through */
  }

  if (!as.registration_endpoint) {
    throw new Error("AS does not advertise registration_endpoint — manual registration required");
  }

  const res = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Last Bite — fixture capture",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: (as.scopes_supported ?? ["mcp:tools"]).join(" "),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Client registration failed: HTTP ${res.status} ${body.slice(0, 400)}`);
  }
  const reg = (await res.json()) as { client_id: string; client_secret?: string };
  const info: ClientInfo = {
    client_id: reg.client_id,
    client_secret: reg.client_secret,
    registered_at: Date.now(),
  };
  await fs.writeFile(CLIENT_CACHE, JSON.stringify(info, null, 2));
  console.log(`✓ Registered new client_id=${info.client_id}`);
  return info;
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}

async function authorize(as: AuthorizationServerMetadata, client: ClientInfo): Promise<string> {
  const { verifier, challenge } = makePkce();
  const state = b64url(randomBytes(16));
  const scope = (as.scopes_supported ?? ["mcp:tools"]).join(" ");

  const authUrl = new URL(as.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", scope);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const gotState = url.searchParams.get("state");
      const gotCode = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" });
      if (err || gotState !== state || !gotCode) {
        res.end(
          `<html><body style="font-family:sans-serif;padding:32px"><h1>OAuth failed</h1><pre>${
            err ?? "state mismatch"
          }</pre>You can close this tab.</body></html>`,
        );
        server.close();
        reject(new Error(err ?? "state mismatch / no code"));
        return;
      }
      res.end(
        `<html><body style="font-family:sans-serif;padding:32px"><h1>You can close this tab.</h1>Last Bite has the auth code.</body></html>`,
      );
      server.close();
      resolve(gotCode);
    });
    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      console.log(`\nOpen this URL in your browser to log in:\n  ${authUrl.toString()}\n`);
      console.log("(attempting to open it for you now…)");
      openBrowser(authUrl.toString());
    });
    server.on("error", reject);
  });

  console.log(`✓ Got auth code, exchanging for token…`);

  const tokRes = await fetch(as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
      code_verifier: verifier,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    }).toString(),
  });
  if (!tokRes.ok) {
    const body = await tokRes.text();
    throw new Error(`Token exchange failed: HTTP ${tokRes.status} ${body.slice(0, 400)}`);
  }
  const tokens = (await tokRes.json()) as TokenResponse;
  if (!tokens.access_token) throw new Error("Token response missing access_token");
  console.log(
    `✓ Access token acquired (type=${tokens.token_type}, expires_in=${tokens.expires_in ?? "?"})`,
  );
  return tokens.access_token;
}

async function persistTokenInEnv(token: string) {
  let body = "";
  try {
    body = await fs.readFile(ENV_LOCAL, "utf8");
  } catch {
    /* new file */
  }
  const without = body
    .split("\n")
    .filter((l) => !l.startsWith("BYOC_DEV_TOKEN="))
    .join("\n");
  const next = `${without.trimEnd()}\nBYOC_DEV_TOKEN=${token}\n`;
  await fs.writeFile(ENV_LOCAL, next.trimStart());
  console.log(`✓ Wrote BYOC_DEV_TOKEN to .env.local`);
}

interface CallToolResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Unwrap MCP CallToolResult: prefer structuredContent, then content[0].text JSON, else raw text. */
function unwrap(result: unknown): { ok: boolean; data: unknown; raw: unknown } {
  const r = (result ?? {}) as CallToolResult;
  if (r.isError) return { ok: false, data: null, raw: r };
  const sc = r.structuredContent;
  if (sc && typeof sc === "object" && Object.keys(sc as object).length > 0) {
    return { ok: true, data: sc, raw: r };
  }
  const text = r.content?.[0]?.text;
  if (typeof text === "string") {
    try {
      return { ok: true, data: JSON.parse(text), raw: r };
    } catch {
      return { ok: true, data: text, raw: r };
    }
  }
  return { ok: true, data: r, raw: r };
}

async function captureFixtures(token: string) {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });

  const mcp = await createMCPClient({
    transport: { type: "http", url: BASE, headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const tools = await mcp.tools();
    const toolNames = Object.keys(tools);
    console.log(`✓ MCP tools/list returned ${toolNames.length} tools: ${toolNames.join(", ")}`);

    const catalog: Record<string, unknown> = {};
    for (const [name, t] of Object.entries(
      tools as Record<string, { description?: string; inputSchema?: unknown }>,
    )) {
      catalog[name] = { description: t.description ?? null, inputSchema: t.inputSchema ?? null };
    }
    await writeJson("_tools.json", catalog);

    type ToolWithExec = { execute: (args: unknown, options: unknown) => Promise<unknown> };
    const call = async (name: string, args: Record<string, unknown>) => {
      const t = tools[name] as unknown as ToolWithExec | undefined;
      if (!t?.execute) throw new Error(`tool ${name} has no execute`);
      const raw = await t.execute(args, {});
      return unwrap(raw);
    };

    // 1) get_addresses — required first call.
    console.log(`→ calling get_addresses…`);
    const addrRes = await call("get_addresses", {});
    await writeJson("get_addresses.json", addrRes.raw);
    if (!addrRes.ok) throw new Error("get_addresses failed — cannot continue");
    const addresses = extractAddresses(addrRes.data);
    if (addresses.length === 0) {
      throw new Error("No saved addresses on this Swiggy account. Add one in the Swiggy app and re-run.");
    }
    const addressId = addresses[0].id;
    console.log(`✓ got ${addresses.length} address(es), using addressId=${addressId} (${addresses[0].label ?? "?"})`);

    // 2) Read-only flow with the resolved addressId.
    const safeCalls: Array<[string, Record<string, unknown>]> = [
      ["search_restaurants", { addressId, query: "biryani" }],
      ["search_menu", { addressId, query: "chicken biryani" }],
      ["get_food_cart", { addressId }],
      ["fetch_food_coupons", { addressId }],
    ];

    let restaurantId: string | null = null;
    for (const [name, args] of safeCalls) {
      console.log(`→ calling ${name}…`);
      try {
        const res = await call(name, args);
        await writeJson(`${name}.json`, res.raw);
        console.log(`  ${res.ok ? "✓" : "✗"} saved ${name}.json (${res.ok ? "ok" : "error"})`);
        if (name === "search_restaurants" && res.ok && !restaurantId) {
          restaurantId = pickRestaurantId(res.data);
        }
      } catch (err) {
        console.warn(`  ! ${name} threw: ${(err as Error).message}`);
        await writeJson(`${name}.error.json`, { error: (err as Error).message });
      }
    }

    if (restaurantId) {
      console.log(`→ calling get_restaurant_menu (restaurantId=${restaurantId})…`);
      const res = await call("get_restaurant_menu", { addressId, restaurantId });
      await writeJson("get_restaurant_menu.json", res.raw);
      console.log(`  ${res.ok ? "✓" : "✗"} saved get_restaurant_menu.json`);
    } else {
      console.log("↪︎ skipped get_restaurant_menu (no restaurantId from search)");
    }

    // 3) Tools we deliberately do not call.
    const SKIP_REASON: Record<string, string> = {
      update_food_cart: "would mutate live cart; rely on schema in _tools.json",
      flush_food_cart: "would clear your live cart",
      place_food_order: "would charge real money",
      apply_food_coupon: "would mutate live cart",
      get_food_orders: "private order history",
      get_food_order_details: "needs an order id",
      track_food_order: "needs an order id",
      report_error: "support tool, not a data fetch",
    };
    for (const [name, why] of Object.entries(SKIP_REASON)) {
      console.log(`↪︎ skipped ${name} (${why})`);
    }
  } finally {
    await mcp.close().catch(() => {});
  }
}

interface AddressLike {
  id: string;
  label?: string;
}

function extractAddresses(data: unknown): AddressLike[] {
  if (!data || typeof data !== "object") return [];
  const candidates: unknown[] = [];
  // Try common shapes: { addresses: [...] }, { data: { addresses: [...] } }, [...]
  if (Array.isArray(data)) candidates.push(...data);
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.addresses)) candidates.push(...(o.addresses as unknown[]));
  if (o.data && typeof o.data === "object" && Array.isArray((o.data as Record<string, unknown>).addresses)) {
    candidates.push(...((o.data as Record<string, unknown>).addresses as unknown[]));
  }
  return candidates.flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const r = c as Record<string, unknown>;
    const id = (r.id ?? r.addressId ?? r.address_id) as string | undefined;
    if (!id) return [];
    const label = (r.label ?? r.address_label ?? r.name ?? r.title) as string | undefined;
    return [{ id: String(id), label }];
  });
}

function pickRestaurantId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const lists = [o.restaurants, o.results, (o.data as Record<string, unknown> | undefined)?.restaurants];
  for (const list of lists) {
    if (Array.isArray(list) && list[0] && typeof list[0] === "object") {
      const r = list[0] as Record<string, unknown>;
      const id = r.id ?? r.restaurantId ?? r.restaurant_id;
      if (id != null) return String(id);
    }
  }
  return null;
}

async function writeJson(filename: string, data: unknown) {
  await fs.writeFile(path.join(FIXTURES_DIR, filename), `${JSON.stringify(data, null, 2)}\n`);
}

async function readCachedToken(): Promise<string | null> {
  try {
    const body = await fs.readFile(ENV_LOCAL, "utf8");
    for (const line of body.split("\n")) {
      const m = line.match(/^BYOC_DEV_TOKEN=(.+)$/);
      if (m) return m[1].trim();
    }
  } catch {
    /* no .env.local yet */
  }
  return null;
}

async function main() {
  console.log("=== Last Bite — Swiggy MCP fixture capture ===\n");

  let token = await readCachedToken();
  if (token) {
    console.log("✓ Reusing BYOC_DEV_TOKEN from .env.local (skip --refresh-auth to force OAuth dance)");
  }
  if (!token || process.argv.includes("--refresh-auth")) {
    const as = await fetchAuthorizationServer();
    const client = await loadOrRegisterClient(as);
    token = await authorize(as, client);
    await persistTokenInEnv(token);
  }

  try {
    await captureFixtures(token);
  } catch (err) {
    const msg = (err as Error).message;
    if (/401|unauthor|invalid_token/i.test(msg)) {
      console.warn("\nToken rejected — re-running OAuth dance once and retrying capture.");
      const as = await fetchAuthorizationServer();
      const client = await loadOrRegisterClient(as);
      token = await authorize(as, client);
      await persistTokenInEnv(token);
      await captureFixtures(token);
    } else {
      throw err;
    }
  }
  console.log("\n✓ Done. Inspect /fixtures/swiggy/food/ and tighten the parser if needed.");
}

main().catch((err) => {
  console.error("\n✗ Capture failed:", err);
  process.exit(1);
});
