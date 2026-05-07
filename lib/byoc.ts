import { redis } from "@/lib/redis";
import { decrypt, encrypt } from "@/lib/crypto";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * BYOC = Bring Your Own Claude. Until Builders Club approval lands, every
 * Last Bite end-user supplies their own Swiggy MCP bearer token (captured
 * from their Claude Desktop OAuth session) via /connect. We persist the
 * token AES-256-GCM-encrypted in Upstash Redis with a 30-day TTL keyed by
 * normalised phone number. Decrypted only inside SwiggyClient construction.
 */
export async function getByocToken(phone: string): Promise<string | null> {
  const dev = process.env.BYOC_DEV_TOKEN;
  if (dev) return dev;
  const stored = await redis().get<string>(`byoc:${normalisePhone(phone)}`);
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch {
    return null;
  }
}

export async function setByocToken(phone: string, token: string): Promise<void> {
  const sealed = encrypt(token);
  await redis().set(`byoc:${normalisePhone(phone)}`, sealed, { ex: TOKEN_TTL_SECONDS });
}

export async function clearByocToken(phone: string): Promise<void> {
  await redis().del(`byoc:${normalisePhone(phone)}`);
}

/** Lower-case, trim whitespace, ensure leading + on E.164 numbers. */
export function normalisePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("+")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}
