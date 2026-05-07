import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _connectLimiter: Ratelimit | null = null;

/**
 * Sliding window rate limiter for /api/connect.
 * Disabled in offline mode and when Upstash creds are unset (dev defaults
 * to "no limiter" — safer than failing closed during local dev).
 */
export function connectLimiter(): Ratelimit | null {
  if (process.env.LASTBITE_OFFLINE === "1") return null;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (_connectLimiter) return _connectLimiter;
  _connectLimiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    analytics: false,
    prefix: "rl:connect",
  });
  return _connectLimiter;
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
