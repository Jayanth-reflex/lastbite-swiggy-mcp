import { logContext } from "@/lib/log-context";

const BEARER_RE = /Bearer\s+[A-Za-z0-9_\-.+/=]+/gi;
const JWT_RE = /\bey[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g;

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "apikey",
  "x-api-key",
  "swiggy-token",
]);

function redactString(s: string): string {
  return s.replace(BEARER_RE, "Bearer [REDACTED]").replace(JWT_RE, "[REDACTED_JWT]");
}

function redactValue(v: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof v === "string") return redactString(v);
  if (Array.isArray(v)) return v.map((item) => redactValue(item, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redactValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

export function redact<T>(input: T): T {
  return redactValue(input) as T;
}

export function safeLog(label: string, payload?: unknown): void {
  const ctx = logContext();
  const prefix = ctx?.requestId
    ? `[${ctx.requestId}${ctx.userId ? ` ${ctx.userId}` : ""}]`
    : "";
  if (payload === undefined) {
    console.log(`${prefix}[${label}]`);
    return;
  }
  console.log(`${prefix}[${label}]`, redact(payload));
}
