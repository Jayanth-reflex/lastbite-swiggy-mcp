import { Redis } from "@upstash/redis";
import { createHash, randomBytes } from "node:crypto";

interface SetOptions {
  ex?: number;
  nx?: boolean;
}

interface KvStore {
  set(key: string, value: string, opts?: SetOptions): Promise<"OK" | null>;
  get<T = string>(key: string): Promise<T | null>;
  del(key: string): Promise<number>;
}

let _redis: KvStore | null = null;

export function redis(): KvStore {
  if (_redis) return _redis;
  if (process.env.LASTBITE_OFFLINE === "1") {
    _redis = makeMemoryStore();
    return _redis;
  }
  // Accept either the Upstash-native env names (manual setup) or the
  // Vercel Marketplace names (auto-injected by `vercel integration add
  // upstash/upstash-kv`, which carries the legacy Vercel KV naming).
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Upstash Redis env missing. Provision via `vercel integration add upstash/upstash-kv`, or set UPSTASH_REDIS_REST_URL/TOKEN, or LASTBITE_OFFLINE=1 for in-memory dev.",
    );
  }
  _redis = new Redis({ url, token }) as unknown as KvStore;
  return _redis;
}

function makeMemoryStore(): KvStore {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const fresh = (k: string) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt < Date.now()) {
      store.delete(k);
      return null;
    }
    return e;
  };
  return {
    async set(key, value, opts) {
      if (opts?.nx && fresh(key)) return null;
      const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : 0;
      store.set(key, { value, expiresAt });
      return "OK";
    },
    async get<T = string>(key: string) {
      const e = fresh(key);
      return (e?.value ?? null) as T | null;
    },
    async del(key) {
      const had = fresh(key) ? 1 : 0;
      store.delete(key);
      return had;
    },
  };
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function hashCart(cart: unknown): string {
  return createHash("sha256").update(JSON.stringify(cart)).digest("hex").slice(0, 16);
}

export function makeIdempotencyKey(userId: string, cartHash: string, day: string): string {
  return createHash("sha256").update(`${userId}|${cartHash}|${day}`).digest("hex");
}

export async function consumeIdempotency(key: string, ttlSeconds = 60 * 60 * 24): Promise<boolean> {
  const result = await redis().set(`idem:${key}`, "1", { ex: ttlSeconds, nx: true });
  return result === "OK";
}

/** Release a previously-consumed idempotency claim (e.g. on transient failure). */
export async function releaseIdempotency(key: string): Promise<void> {
  await redis().del(`idem:${key}`);
}

/**
 * Per-user activity heartbeat. Used by the runner to detect abandoned
 * pending gates (e.g. user opens a calorie gate, walks away, types again
 * 8 hours later). 24h TTL.
 */
export async function getLastActiveAt(userId: string): Promise<number> {
  const v = await redis().get<string>(`last:${userId}`);
  return v ? Number(v) : 0;
}

export async function bumpLastActiveAt(userId: string, when: number = Date.now()): Promise<void> {
  // 30-day TTL so the cleanup cron has reliable staleness signal even
  // for users idle for weeks. The TTL also bounds Redis growth.
  await redis().set(`last:${userId}`, String(when), { ex: 60 * 60 * 24 * 30 });
}

/**
 * Per-user inbound mutex. With function maxDuration=60s and lock TTL=90s,
 * the lock cannot expire before the holding work finishes, so a naive
 * compare-and-delete is sufficient. We still gate del() on the original
 * token so a delayed release can never wipe a fresh acquirer's lock.
 *
 * Returns the lock token on success, null if another inbound holds it.
 */
export async function acquireUserLock(userId: string, ttlSeconds = 90): Promise<string | null> {
  const token = randomBytes(8).toString("hex");
  const ok = await redis().set(`lock:user:${userId}`, token, { ex: ttlSeconds, nx: true });
  return ok === "OK" ? token : null;
}

export async function releaseUserLock(userId: string, token: string): Promise<void> {
  const current = await redis().get<string>(`lock:user:${userId}`);
  if (current === token) {
    await redis().del(`lock:user:${userId}`);
  }
}

export type GraceOutcome = "committed" | "cancelled";

export async function startGraceTimer(orderRef: string, seconds = 30): Promise<void> {
  await redis().set(`grace:${orderRef}`, "pending", { ex: seconds + 5 });
}

export async function cancelGrace(orderRef: string): Promise<void> {
  await redis().set(`grace:${orderRef}`, "cancelled", { ex: 60 });
}

export async function awaitGrace(
  orderRef: string,
  seconds = 30,
  pollMs = 750,
): Promise<GraceOutcome> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const v = await redis().get<string>(`grace:${orderRef}`);
    if (v === "cancelled") return "cancelled";
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return "committed";
}

export async function isGraceActive(orderRef: string): Promise<boolean> {
  const v = await redis().get<string>(`grace:${orderRef}`);
  return v === "pending";
}

/**
 * Webhook idempotency. Gupshup retries delivery on 5xx — we must not
 * double-process a message id. Returns true the first time, false on
 * subsequent calls within the TTL.
 */
export async function claimMessageId(
  messageId: string,
  ttlSeconds = 60 * 60,
): Promise<boolean> {
  const result = await redis().set(`msg:${messageId}`, "1", { ex: ttlSeconds, nx: true });
  return result === "OK";
}
