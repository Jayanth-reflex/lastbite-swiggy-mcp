import { NextResponse } from "next/server";
import { z } from "zod";
import { normalisePhone, setByocToken } from "@/lib/byoc";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { sealSession, setSessionCookie } from "@/lib/session";
import { clientIp, connectLimiter } from "@/lib/ratelimit";
import { newRequestId, withLogContext } from "@/lib/log-context";
import { safeLog } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BYOC token-paste flow. The user captures their Swiggy MCP bearer token
 * from a Claude Desktop session that's already OAuth-authorized, then
 * pastes it here. We validate it against Swiggy's MCP server, encrypt at
 * rest, and issue a session cookie. Bridge for the period before
 * Swiggy's whitelist approves our redirect URI.
 */
const Body = z.object({
  phone: z.string().regex(/^\+?\d{10,15}$/, "Phone must be 10–15 digits"),
  token: z
    .string()
    .trim()
    .min(20, "Token looks too short — paste the whole Bearer token")
    .max(8192, "Token is unexpectedly long"),
  inviteCode: z.string().optional(),
});

export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  const limiter = connectLimiter();
  if (limiter) {
    const ip = clientIp(req);
    const { success, reset } = await limiter.limit(`ip:${ip}`);
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return NextResponse.json(
        { error: "Too many attempts. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const expectedInvite = process.env.CONNECT_INVITE_CODE;
  if (expectedInvite && parsed.data.inviteCode !== expectedInvite) {
    return NextResponse.json({ error: "Invalid invite code." }, { status: 403 });
  }

  const phone = normalisePhone(parsed.data.phone);
  const token = stripBearerPrefix(parsed.data.token);

  let valid: boolean;
  try {
    valid = await SwiggyClient.validate(token);
  } catch (err) {
    safeLog("byoc.validate.error", { message: (err as Error).message });
    return NextResponse.json(
      { error: "Couldn't reach Swiggy MCP to validate the token. Try again in a minute." },
      { status: 502 },
    );
  }
  if (!valid) {
    return NextResponse.json(
      {
        error:
          "That token didn't work against Swiggy MCP. Make sure you copied the most recent one from Claude Desktop and that your Swiggy session there is still active.",
      },
      { status: 401 },
    );
  }

  try {
    await setByocToken(phone, token);
  } catch (err) {
    safeLog("byoc.persist.error", { message: (err as Error).message });
    return NextResponse.json(
      { error: "We couldn't save your session right now. Try again in a minute." },
      { status: 500 },
    );
  }

  safeLog("byoc.connect.ok", { phone });

  const successUrl = `/connect/success?phone=${encodeURIComponent(phone)}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(setSessionCookie(sealSession(phone), "set"))) {
    headers.append(k, v);
  }
  return NextResponse.json({ redirectUrl: successUrl }, { headers });
}

function stripBearerPrefix(input: string): string {
  const trimmed = input.trim();
  return trimmed.replace(/^Bearer\s+/i, "");
}
