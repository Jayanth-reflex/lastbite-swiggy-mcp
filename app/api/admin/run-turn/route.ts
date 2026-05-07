import { NextResponse } from "next/server";
import { z } from "zod";
import { processTurn, UserBusyError } from "@/lib/agent/runner";
import { SwiggyClient } from "@/lib/mcp/swiggy-client";
import { getByocToken, normalisePhone } from "@/lib/byoc";
import { newRequestId, withLogContext, logContext } from "@/lib/log-context";
import { safeLog } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  phone: z.string().min(8),
  text: z.string().min(1),
});

/**
 * Admin-only test endpoint. Looks up the BYOC token by phone (server-side
 * decrypt using BYOC_ENCRYPTION_KEY which is never exposed to clients) and
 * runs one turn through the agent. Useful for support/debugging without
 * having to capture a fresh token. Auth via Authorization: Bearer <LB_ADMIN_SECRET>.
 */
export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  const expected = process.env.LB_ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "admin disabled" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const phone = normalisePhone(parsed.data.phone);
  const ctx = logContext();
  if (ctx) ctx.userId = phone;

  const token = await getByocToken(phone);
  if (!token) {
    return NextResponse.json({ error: "no token registered for that phone" }, { status: 404 });
  }

  const swiggy = new SwiggyClient({ token });
  try {
    const result = await processTurn({ userId: phone, text: parsed.data.text, swiggy });
    safeLog("admin.run-turn", { phone, status: result.status, paused: result.paused });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UserBusyError) {
      return NextResponse.json({ error: "user busy", busy: true }, { status: 429 });
    }
    safeLog("admin.run-turn.error", { message: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    await swiggy.close();
  }
}
