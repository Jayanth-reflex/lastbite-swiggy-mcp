import { NextResponse } from "next/server";
import { processTurn, UserBusyError } from "@/lib/agent/runner";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { newRequestId, withLogContext } from "@/lib/log-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AgentBody {
  userId?: string;
  text?: string;
  token?: string;
}

/**
 * Dev-only direct probe. Send POST { userId, text, token } to drive the
 * graph without going through Gupshup. The user's BYOC bearer token is
 * passed in the request body — production callers should use the
 * WhatsApp webhook instead, which reads tokens from Redis.
 */
export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  const body = (await req.json().catch(() => ({}))) as AgentBody;
  const userId = body.userId?.trim();
  const text = body.text?.trim();
  const token = body.token?.trim() ?? process.env.BYOC_DEV_TOKEN;

  if (!userId || !text) {
    return NextResponse.json({ error: "userId and text are required" }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json(
      { error: "Provide a Swiggy bearer token via body.token or BYOC_DEV_TOKEN env" },
      { status: 400 },
    );
  }

  const ctx = (await import("@/lib/log-context")).logContext();
  if (ctx) ctx.userId = userId;

  const swiggy = new SwiggyClient({ token });
  try {
    const result = await processTurn({ userId, text, swiggy });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UserBusyError) {
      return NextResponse.json({ error: "user busy", busy: true }, { status: 429 });
    }
    throw err;
  } finally {
    await swiggy.close();
  }
}
