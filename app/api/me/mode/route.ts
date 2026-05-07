import { NextResponse } from "next/server";
import { z } from "zod";
import { readSessionCookie } from "@/lib/session";
import {
  effectiveMode,
  realOrdersGloballyEnabled,
  setUserMode,
} from "@/lib/user-prefs";
import { newRequestId, withLogContext } from "@/lib/log-context";
import { safeLog } from "@/lib/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ mode: z.enum(["demo", "live"]) });

export async function POST(req: Request) {
  return withLogContext({ requestId: newRequestId() }, () => handle(req));
}

async function handle(req: Request) {
  const session = readSessionCookie(req.headers.get("cookie"));
  if (!session) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  // If the user is asking to go live but the global kill switch is off,
  // we still record the preference (so it activates the moment the host
  // flips LB_REAL_ORDERS=1) but the response makes it visible.
  await setUserMode(session.phone, parsed.data.mode);
  safeLog("user.mode-changed", { phone: session.phone, mode: parsed.data.mode });

  const eff = await effectiveMode(session.phone);
  return NextResponse.json({
    mode: parsed.data.mode,
    effectiveMode: eff,
    realOrdersAvailable: realOrdersGloballyEnabled(),
  });
}
