import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.BYOC_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "BYOC_ENCRYPTION_KEY missing. Generate with: openssl rand -hex 32 — see .env.example",
    );
  }
  if (raw.length < 32) {
    throw new Error("BYOC_ENCRYPTION_KEY must be at least 32 chars (≥256 bits)");
  }
  cachedKey = scryptSync(raw, "lastbite-byoc-v1", 32);
  return cachedKey;
}

/**
 * Envelope format: base64( salt(16) || iv(12) || tag(16) || ciphertext )
 * The salt is unused for key derivation today (we derive from a static
 * label) but is reserved for per-record key rotation in v2.
 */
export function encrypt(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const salt = randomBytes(SALT_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ct]).toString("base64");
}

export function decrypt(envelope: string): string {
  const buf = Buffer.from(envelope, "base64");
  if (buf.length < SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted envelope is malformed");
  }
  const key = getKey();
  const iv = buf.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = buf.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
