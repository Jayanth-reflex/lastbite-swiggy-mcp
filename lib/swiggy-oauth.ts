import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { safeLog } from "@/lib/redact";

const SWIGGY_AS = "https://mcp.swiggy.com";
const SCOPE = "mcp:tools mcp:resources mcp:prompts";

let cachedClientId: string | null = null;

interface RegisterResponse {
  client_id: string;
  client_secret?: string;
}

/**
 * Public OAuth client used for the website's "Continue with Swiggy"
 * flow. Swiggy MCP returns the same `client_id` ("swiggy-mcp") for every
 * registration and operates as a public client (token_endpoint_auth_method=none),
 * so we register once per cold-start and cache it.
 */
export async function registerClient(redirectUri: string): Promise<string> {
  if (cachedClientId) return cachedClientId;
  const res = await fetch(`${SWIGGY_AS}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Last Bite",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`Swiggy OAuth register: HTTP ${res.status}`);
  }
  const json = (await res.json()) as RegisterResponse;
  cachedClientId = json.client_id;
  return cachedClientId;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function makePkce(): PkcePair {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(`${SWIGGY_AS}/auth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("scope", SCOPE);
  return url.toString();
}

export interface SwiggyTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}

export async function exchangeAuthorizationCode(opts: {
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<SwiggyTokens> {
  const res = await fetch(`${SWIGGY_AS}/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      code_verifier: opts.verifier,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    safeLog("oauth.exchange.fail", { status: res.status, body: body.slice(0, 200) });
    throw new Error(`Swiggy token exchange: HTTP ${res.status}`);
  }
  const json = (await res.json()) as SwiggyTokens;
  if (!json.access_token) throw new Error("Swiggy token response missing access_token");
  return json;
}

// ---------- Stateless cookie-based PKCE state ----------
// We sign+encrypt the {phone, verifier, expiresAt} blob into the user's
// own cookie, so we don't need Redis to track in-flight OAuth flows.

const COOKIE_NAME = "lb_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const ALGO = "aes-256-gcm";

export interface OAuthState {
  phone: string;
  verifier: string;
  nonce: string;
  expiresAt: number;
}

function getStateKey(): Buffer {
  const raw = process.env.BYOC_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("BYOC_ENCRYPTION_KEY missing or too short");
  }
  return scryptSync(raw, "lastbite-oauth-state-v1", 32);
}

export function sealState(state: OAuthState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getStateKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function openState(blob: string): OAuthState {
  const buf = Buffer.from(blob, "base64url");
  if (buf.length < 12 + 16) throw new Error("Bad state envelope");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getStateKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const obj = JSON.parse(plain) as OAuthState;
  if (Date.now() > obj.expiresAt) throw new Error("OAuth state expired");
  return obj;
}

export function makeState(phone: string, verifier: string): { sealed: string; nonce: string } {
  const nonce = b64url(randomBytes(12));
  const expiresAt = Date.now() + STATE_TTL_MS;
  const sealed = sealState({ phone, verifier, nonce, expiresAt });
  return { sealed, nonce };
}

export function stateCookieHeaders(sealed: string, mode: "set" | "clear"): { "Set-Cookie": string } {
  const base = `${COOKIE_NAME}=${mode === "set" ? encodeURIComponent(sealed) : ""}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  const expiry =
    mode === "set"
      ? `; Max-Age=${Math.floor(STATE_TTL_MS / 1000)}`
      : `; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return { "Set-Cookie": base + expiry };
}

export function readStateCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const [k, ...rest] = part.split("=");
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return "http://localhost:3000";
}

export function callbackUri(): string {
  return `${siteUrl()}/api/oauth/callback`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}
