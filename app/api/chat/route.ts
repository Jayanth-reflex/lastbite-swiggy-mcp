import { NextResponse } from "next/server";
import { z } from "zod";
import { readSessionCookie } from "@/lib/session";
import { processTurn, UserBusyError } from "@/lib/agent/runner";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { getByocToken } from "@/lib/byoc";
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
    safeLog("chat.error", { message: (err as Error).message });
    return NextResponse.json(
      { error: "Something broke on my end. Try again.", reply: null },
      { status: 500 },
    );
  } finally {
    await swiggy.close();
  }
}
