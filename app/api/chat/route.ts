import { NextResponse } from "next/server";
import { z } from "zod";
import { readSessionCookie } from "@/lib/session";
import { processTurn, UserBusyError } from "@/lib/agent/runner";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { clearByocToken, getByocToken } from "@/lib/byoc";
import { newRequestId, withLogContext, logContext } from "@/lib/log-context";
import { safeLog } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  text: z.string().trim().min(1).max(400),
});

/**
 * Authenticated chat endpoint for /order/new. Uses the session cookie
 * issued at /api/oauth/callback to look up the user's BYOC token, then
 * runs one turn through the agent. Demo mode is enforced by the placer
 * unless LB_REAL_ORDERS=1.
 */
export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  const session = readSessionCookie(req.headers.get("cookie"));
  if (!session) {
    return NextResponse.json(
      { error: "not authenticated", needsConnect: true },
      { status: 401 },
    );
  }

  const ctx = logContext();
  if (ctx) ctx.userId = session.phone;

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const token = await getByocToken(session.phone);
  if (!token) {
    return NextResponse.json(
      { error: "Your Swiggy connection expired. Reconnect.", needsConnect: true },
      { status: 401 },
    );
  }

  const swiggy = new SwiggyClient({ token });
  try {
    const result = await processTurn({
      userId: session.phone,
      text: parsed.data.text,
      swiggy,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UserBusyError) {
      return NextResponse.json(
        { error: "Hold on — finishing your previous message.", busy: true },
        { status: 429 },
      );
    }
    if (looksLikeAuthFailure(err)) {
      // Swiggy upstream rejected our token — likely revoked or 24h expiry.
      // Wipe it so the next /connect submission is clean.
      await clearByocToken(session.phone).catch(() => {});
      safeLog("chat.token-expired", { userId: session.phone });
      return NextResponse.json(
        {
          error: "Your Swiggy MCP token expired. Please paste a fresh one from Claude Desktop.",
          needsConnect: true,
        },
        { status: 401 },
      );
    }
    safeLog("chat.error", { message: (err as Error).message });
    return NextResponse.json(
      { error: "Something broke on my end. Try again.", reply: null },
      { status: 500 },
    );
  } finally {
    await swiggy.close();
  }
}

/**
 * Pattern-match Swiggy MCP / @ai-sdk/mcp errors that indicate the user's
 * bearer token is no longer accepted upstream. Conservative: requires
 * either an explicit 401/403, or one of a small set of phrases that
 * Swiggy's API uses for token-rejected responses.
 */
function looksLikeAuthFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes("401") || msg.includes("403")) return true;
  return (
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("invalid token") ||
    msg.includes("token expired") ||
    msg.includes("authentication required")
  );
}
