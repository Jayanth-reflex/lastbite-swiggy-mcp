import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { safeLog } from "@/lib/redact";

const COOKIE_NAME = "lb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ALGO = "aes-256-gcm";

export interface Session {
  phone: string;
  expiresAt: number;
}

function key(): Buffer {
  const raw = process.env.BYOC_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("BYOC_ENCRYPTION_KEY missing or too short");
  }
  return scryptSync(raw, "lastbite-session-v1", 32);
}

export function sealSession(phone: string): string {
  const session: Session = { phone, expiresAt: Date.now() + SESSION_TTL_MS };
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function openSession(blob: string): Session | null {
  try {
    const buf = Buffer.from(blob, "base64url");
    if (buf.length < 12 + 16) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv(ALGO, key(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    const obj = JSON.parse(plain) as Session;
    if (!obj.phone || Date.now() > obj.expiresAt) return null;
    return obj;
  } catch (err) {
    // Same key-rotation risk as byoc.getByocToken — silent failure here
    // logs every existing user out as "not authenticated". Log so a key
    // rotation accident doesn't go unnoticed.
    safeLog("session.decrypt-failed", { message: (err as Error).message });
    return null;
  }
}

export function setSessionCookie(sealed: string, mode: "set" | "clear"): { "Set-Cookie": string } {
  const base = `${COOKIE_NAME}=${mode === "set" ? sealed : ""}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  const expiry =
    mode === "set"
      ? `; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
      : `; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return { "Set-Cookie": base + expiry };
}

export function readSessionCookie(cookieHeader: string | null): Session | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(/;\s*/)) {
    const [k, ...rest] = part.split("=");
    if (k === COOKIE_NAME) {
      return openSession(rest.join("="));
    }
  }
  return null;
}
